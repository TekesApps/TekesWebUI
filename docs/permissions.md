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

This consumer requires the immutable AgentKit contract pin for the delivery
candidate. That public version is not available yet, so dependency installation,
tests, browser checks, and live Harness checks have not been run for this slice.
Do not use a local package override as release evidence. Once the exact public pin
is available, validate through `npm ci` and the candidate's recorded verification
matrix.
