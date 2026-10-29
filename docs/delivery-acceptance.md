# Web delivery acceptance

This is a finite handoff snapshot dated 2026-10-29. The unique current status is
[AgentKit Epic #14](https://github.com/TekesApps/TekesAgentKit/issues/14); this
document neither closes the linked Issues nor replaces their acceptance criteria.
The functional source under review is Web
`c319de5b5e4249ca0bfd3850ab971ca67b83f97e`, Core
`dc98950f3256e9a68cc9641426c6b00122d85a1c`, public Kernel 0.9.18 /
`1a7e5367781c4a7ada51a57330e4772dd54fc182` and declaration pin
`58950714b1c48f21c1465b929d3fb795f6f03ce2`. Package 0.2.0 remains a candidate.

Two Native protocol subsets are now coordinator-accepted on that Core commit's
local source-bound Web executable SHA256
`05f5d5f5e695ad81a6b0432c0d5a30d6e2c6b1dbcbd25b5f838cd6b986dda319`
and actual public018. This is a local committed-source build, not a published
binary or independent public-Git consumer result:

- [P1 permission protocol](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6492230643):
  catalog/select/readback, invalid selection's structured remote error, unchanged
  mode and explicit restoration; zero prompts/provider requests and owned exit.
  The original correlation failure, incorrect passed receipt and repair evidence
  retain their identities. This does not prove browser behavior or tool enforcement.
- [Complete isolated recovery](https://github.com/TekesApps/TekesAgentKit/issues/55#issuecomment-6492336841):
  two completed synthetic turns; frozen cut12, all13 events, five real cursor pages
  to EOF before and after normal restart; complete event payloads, SessionProjection,
  Transcript and source projection equal. Recovery used no `op:call`, provider
  count did not increase, and owned processes exited. [#56 records the same scoped result](https://github.com/TekesApps/TekesAgentKit/issues/56#issuecomment-6492336343)
  while retaining its original performance failures and unrun cases.

## Responsibilities and remaining gates

| Issue                                                                            | Web responsibility and existing checks                                                                                                                                                                                                               | Remaining acceptance or integration                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#55: protocol/recovery](https://github.com/TekesApps/TekesAgentKit/issues/55)   | Consume public projections, retain errors, preserve drafts, never retry uncertain mutations. `api.test.ts`, `workspace.test.ts` and `queue-controls.test.ts` cover these consumer boundaries.                                                        | Native P1 and isolated full-history protocol subsets above are accepted. Applicable browser/model, original manual-instance recovery and Core-owned performance gates remain open. Prior failures/unrun cases and the three-end Issue remain.            |
| [#73: permission contract](https://github.com/TekesApps/TekesAgentKit/issues/73) | Immutable public DTO consumption, advertised modes, readback before send, failed-update draft retention and destination fencing. See `permissions.test.ts`, permission cases in `workspace.test.ts` and [permission evidence scope](permissions.md). | Latest-program applicable browser/permission invalidation and failed-draft checks; each Harness's actual enforcement is separately source-bound. Core owns authority, hooks and adapters. Main integration remains required.                             |
| [#74: tasks/children](https://github.com/TekesApps/TekesAgentKit/issues/74)      | `FamilyPanel` consumes shared Summary/catalog/Run/Transcript, validates endpoint/parent/child/handle/epoch and keeps parent drafts separate. Workspace tests cover child draft scopes and approval endpoint fencing.                                 | Applicable live child/page/navigation checks on the final program. Prior Native read-only child evidence cannot establish DSH/Pi continuation or approval, or latest-candidate browser acceptance. Core validates stale handles, cuts and legal actions. |
| [#58: integration](https://github.com/TekesApps/TekesAgentKit/issues/58)         | Supply exact-source review, public-pin/bridge compatibility, Web CI, preserved WIP and version-scoped evidence. The c319 local/build/CI results are linked in [integration](agentkit-delivery-integration.md).                                       | Final affected acceptance and review; coordinator merges the selected scope and verifies main CI. Passing draft-head CI alone is not integration.                                                                                                        |
| [#59: release](https://github.com/TekesApps/TekesAgentKit/issues/59)             | Document pins, candidate status, consumer instructions and unverified scope; retain the strict public Kernel verifier.                                                                                                                               | Coordinator records exact merged/tested release source, immutable tag/artifacts and main CI, then performs the authorized entry upgrade. No release or daily-entry upgrade has occurred here.                                                            |

The current source already separates live controls from history errors, exposes
explicit reconnect and fences Earlier completions to their mounted view. The
reconnect and Earlier tests in `tests/workspace.test.ts` check those Web behaviors.
They do not substitute for the corresponding live source/runtime evidence.
No browser-owned Run, queue, permission or child state machine is introduced.

For the selected Native delivery, the remaining browser batch is finite: permission
failure draft/no-admission, stale mode readback before Send, late permission reply
after navigation, and one actual Task/child reused for source/readonly/parent-draft
navigation. Reuse unchanged deterministic stale-handle/epoch/page tests; collect
only affected missing browser behavior. No repeat of accepted P1 or isolated
full-history recovery is required without a relevant change. This does not waive
the original applicable performance failures or final review/CI/consumer/main
gates. Pi/DSH, desktop and the inaccessible original manual instance are separately
scoped work, not additional cases in this Native browser batch. A Native delivery
does not automatically close a linked Issue's remaining three-end criteria.

## Full-history recovery protocol

This protocol can be validated independently on an authorized isolated fixture
using the existing public AgentKit boundary. It does not grant access to another
instance. A prior browser-tool URL refusal remains in force: do not use an HTTP
client, alternate browser, private data or process inspection to bypass it. Do
not stop or inspect the user's manual instance as part of this protocol.

Before collection, record the actual source/program/runtime hashes and obtain a
legitimately supplied public endpoint descriptor through an authorized entry.
Keep its bearer private. The existing Core JSONL boundary is its parent's private
stdin/stdout; there is no external attach socket. CLI `status` reports saved host
presence, not idle, full history or safe interruption. It exports no independent
Kernel descriptor. Missing entry authority is an explicit collection blocker.

1. Use public endpoint and snapshot/view reads to establish current authority for
   every relevant session: ready control/inventory/actionables/history, idle Run,
   empty queue, no pending actionables or jobs. Unknown, loading, stale or error is
   not idle. Preserve the frames; do not cancel, remove or send to manufacture
   idle. A retained idle frame is not a perpetual guarantee: keep the isolated
   fixture quiescent and recheck immediately before an authorized restart.
2. Read a fresh target `session-journal` baseline through `follow`. Freeze its
   actual `throughSequence` as cut C. Record its session, generation and source
   identity. A historical prefix cut must not replace a newer current cut.
3. Request public `history` pages with the same endpoint/session/C and a positive
   `maxMessages`. If `hasMoreBefore` is true, the next `beforeSequence` is the
   preceding page's **first** sequence. Preserve every full correlated request and
   response. Reject non-progress, overlap, wrong scope/cut, missing pages or errors.
   Finish only on explicit `hasMoreBefore=false`; a cached tail is insufficient.
4. Release read observations with `cancelObservation`, not a business cancellation.
   After the isolated fixture is freshly confirmed idle, use its normal authorized
   owner lifecycle to restart. Record owned process retirement and new identities.
   Do not start another Supervisor over a live data root.
5. Through a fresh permitted public connection, paginate to EOF at the **same C**.
   Compare the complete entry union in ascending order, including original event
   identity and payload. Check both the retained original prefix and all entries
   added before C. Neither a matching prefix nor a matching count proves full
   recovery. If newer events now exist, retain and report them separately without
   changing C or deleting data.
6. Record browser rendering/reopen separately if browser acceptance is in scope.
   Protocol equality, authentication, UI rendering and performance are distinct
   results; an offline comparison proves only equality of its supplied captures.

The prior recovery handoff's offline comparator and six checks, including rejection
cases, remain retained. The original manually owned instance still has no permitted
live entry or full-cut before/after restart capture; its recovery remains unverified.
The accepted isolated fixture proves only its own data and version scope;
it cannot retroactively establish recovery of the original manual instance.
Earlier Core012/Web13df/Kernel017 captures are not latest c319/dc98950/018 acceptance.
