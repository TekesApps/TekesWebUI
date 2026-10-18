# Validation

Local acceptance on 2026-10-18:

- Strict TypeScript check and Vite production build pass.
- Fourteen behavior/transport tests pass: identity isolation, shared grouping,
  filtering, native time scales, draft acknowledgement races, IME, scrolling,
  safe links, rename sequence reconciliation, uncertain mutations, theme contrast,
  fragmented UTF-8/NDJSON, authentication failure and no mutation replay.
- TekesUI's `generate-gallery-brands.py --check` passes for the imported source;
  the TypeScript importer also verifies recorded compiler input hashes. Sage
  (`#7FA27B`) colors are imported for light/dark and both increased-contrast themes.
- The authenticated host serves the standalone production assets. HTML, JS, CSS
  and favicon resolve; CSP and traversal rejection pass. Browser/native credential
  isolation and invalid-Origin rejection pass.
- The browser reads existing Kernel/Pi/DSH inventories through the same AgentKit
  service. Before the temporary test thread, inventories contained 159 active
  sessions: 150 DSH, eight Pi and one Kernel. No separate browser database exists.
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

This is local browser and API acceptance, not full native App parity, a mobile
device acceptance run, physical IME/VoiceOver acceptance or a performance benchmark.
The integration retains the earlier host's Kernel 0.9.0 data root; it does not
migrate incompatible older Kernel ledgers. Provider secrets and private connection
descriptors are not part of this repository.
