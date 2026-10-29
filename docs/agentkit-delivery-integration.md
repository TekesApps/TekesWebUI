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

## Version-scoped verification and remaining delivery

The reviewed functional Web candidate is `c319de5b5e4249ca0bfd3850ab971ca67b83f97e`,
paired for the next acceptance work with Core
`ece62fb7648ef87d45530baff33fa97e90120bd2` and published Kernel 0.9.18 /
`1a7e5367781c4a7ada51a57330e4772dd54fc182`. On c319, 134 tests passed, zero
failed and one original opt-in pipe test was skipped. Build and scoped formatting
passed; the unchanged strict verifier accepted the actual public Kernel bundle,
including all four executable hashes and compiled identity. Exact-head
[PR CI](https://github.com/TekesApps/TekesWebUI/actions/runs/40834085296) and
[push CI](https://github.com/TekesApps/TekesWebUI/actions/runs/40834078434) passed.
The build retains its existing warning about a minified chunk exceeding 500 kB.
These checks do not execute the configured real-model/browser workflow.

Earlier actual Family, permission, queue and recovery slices exist, with their
original Core/Web/Kernel identities in AgentKit
[#73](https://github.com/TekesApps/TekesAgentKit/issues/73) and
[#74](https://github.com/TekesApps/TekesAgentKit/issues/74). They are not relabeled
as c319/ece/018 acceptance. The old f5 pipe consumer, failures and skipped-test
records also retain their original identities.

See [Web acceptance responsibilities and full-history recovery](delivery-acceptance.md)
for the remaining finite checks. The candidates are not merged or released, and
the daily entry has not been upgraded. The unique current delivery status is
[AgentKit Epic #14](https://github.com/TekesApps/TekesAgentKit/issues/14).
