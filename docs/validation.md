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

## TekesUI SVG integration (2026-10-19)

- Replaced all interface and tool glyph imports with TekesUI canonical SVG slots;
  removed the Lucide dependency. Copied 8 MIT shared defaults with the original
  license and SHA256 provenance; 42 selected external Gallery assets are local-only.
- Thirty-nine tests pass, including exact shared/optional-local SVG byte hashes
  and complete canonical slot coverage. ClientKit semantic-role drift check passes.
  Strict TypeScript, production build, and an independent public-source build with
  no external legacy files pass. The public build contains no legacy shell SVG.
- The authenticated browser reports no Lucide elements and zero fallback glyphs
  among all rendered icons. The historical Shell row resolves to `tekes-shell`
  at 15px through a same-origin SVG mask. Light and dark rendering were inspected;
  the original system appearance was restored. Source artwork is unchanged.
- SVGs stay external under the existing strict CSP. Neither source repository nor
  backend was modified. Full external artwork is deliberately excluded from Git;
  see `icons.md` for the clean-checkout fallback and explicit import workflow.

## Complete public catalog and transcript header (2026-10-19)

- TekesUI publicly publishes 176 valid SVG names at `icons-v0.1.1`, commit
  `80d6b05649234f953ea452d42e1cbed369fdddbb`. Its Node catalog/hash tests, Rust
  icon tests, targeted self-contained Gallery test and independent Rust public-API
  consumer pass. The existing eight-icon animation API remains compatible.
- Web directly depends on that immutable public HTTPS archive and SHA512 integrity.
  Removed the local asset directory, import command, copied SVG defaults and
  generic fallback. Public package assets are required and checked by the build.
- Cloned the actual public Web repository at commit
  `7952f6092b3eae2ea0b19c038d5f249f0b06d965` into an empty temporary directory.
  Used a fresh npm cache, empty npm configs, disabled Git credential helpers,
  disabled SSH, and disabled interactive Git prompts. `npm ci`, all 40 tests
  (zero skips) and production build pass without any local TekesUI/legacy directory.
- All 176 canonical SVG byte hashes are present in that clean build. Vite emits
  172 unique SVG files because four identical resources deduplicate; no glyph is
  replaced by a generic fallback. The MIT notice is retained.
- The live browser confirms zero transcript initial boxes, zero thinking disclosures,
  retained message timestamps and working shared tool icons. No model request or
  backend restart was needed. The transcript removes the initial box only; Composer
  Harness selection remains available.

This is local browser and API acceptance, not full native App parity, a mobile
device acceptance run, physical IME/VoiceOver acceptance or a performance benchmark.
The integration retains the earlier host's Kernel 0.9.0 data root; it does not
migrate incompatible older Kernel ledgers. Provider secrets and private connection
descriptors are not part of this repository.

# v0.1.6 release

- Web: 47 tests pass; TypeScript and production build pass. Existing Vite chunk-size
  advisory remains unchanged.
- AgentKit v0.3.1: contract/presentation/service checks pass (42 tests); shared
  annotation bindings are generated from Rust and consumed through the public
  immutable commit archive, with package-lock integrity.
- Annotation selection, counted list, edit/remove, source navigation, draft reload,
  real-model response and post-reload history recovery were verified in the browser.
  The real-model acceptance response was `AGENTKIT_ANNOTATION_OK`.
- The AppIcon is included in the public Web checkout. Annotation controls use the
  shared TekesUI bubble glyph. No local icon-directory import is required.
- Browser screenshots, credentials and runtime connection files are excluded from
  this public source release. Pi/DSH live model acceptance was not repeated.

# v0.1.7 release

- AgentKit v0.3.2 owns shared thread-action definitions, capability policy and dispatch.
- Web consumes generated public contract types from the immutable release commit.
- Web: 51 tests and production build pass; existing bundle-size advisory remains.
- AgentKit: 49 contract/presentation/service tests, build, headless dependency boundary
  check and a second public-API consumer example pass.
- Local browser: menu order/disabled pin reason and rename target verified; rename
  dialog cancelled without changing a thread. Kernel, Pi and DSH public action APIs
  verified. No live archive/fork mutation or native Mac migration was performed.
- Pin is unavailable until the host supplies shared pin state.

# v0.1.8 release

- Pins and their order are persisted by AgentKit v0.3.3, not by the browser or Harness.
- AgentKit: 52 targeted tests pass, including durability, account/workspace isolation,
  endpoint identity, write failure, multi-observer updates and idempotent replay
  across restart. Build, dependency boundaries and a second public persistence
  consumer pass.
- Web: 52 tests and production build pass. Pinned groups preserve the server order
  across Harnesses and ignore ordinary title/folder sorting. The existing bundle
  size advisory remains. No native Mac changes or Kernel changes are included.
