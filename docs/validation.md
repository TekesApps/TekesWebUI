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

This is local browser and API acceptance, not full native App parity, a mobile
device acceptance run, physical IME/VoiceOver acceptance or a performance benchmark.
The integration retains the earlier host's Kernel 0.9.0 data root; it does not
migrate incompatible older Kernel ledgers. Provider secrets and private connection
descriptors are not part of this repository.
