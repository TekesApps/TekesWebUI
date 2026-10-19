# Transcript annotations

Select text within one user or assistant message, choose **添加批注**, and optionally
write a comment. Quoted text is preserved exactly, including Unicode, whitespace
and Markdown-rendered text. A selection across messages is not admitted.

The Composer shows one badge with the total count. One annotation opens its editor;
multiple annotations open a list with edit, remove and reveal actions. Pending
annotations can also be edited from their source message badge. An annotation-only
message is valid. The original source, excerpt, and comment are separate values.

Drafts are isolated by endpoint and session (or endpoint and new-session directory),
and saved in the current browser profile's local storage when available. Private
browsing or full storage can limit draft persistence. Drafts are not synchronized
between the native App and Web. Sent annotations are durable Harness history.

## Public transport

The annotation DTOs come directly from the public `@tekesagentkit/client-contract`
package, pinned to an immutable HTTPS commit archive and lockfile integrity. The
TypeScript declarations are generated from `tekes-agent-contract`'s Rust DTO
macro. Web has no separately maintained annotation protocol type or prompt
compiler.

The v0.1.6 release pinned the earlier annotation-only package from AgentKit v0.3.1 at
`89bc9d030a2b243d95f436628e9b010e45229491`.
TekesWebUI v0.1.8 pins AgentKit v0.3.3 and includes the shared [thread-action contract](thread-actions.md).

Web passes `AnnotationInput` (`text`, `annotations`) to the advertised AgentKit
`composer.compileAnnotations` method. AgentKit validates and compiles the DTOs;
Web sends the resulting opaque text through ordinary `session.prompt` alongside
attachment receipts. A host without that capability rejects annotation submission
locally and retains the draft; there is no private Web fallback.

AgentKit's `follow(view)` exposes `item.inputPresentation` using the public
`AnnotationInputPresentation` DTO. Web renders its authored text and annotation
cards directly. Durable prompt text remains in `item.text`; all cross-Harness
encoding, decoding and old-format history compatibility live in AgentKit. Web
does not parse annotation envelopes from message text. Only old browser drafts
receive a one-time in-browser DTO migration.

Native ClientKit has its own annotation presentation storage; this change does not
populate native annotation chips. Other clients still read the same complete
ordinary prompt text. No Kernel code is changed.

Pending annotations survive failed/uncertain admission. Explicit retry retains the
submission identity when the payload is unchanged. Successful acknowledgements
remove only unchanged submitted annotations; newer edits, additions and other
destinations survive.

## Source navigation

Captures retain endpoint, session, item and turn identities, the exact UTF-16 range,
and a fingerprint of the rendered source text. Reveal requires the same session,
loaded source and unchanged text, and then selects the original range across DOM
text nodes. Repeated quotes are not rebound with a fuzzy search. Missing, unloaded,
or changed sources produce a visible explanation and preserve the captured quote.
The fingerprint detects changes; it is not a security or authorization proof.
Navigation does not silently switch sessions or start a new model run.

## Validation

- Unit/integration and DOM checks cover Unicode/markup boundaries, delimiter escaping,
  malformed history, safe rendering, persistent drafts, cross-session isolation,
  failed admission/retry, late acknowledgements, source reveal, stale sources and
  cross-message selection rejection.
- Browser verification covered selection, counted lists, editing, deletion, refresh,
  and source reveal. The original text-transport acceptance returned
  `ANNOTATION_WEB_OK`. After the public contract migration, a second prompt through
  `composer.compileAnnotations` returned `AGENTKIT_ANNOTATION_OK`; reloading
  restored the public presentation DTO and reply from Harness history. The
  shared bubble glyph was verified in the actual selection control and history.
- Live prompt acceptance was verified on Kernel through the public AgentKit endpoint.
  Pi/DSH use the same text contract; live model runs were not repeated for them.
  Physical touch selection, screen readers and native annotation-card interop have
  not been accepted by this change.

## Icon

The Annotation interface slot directly reuses TekesUI's public `tekes-side-chat`
bubble artwork, including the selection button, Composer badge and annotation
list. It no longer uses the quote-mark glyph. The TekesUI maintenance task has
been notified to provide a dedicated canonical annotation name/alias centrally;
Web has no copied SVG or local icon-directory dependency.
