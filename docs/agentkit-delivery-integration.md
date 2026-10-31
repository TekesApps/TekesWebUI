# Existing WebUI delivery integration

Candidate source base: TekesWebUI main `03b1966` (v0.1.23). Delivery candidate version: 0.2.0. Its published sidebar divider and transcript recovery semantics remain from 0.1.23.

## Adopted from the existing local worktree

- Permission DTO consumer (`src/permissions.ts`), Composer catalog and selection, per-endpoint/session state fencing in `src/workspace.ts`, message admission guards, translated copy and targeted tests. The immutable public declaration pin is `58950714b1c48f21c1465b929d3fb795f6f03ce2`, recorded in both package files. This declaration pin does not identify the running Core executable.
- A minimal Tasks/Subagents panel consumes AgentKit's `agent.familySnapshot` summary/catalog and opaque child-pane API. Independent tasks navigate only when the returned endpoint/thread/session scope matches the selected source; child panes use their per-open handle, exact address and connection epoch, and service-owned availability. Parent drafts remain in the existing workspace draft store. Ending observation drops the child handle through the service lease; reopening obtains a new handle and starts pagination from that new view.
- Existing-runtime manager commands `setup/start/stop/status/open`, `start-options.json` and `service-options.json` import, hidden Keychain prompt reuse and optional `inPlace` AgentKit path. This uses the already installed binaries and data; it does not package or download another runtime.
- README/local-service guidance is updated to describe existing-runtime use. Runtime version pins must match the final AgentKit/Kernel immutable releases before release.

## Not included in this slice

At the original intake, pre-existing primary worktree WIP was protected by
`/Volumes/HP P900/dev/TekesAgentKit/.runtime-fixtures/web-delivery-20261026/webui-entry-wip.json`
and `selected-wip.patch`. That intake imported selected permission and
existing-runtime changes while retaining the published transcript and sidebar.
Subsequent scoped consumer changes are included above; the original intake is
not a claim that all current files still match 0.1.23. Unrelated primary WIP,
including deleted release installer/packager tests, remains outside this delivery.

Child Transcript and Run projections come from the service, including connection,
queue and approvals. Approval responses bind the pane's endpoint; pending reads
cannot populate another selected parent. The contract is defined in AgentKit's
`docs/web-family-contract.md`. Artifact/file advanced previews remain outside this
delivery slice.

## Independent maintenance and runtime dependencies

