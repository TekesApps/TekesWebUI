# AgentKit thread action ownership

The Mac ClientKit sidebar is the behavior reference. The action catalog now lives
in AgentKit's shared presentation module, not in the browser:

1. Pin or unpin.
2. Rename when the endpoint supports it.
3. Fork the conversation.
4. Copy session ID using the host's session URL scheme.
5. Archive, or supported unarchive for an archived conversation.

`thread.actions` returns the public `ThreadActionsPresentation` for an exact
endpoint/session. It owns ordering, labels, semantic icon roles, interaction kinds,
enabled states, disabled reasons, and clipboard content. The generated
`@tekesagentkit/client-contract` package is locked to public AgentKit commit
`a1cd0a36e4f9bc95595111834fff2f95d66f3452`. It also supplies the unchanged annotation
DTOs; the older annotation-only dependency is no longer needed by Web.

`SessionActions` renders the returned array in both the sidebar and header. Its
only interaction strategies are a text-input dialog, a user-initiated clipboard
write, and dispatch of the returned action ID through `thread.performAction`.
It has no hardcoded action list, per-Harness menu branches, archive eligibility
rules, or private pin preferences. Semantic icon roles map to the public TekesUI
catalog. New action IDs using an existing interaction need no Web menu change.

AgentKit revalidates current authority before dispatch. Outcomes carry navigation,
selection clearing and rename receipts. A delayed result never replaces a newer
browser selection; an uncertain mutation is never automatically retried. Explicit
retry preserves the RPC identity. Fork outcomes retain the created child pointer
if follow-up title assignment fails, so failure cannot trigger an accidental
second fork.

AgentKit v0.3.4 persists only pin relationships through `ThreadPreferences`.
The host supplies a private path and stable account/workspace scope. Version 1
pin data migrates without losing relationships; previous display order and move
receipts are discarded. `ThreadPinPresentation` contains only `pinned: true`.
The service no longer advertises or dispatches move-pin actions. All consumers
receive relationship changes through the existing inventory stream.

Web owns grouping (`folder`, `status`, `none`) and sorting (`recentActivity`,
`titleAscending`, `titleDescending`). The same selected sort applies to the pinned
section. These preferences are saved only in this browser; legacy true/false
grouping values migrate locally. No group labels, order or preferences are sent
to AgentKit. The Web list menu exposes the choices under 分组 and 排序.

AgentKit's generated `ThreadActivity` provides status facts with an `isStale`
flag. Web assigns group names and visual order. Idle and unknown are separate
from completed, and stale facts appear under 状态待更新. It does not infer completion
from absence of running work. Waiting, queued, failure and cancellation retain
separate groups. Pinning does not change a thread's underlying activity.

Archived sessions are not currently listed
by Web's active inventory; the shared definition supports unarchive when a
consumer supplies an archived row and the endpoint supports the operation.

The original Swift Mac menu entry point is still in ClientKit. This change gives
Web and other consumers one shared AgentKit definition; it does not claim that
the existing Swift entry point has already been migrated to this service API.

Validation covers shared menu order, pin callbacks, archive state/capability
changes, target identity, unknown action rejection, partial-success fork results,
generic Web dispatch, stale navigation, and stable explicit retries. A separate
Rust example consumes the same public definition without Web code.