- Local authenticated host integration: two existing sessions across Harnesses were
  pinned and reordered; duplicate move RPC reconciled, browser was closed, and the
  service restarted. Pins/order and replay receipts survived; both test pins were
  then removed to restore the original state. Browser menu showed enabled unpin
  and correct first/last move boundaries.

# v0.1.9 release

- AgentKit v0.3.4 stores only pin relationships and pin/unpin receipts; no pin rank,
  move operation, group labels, sort policy or UI preferences remain in the service.
- Existing v1 pin files migrate to v2 without losing relationships.
- Public generated `ThreadActivity` exposes normalized execution status and freshness.
  Inactive threads are not assumed completed; idle, unknown and stale remain distinct.
- Web grouping (folder/status/none), group labels/order and title/activity sorting are
  browser preferences. The chosen sort applies to pinned rows too. Legacy boolean
  grouping preferences migrate locally.
- AgentKit: 55 targeted tests, build, headless boundaries and second public consumer pass.
- Web: 53 tests and production build pass; existing bundle-size advisory remains.
- Mac ClientKit and Kernel are unchanged.
- Local host integration verified all three Harness inventories publish activity facts
  with no pin ranks, and reject retired move actions. Existing v1 preferences migrated
  to v2 with all relationships preserved. Browser 分组 → 按状态 rendered completed,
  not-started and idle groups, with the preference retained after reload. No model
  prompts or native Mac interactions were used for this acceptance.

# v0.1.10 release

- Web displays idle as 未运行 / Not running. Explicit completed, failed and
  cancelled results retain their groups. AgentKit's contract is unchanged.
- Chinese and English cover connection/auth, sidebar, settings, menus, composer,
  annotations, transcript chrome and known interface errors. Language selection
  is available before connecting and in settings, follows the browser on first
  use and is saved locally after manual selection.
- Original messages, quotations, paths, model names and tool data are preserved.
- 56 tests, strict TypeScript and production build pass; the existing bundle-size
  advisory remains. Localization tests cover rendered English chrome, original
  Chinese message preservation, interpolation and dictionary completeness.
- Local browser acceptance: switched Chinese → English through settings, reloaded
  and confirmed English preference persistence, English thread-action menu and
  Not running status group. Chinese conversation content stayed unchanged. The
  pre-authentication language selector was verified in both languages.

# v0.1.11 release

- Status group headings use distinct shared TekesUI artwork for running, queued,
  waiting for input, completed, not started, failed, cancelled, not running,
  unknown and stale states. Pin and folder open/closed icons are unchanged.
- The public icon catalog check covers the new status mapping.
- 56 tests and production build pass; existing bundle-size advisory remains.
- Local browser verified completed, not-started and not-running glyphs. No state
  semantics, model calls, AgentKit, Kernel or native Mac changes are included.

# v0.1.12 release

- Status icon colors come directly from TekesUI's compiled Sage semantic tokens
  for light, dark and increased contrast: amber running, green completed, red
  failed and informational blue cancelled. Neutral/waiting states retain their
  respective semantic roles and distinct shapes.
- Transcript title bar is 44px on desktop and 48px on narrow layouts.
- Streamed assistant Markdown now advances a visible grapheme frontier instead
  of laying out whole packets behind a blur. History/corrections are immediate,
  coalesced frames have a bounded catch-up tail, and reduced-motion/background
  transitions flush pending presentation. Original transcript and Copy text
  remain unchanged.
- 56 tests and production build pass, including deterministic typing/DOM, Unicode,
  Markdown node preservation, cleanup and light/dark color contrast checks. The
  existing bundle-size advisory remains.
- Local browser checked light/dark semantic colors and measured the actual host
  page title bar at 44px. Typing was validated with a synthetic frontend stream;
  no real-model prompt was submitted for this acceptance.
- AgentKit, Kernel and the native Mac App are unchanged.

# v0.1.13 release

- The sidebar brand displays the package version beside Tekes.
- Output time follows Copy in the bottom action row and appears on message hover
  or keyboard focus. Completed output prefers the authoritative turn end time;
  unfinished output does not show a finish caption.
- Input and output captions use Today/Yesterday, weekday through seven calendar
  days, then month/day, with HH:mm. Chinese/English, timezone boundaries, DST,
  midnight refresh, invalid/missing timestamps and exact-time tooltips are covered.
- 60 tests and the production build pass; the existing bundle-size advisory remains.
- The local authenticated browser verified footer captions and the exact-time
  keyboard tooltip against existing real conversation data. No model prompt was
  submitted. AgentKit, Kernel and the native Mac App are unchanged.
