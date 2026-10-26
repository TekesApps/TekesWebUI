# Existing WebUI delivery integration

Candidate source base: TekesWebUI main `03b1966` (v0.1.23). Delivery candidate version: 0.2.0. Its published sidebar divider and transcript recovery semantics remain from 0.1.23.

## Adopted from the existing local worktree

- Permission DTO consumer (`src/permissions.ts`), Composer catalog and selection, per-endpoint/session state fencing in `src/workspace.ts`, message admission guards, translated copy and targeted tests. It consumes AgentKit's published contract only after its immutable candidate pin is available.
- A minimal Tasks/Subagents panel consumes AgentKit's `agent.familySnapshot` summary/catalog and opaque child-pane API. Independent tasks navigate only when the returned endpoint/thread/session scope matches the selected source; child panes use their per-open handle, exact address and connection epoch, and service-owned availability. Parent drafts remain in the existing workspace draft store. Ending observation drops the child handle through the service lease; reopening obtains a new handle and starts pagination from that new view.
- Existing-runtime manager commands `setup/start/stop/status/open`, `start-options.json` and `service-options.json` import, hidden Keychain prompt reuse and optional `inPlace` AgentKit path. This uses the already installed binaries and data; it does not package or download another runtime.
- README/local-service guidance is updated to describe existing-runtime use. Runtime version pins must match the final AgentKit/Kernel immutable releases before release.

## Not included in this slice

The pre-existing primary worktree WIP is protected by
`/Volumes/HP P900/dev/TekesAgentKit/.runtime-fixtures/web-delivery-20261026/webui-entry-wip.json`
and `selected-wip.patch`. It also contains transcript/composer/style changes, permissions explanation, live-permission utility, layout/tests and deleted release installer/packager tests. This slice imports only the shared permission consumer and existing-runtime configuration path. The published 0.1.23 transcript and sidebar files were retained.

No installation or deployment was performed. Before release, install the exact public AgentKit contract pin and run `npm ci`, tests, TypeScript/Vite/host build, then the installed browser flow against the exact published AgentKit/Kernel binaries. The real configured model flow and service/browser restart boundary remain unverified.

The family UI contract is implemented from the service worker's frozen
`docs/web-family-contract.md`; this frontend has not been built against the
published package or exercised in a browser yet. Artifact/file previews remain
outside this delivery slice because no service API is available.

The consumer now pins AgentKit `f5fa01662d556af1454063bd6286793d55bd1d0a`
(public 0.4.0 candidate). Child Transcript and Run projections come from the
service, including connection, queue and approvals; the browser does not invent
an idle child. Approval responses bind the pane's endpoint, and pending reads
cannot populate another selected parent. This is candidate source integration,
not a released daily-use or browser acceptance claim.

Local validation: clean npm ci and strict public-pin check; 95 unit/host tests
passed with one opt-in test skipped, followed by that actual f5fa016 Rust pipe
consumer (8/8, zero skips), a final build and scoped workspace tests. A test-only
optional method field initially failed strict typechecking; guarded fixture
comparisons fixed it before the final build. The original failure is retained.
Actual Harness/browser/performance and existing-user-entry acceptance remain open.
