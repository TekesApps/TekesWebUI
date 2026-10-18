# Validation

Local acceptance on 2026-10-18:

- Strict TypeScript check and Vite production build pass.
- Twenty-four behavior/transport tests pass: identity isolation, shared grouping,
  filtering, native time scales, draft acknowledgement races, IME, scrolling,
  safe links, rename sequence reconciliation, uncertain mutations, theme contrast,
  fragmented UTF-8/NDJSON, authentication failure and no mutation replay.
- Composer coverage includes Harness-specific preset payloads, unchanged initial
  configuration text, DSH roster/document composition, upload policy checks,
  binary encoding, list sorting/grouping and local hover date normalization.
- Workspace regression tests cover file/preset destination isolation, upload-before-
  prompt ordering, delayed admission acknowledgements preserving newly typed text,
  and explicit retry reusing stable upload/prompt receipts after an uncertain result.
- TekesUI's `generate-gallery-brands.py --check` passes for the imported source;
  the TypeScript importer also verifies recorded compiler input hashes. Sage
  (`#7FA27B`) colors are imported for light/dark and both increased-contrast themes.
- The authenticated host serves the standalone production assets. HTML, JS, CSS
  and favicon resolve; CSP and traversal rejection pass. Browser/native credential
  isolation and invalid-Origin rejection pass.
- The browser reads existing Kernel/Pi/DSH inventories through the same AgentKit
  service. The initial 159 summary rows included five retained archived DSH rows;
  they were not all active sessions. The corrected active projection contains
  145 DSH, eight Pi and one Kernel thread. Archived data remains in Harness storage.
  No separate browser database exists.
- A browser-created Kernel 0.9.0 thread used the real configured DeepSeek Flash
  model and returned the requested Chinese verification reply.
- In the same temporary thread, a real shell call executed `sleep 8` followed by
  a marker. The browser tab was closed while the UI showed an active operation.
  Reopening and authenticating restored the thread, completed tool activity and
  expected final marker. The temporary thread was then archived through the UI.
- An independent Swift public-API consumer reads all three endpoint inventories
  and validates projected transcript baselines. Tekes' Agent UI ownership check
  passes with the explicit ClientKit source root. The host's private-pipe and
  provider-projection regression checks pass.

Composer/detail follow-up acceptance:

- The actual browser displays `+`, Kernel Coding/General, Pi Default and DSH
  Standard/PTC/Minimal/Creative from the real catalogs. Input settings display
  real configuration text, model context capacity and reasoning choices.
- One compact header contains brand, expandable search and list options. Activity
  and title sort, grouping and filters are view preferences; no thread records
  are changed. The browser was checked for actual title sorting and a precise
  local timestamp tooltip via keyboard focus. Pointer tooltips share that content.
- The TypeScript Workspace controller uploaded a known text file and used the real
  DeepSeek Flash model to read its marker on Kernel (Coding), Pi (Default) and DSH
  (Minimal). All three returned the file-only marker. Temporary threads were archived;
  Kernel's initial archive attempt hit the worker settlement boundary and was
  completed separately after settlement, without replaying a prompt.
- The embedded test browser did not expose the OS file picker; its final file
  selection interaction is left for the user's normal browser. File receipt,
  prompt materialization and real model reads were verified through the same
  production TypeScript controller. No synthetic model or new Kernel code was used.
- The shared bridge now honors the existing workspace archived-session authority
  when projecting the active inventory. A Rust regression verifies that retained
  archived summaries disappear from the active projection without erasing history,
  and reappear when the archive flag is cleared. Rust test/build/strict Clippy,
  host authentication and private-pipe checks, and the independent Swift public-API
  consumer pass after the bridge update.

## Shared menu foundation (2026-10-18)

- Replaced separate Harness, model, effort, sidebar, session and appearance menu
  implementations with one Radix-based foundation. Removed superseded menu and
  native-select styling. Details/forms remain native dialogs and form controls.
- Browser acceptance against the existing authenticated live host: actual Harness
  presets and DeepSeek models render; Down focuses the first menu item; Right opens
  the sorting submenu; Left returns to the parent; Escape closes and restores focus
  to the triggering button. Light and dark menu rendering and appearance selection
  were checked, then the original system appearance preference was restored.
  Opening the appearance menu inside Settings works;
  Escape closes that menu while preserving the Settings dialog and focus.
- Existing 24 application tests and the strict TypeScript/production build pass.
  No host restart or Kernel changes were needed for this frontend update.

## Text reveal and motion (2026-10-18)

- Inspected the pinned reference's grapheme blur/opacity reveal, message rise,
  quiet dots, status shimmer and easing roles. Independently implemented the
  applicable effects in one CSS motion layer; no upstream code or assets copied.
- Thirty tests pass, including incremental text ranges, large/rapid frame bounds,
  split emoji and combining marks, replacement reconciliation and reduced motion.
  A React DOM integration checks real Markdown rendering: history stays solid,
  appended spans preserve existing strong markup and full selectable text, spans
  are cleaned up, links/code remain semantic, and changing reduced motion prevents
  subsequent reveal spans. Strict TypeScript and production build pass.
- The authenticated browser used the configured real DeepSeek Flash model on
  Kernel 0.9.0 for two rounds: a Chinese ten-paragraph response with bold/list
  content, then a longer plant-description response. Both completed and rendered
  in the updated transcript. No synthetic model or backend restart was used.
- These are functional/local presentation checks. Screenshots show the completed
  text, not animation cadence or frame-rate measurements; browser/OS-specific
  reduced-motion rendering and disclosure height enhancement still need broader
  device acceptance. Unsupported disclosure animation falls back to native details.

## ClientKit transcript information alignment (2026-10-19)

- Read-only comparison against ClientKit's current transcript mode, tool-role,
  row-model, activity, information and AgentKit DTO implementations. The browser
  now maps the same 51 exact tool names plus two family prefixes; the drift check
  reads the actual Swift mapping instead of relying on a duplicated fixture.
- Thirty-six tests, source mapping check, strict TypeScript and production build
  pass. Regressions cover live/history reasoning omission from all rendered HTML,
  semantic glyph coverage, process/final partition, literal notices/errors, full
  input/output retention and stopped/failed/nonzero-exit state handling.
- Browser acceptance used the existing authenticated real Kernel history, with no
  new model request or backend restart. Normal completed process starts collapsed;
  expansion shows its shell tool glyph and `ok` state; individual expansion retains
  full inputs, outputs and copy actions. The actual page has zero thinking
  disclosures. Screenshots are private evidence outside this public repository.
- See `transcript-parity.md` for the exact policy and public DTO limitations.
  No ClientKit, native host, AgentKit or Kernel code changed in this update.

This is local browser and API acceptance, not full native App parity, a mobile
device acceptance run, physical IME/VoiceOver acceptance or a performance benchmark.
The integration retains the earlier host's Kernel 0.9.0 data root; it does not
migrate incompatible older Kernel ledgers. Provider secrets and private connection
descriptors are not part of this repository.