[PR #15](https://github.com/TekesApps/TekesWebUI/pull/15) merged private bridge
failure diagnostics, newline frame-limit enforcement and mounted-view Earlier
completion/error fencing into main `fbdbdaa4d80c150da44fa4d4af65378557ee2d54`,
based on `03b1966`. Maintenance version 0.1.24 retains DTO `f1daa0f` and Kernel
0.9.3 pins; this candidate absorbs that main while retaining its own 0.2.0 version,
DTO589 and public018 pins. Its only history
operation is the already available `earlier` response `{loaded:boolean}`; it adds
no AgentKit method, presentation field or Harness capability. The stronger
connection-epoch fence remains in this delivery candidate. This maintenance was integrated
independently under #55/#58, without treating the AgentKit stage's performance
failures as a blocker for these fixes. Its 0.1.24 maintenance release is published; publication does not establish a
daily-entry upgrade. It does not
enable the broader family/permission/queue delivery.

[PR #16](https://github.com/TekesApps/TekesWebUI/pull/16) subsequently merged the
binary-only startup fix into main `feb38f0c2117ab28c1b4a99ab99b6cadc2fb5eff`.
Its 0.1.25 package is prepared against that source; publication remains separate.
This candidate includes that main while retaining 0.2.0, DTO589, Kernel018 and
the canonical credential setup below. Canonical setup was not added to maintenance.

The complete PR #14 has a concrete service dependency beyond its public DTO pin:

- Family views need `agent.familySnapshot`, `follow` targets `familyView`/`childView`,
  and `agent.child.open/earlier/prompt/cancel/close`, with scoped handles and
  connection epochs.
- Queue removal needs `agent.queue.remove`, `RunPresentation.scope`,
  `connectionEpoch` and `canUpdateQueue`. Explicit reconnect needs service
  operation `reconnect`; the host must not emulate these operations.
- Permission UI needs the advertised `approvals.policy/mode/select` contract;
  actionable availability and question cancellation consume service-owned
  `responseAvailable` and `cancelOutcome` when present.

These are implemented by the accepted Core dc98950 candidate. Public AgentKit
[main 4cb15a6](https://github.com/TekesApps/TekesAgentKit/blob/4cb15a61ca3dfd860c70a3db13b61b2146c40efe/crates/web/src/lib.rs), inspected on 2026-10-30, lacks
the family/child service dispatch, queue removal and `reconnect` operation. Its
latest maintenance release is now v0.3.9; it still does not contain the stage
family/child/queue/reconnect APIs. DTO `5895071` supplies declarations,
not these running capabilities. The existing launcher freezes a user-supplied
binary hash; it does not install a compatible AgentKit release. Complete delivery
therefore needs the matching service implementation and its applicable #58/#59
integration/release gates, rather than merely changing the Web dependency pin.
The separately published Kernel 0.9.18 is available; that alone does not supply
AgentKit's missing service methods. Existing-runtime configuration and Kernel-pin
changes are outside PR #15's maintenance scope and are not independently claimed
as validated against the older service by the c319/dc evidence.

The startup-only follow-up in `60e0104` fixes two concrete Web intake defects:
binary-only startup no longer requires an unused source checkout, and setup uses
the same canonical configuration mode/default provider as startup. Credential
setup retains the provider/reference/endpoint ownership boundary and does not
rewrite canonical files. Thirteen affected Node checks pass, including real CLI
cold-start/stop/restart and real manager setup with isolated protocol fixtures;
old startup and setup failures remain in the existing raw evidence. Test-fixture
construction failures are retained separately. These checks do not use a real
Keychain, Kernel, model or browser. The `src/`, HTTP, bridge and runtime files are
unchanged, so accepted browser/P1/history evidence remains scoped to c319/dc/05.

Current Core PR75 `b92305005a885ce746a754507acdba22ca1fd5b0` has identical
`crates/web`, contract and DTO inputs to dc98950 at this consumption boundary;
DTO SHA256 remains `23ab36b59f60d98ddcd963a3b55d48326c5ce3c4350c266466f1ee7dad8d2305`.
This confirms that no Web declaration update is needed; it is not a new runtime
acceptance claim for b923. Final Native consumer startup, cold credential binding
and release input conditions are in [local service](local-service.md#final-native-consumer-and-release-conditions).

## Version-scoped verification and remaining delivery

The reviewed functional Web candidate is `c319de5b5e4249ca0bfd3850ab971ca67b83f97e`,
paired for the accepted Native subsets with Core
`dc98950f3256e9a68cc9641426c6b00122d85a1c` and published Kernel 0.9.18 /
`1a7e5367781c4a7ada51a57330e4772dd54fc182`. On c319, 134 tests passed, zero
failed and one original opt-in pipe test was skipped. Build and scoped formatting
passed; the unchanged strict verifier accepted the actual public Kernel bundle,
including all four executable hashes and compiled identity. Exact-head
[PR CI](https://github.com/TekesApps/TekesWebUI/actions/runs/40834085296) and
[push CI](https://github.com/TekesApps/TekesWebUI/actions/runs/40834078434) passed.
The build retains its existing warning about a minified chunk exceeding 500 kB.
These checks do not execute the configured real-model/browser workflow.

On Core dc98950's local source-bound Web program and public018, the coordinator
has since accepted the [Native P1 permission protocol subset](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6492230643)
and [isolated full-history restart recovery](https://github.com/TekesApps/TekesAgentKit/issues/55#issuecomment-6492336841).
P1 covers catalog/select/readback, structured rejection and mode preservation;
recovery covers all13 events at cut12, five pages per phase, and equal complete
projections after normal restart. These are public-protocol results, not browser
rendering, tool enforcement, manual-instance recovery or performance acceptance.

The coordinator subsequently accepted the finite Native browser
[P2–P4 permission/draft subset](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6495941549)
and [C1/C2 child navigation subset](https://github.com/TekesApps/TekesAgentKit/issues/74#issuecomment-6495941974)
on that same Web c319/Core dc98950/public018 identity. The actual Core executable
was the local committed-source build SHA256
`05f5d5f5e695ad81a6b0432c0d5a30d6e2c6b1dbcbd25b5f838cd6b986dda319`,
not the separately compiled public-Git consumer. A newly owned, browser-permitted
entry used normal product login and reused one completed synthetic Task/child.
Observed UI results cover rejection without admission and with draft retention,
first-Send stale-mode refusal, late permission reply isolation with distinct modes,
and the same child's read-only result/source with parent draft preserved through
Back/Close/reopen. Reopening obtained a different public handle. No new Task or
prompt was submitted; all five owned processes exited normally and were absent.
Raw CUA/AX, screenshot, relay/Core outputs and cleanup remain in the existing
`web-native-browser-fixture-20261029/real-delivery.json` Browser evidence. The
prior protocol snapshot and driver failures remain preserved. The short child
reached EOF; this is not long-history pagination or performance acceptance.

Earlier actual Family, permission, queue and recovery slices exist, with their
original Core/Web/Kernel identities in AgentKit
[#73](https://github.com/TekesApps/TekesAgentKit/issues/73) and
[#74](https://github.com/TekesApps/TekesAgentKit/issues/74). They are not relabeled
as c319/dc98950/018 acceptance. The old f5 pipe consumer, failures and skipped-test
records also retain their original identities.

See [Web acceptance responsibilities and full-history recovery](delivery-acceptance.md)
for the remaining gates. The original manual instance at port 50114 still has no
permitted full-history restart acceptance; #56 retains seven applicable performance
failures and twelve `not_run` cases. The candidates are not merged or released, and
the daily entry has not been upgraded. The unique current delivery status is
[AgentKit Epic #14](https://github.com/TekesApps/TekesAgentKit/issues/14).
