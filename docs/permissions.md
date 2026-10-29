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
`ece62fb7648ef87d45530baff33fa97e90120bd2`. Web c319's unit/build/CI results are
listed in [delivery integration](agentkit-delivery-integration.md). In particular,
`tests/workspace.test.ts` covers readback before admission, failed-update draft
retention, destination fencing, unknown modes and a policy changed by another
client. These checks do not prove actual Harness enforcement.

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

Those slices do not establish c319/ece/018 browser, real-model or full three-Harness
acceptance. Final applicable live checks and integration remain open under #73,
#55 and #58; see the [remaining responsibilities](delivery-acceptance.md).
Failures never authorize automatic mutation retries or guessed effective modes.
