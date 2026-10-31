# Composer permissions

AgentKit owns `PermissionOption`, `PermissionPolicy`, `PermissionState` and
`PermissionModeState` in `tekes-agent-contract`, including the generated TypeScript
exports. Values are opaque Harness inputs, not browser-enforced sandbox rules.
All adapters expose `approvals.policy`, `approvals.mode` and `approvals.select`.

- Kernel: passthrough to the existing Kernel 0.9 public APIs. The running published
  bundle advertises Read Only, Workspace Write and Full Access. No Kernel changes.
- DSH: declare the same three choices as ClientKit, preferring any explicit session
  catalog. Read `permissions.currentValue` from the opening public `session/follow`
  snapshot. Select using the native `/permission` command. No private logs/database
  access and no inferred default; `custom` has no selectable named preset.
- Pi: match ClientKit's Allow Tools, Ask for Each Tool and Block Tools. Atomically
  persist the selected mode in the adapter-owned session policy file. The public Pi
  extension `tool_call` hook reads the current policy for every invocation and
  blocks or asks through the existing actionable path. Malformed policies fail
  closed. Forks and subagents inherit the parent's mode at creation. These are tool
  approval modes, not aliases for filesystem sandbox modes.

Web renders the advertised catalog. A new-chat choice stays local to that draft
until creation; selection and readback must succeed before sending a prompt.
Existing-session changes show only the effective readback. Failure retains the
input and prevents admission. Responses are fenced by destination/generation.
Before submission, another mode read detects a policy changed by another client;
the user reviews the new value before explicitly resending. No mutation retries
are automatic. Modes do not expand the host's existing execution roots/network
capabilities, and the host does not replace the Harness permission decision.

## Validation status

The consumer pins the public declaration archive at
`58950714b1c48f21c1465b929d3fb795f6f03ce2`; no local declaration override is
required. The declaration file is unchanged in Core candidate
`dc98950f3256e9a68cc9641426c6b00122d85a1c`. Web c319's unit/build/CI results are
listed in [delivery integration](agentkit-delivery-integration.md). In particular,
`tests/workspace.test.ts` covers readback before admission, failed-update draft
retention, destination fencing, unknown modes and a policy changed by another
client. These checks do not prove actual Harness enforcement.

The coordinator accepted the [Native P1 protocol subset on dc98950/public018](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6492230643),
using the local source-bound Web program recorded in
[delivery acceptance](delivery-acceptance.md). An actual invalid selection now
returns the structured remote `invalid-request`; effective mode remains
`read-only`, and explicit restoration reads back `workspace-write`. The adapter
fix retains structured non-200 HTTP-carrier errors while keeping RPC correlation
mandatory for normal server responses. Original correlation-error failures and
the initially incorrect passed receipt remain preserved alongside the red/green
fix evidence. Live HTTP wire bytes were not captured: that branch is verified by
the HTTP fixture and public specification, not described as a live packet trace.
P1 made zero prompts/provider requests and all owned processes exited.

The coordinator also accepted the [finite Native browser P2–P4 subset](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6495941549)
on Web c319, the same local dc98950 executable (SHA256 `05f5…`) and public018.
A new owned synthetic entry was actually permitted by the browser tool and used
normal product login. P2's explicit fixture rejection retained the Chinese draft,
forwarded no select and admitted no prompt. P3's second public client changed the
mode; the browser's first Send reported the change and retained the parent draft.
P4 held a real select while navigating: after its Workspace Write reply, the
other target still showed Read Only with its independent draft and no inherited
error/loading state. The initial equal-mode observation is retained; the distinct
values provide the decisive isolation evidence. No Task or prompt was added, and
all five owned processes retired. The old refused manual entry was not accessed.

Version-scoped real slices are recorded in AgentKit #73:
[Pi 1.3.0 tool blocking/ask allow/deny](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6417310220)
and [question responses](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6418184525)
used Core372; [DSH mode readback](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6417864795)
used Core4fd; [Native browser approval](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6443545856)
used Core3e6c/Webcd7283/Kernel012. Later
[history-fault/control separation](https://github.com/TekesApps/TekesAgentKit/issues/73#issuecomment-6482814207)
used Corede7/50ae and Web41e9/Kernel017. Each slice retains its exact program and
raw evidence. The initial disconnected-pipe
attempt and subsequent capture failures remain historical failures; they are not
the current result for every Harness.

The accepted Native browser subset does not establish real-model quality, actual
tool enforcement or full three-Harness acceptance. Original manual-instance
recovery, performance and final integration remain separate under #55, #56 and
#58; see the [remaining responsibilities](delivery-acceptance.md).
Failures never authorize automatic mutation retries or guessed effective modes.
