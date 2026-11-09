# Three-Harness Web delivery

## Authorized batch (2026-11-09)

Deliver the existing WebUI with Kernel, Pi and DSH through AgentKit's public
contracts. Preserve all historical failures, WIP and unexecuted checks. This batch
includes archive recovery, commands/skills, supported queue editing, Goal,
message feedback, Harness settings, context details and host-owned Files/Git
controls. Shared AgentKit interfaces and their implementations must also be
usable by future TekesUI consumers. It audits Kernel public capability coverage. No TekesUI/native
rendering changes or daily-instance data migration belong to this batch.

## Responsibilities and interaction

AgentKit normalizes Harness contracts and owns session/presentation authority.
The authenticated local host owns credentials and process lifetime. Web components
consume public catalogs and scoped receipts. They never read private Harness data.

Kernel source changes require separate user confirmation. Existing public calls
are in scope. Kernel policy settings are not a general system-instruction editor.
Pi settings remain read-only where the current adapter has no supported write
contract; upstream SDK setters are not evidence of a working RPC mutation.

WorkspaceService is separate from SessionRuntime. AgentKit supplies its shared
contract and injectable endpoint; the local Web host consumes the same contract
and owns root registration, operation grants and the version-bound private
`tekes-workspace-service` helper. The Web path is browser → authenticated host →
helper, not a removed Kernel HTTP route. Browsers submit only opaque registered
IDs and relative paths. They cannot choose roots, credentials or executables.
File writes require the observed revision. Git mutations require explicit host
grants. Durable mutation receipts prevent re-execution after a lost reply;
unknown outcomes are not silently retried. Turn-change facts are not advertised
without an actual producer. Git diff cannot stand in for a turn's edit history.

Future native hosts consume AgentKit shared interfaces and state. ClientKit is
deprecated and is not a component or delivery dependency of this path. Completing
Web controls does not itself constitute native App integration or acceptance.

Harness-owned public capabilities take precedence within each adapter: Kernel
for Native, Pi for Pi, and DSH for DSH. This also applies to Files/Git where an
external consumer API actually exists. Model tools or private implementation
modules do not establish a public UI service. The current local WorkspaceService
is explicitly a host implementation using the version-bound helper; it is not
represented as three separate Harness implementations. DSH session files use its public list/stat/readBytes contracts through AgentKit;
they are read-only, epoch-bound, and never fall back to local files on error.
Pi exposes model file tools and Bash RPC but no typed Files/Git RPC; its file
panel therefore remains an explicitly selected host service. DSH per-turn
change summaries/diffs are distinct upstream capabilities, not current Git
working-tree operations, and are not implemented in this release.

- Archived sessions come from a public inventory snapshot and retain endpoint and
  session identity. Restore uses the existing advertised thread action. Active
  and archived navigation are explicit views; restored rows return to active.
- Commands and skills load on demand for the selected session. Commands execute
  through advertised public commands methods, separately from ordinary input.
  Skills use their actual public insertion/invocation semantics; listing does not
  imply arbitrary tool configuration or installation support.
- Queue edits bind the original endpoint, session, item identity and connection
  epoch. Existing drafts remain isolated. Expose steer or reorder only when the
  Harness contract explicitly supports that operation.
- Goal controls show typed objective/status/budget information and supported
  edit/pause/resume/clear actions. Do not emulate a Goal engine in the browser.
- Every asynchronous read is scoped to the initiating address; stale results
  cannot modify another session. Mutations are never automatically retried.
  Unknown outcomes remain visible; closing observation does not cancel work.

## Remaining public capability consumers

These are part of the authorized shared-interface scope, not claims of completed
implementation. Track navigation under AgentKit #42, shared services under #37,
commands/resources under #66, and the Web consumer under TekesWebUI #17.

- Name search uses the advertised `thread.search` contract, separate from the
  existing local list filter. Bind query, visibility, endpoint, epoch and cursor;
  preserve upstream ordering and normalize snake_case result fields. A stale
  cursor requires an explicit fresh search, never an invisible query change.
- SideChat reuses the existing shared SideChatController and history leases.
  Each temporary fork owns its draft. Explicit close cancels running work, waits
  for authoritative settlement and then discards. Failed discard keeps the pane;
  disconnect and parent navigation do not implicitly close it. Every mutation is
  fenced at dispatch by the originating connection epoch. Unsupported DSH
  temporary forks remain unavailable rather than being emulated by a normal chat.
- Tools and skill resources are read-only catalogs/details. Resource reads use
  returned session-bound references and content digests; they do not read local
  paths. Tools have no install, enable or invoke action in this contract.
- Advanced Kernel presets use typed layers/limits and an explicit resolve
  preview before creation with the same selection. The host supplies the same
  authorized execution context to preview and create. Structured presets exclude
  identityProfile and do not grant new filesystem, network or MCP authority.
  Pi/DSH retain their separate supported preset contracts.
- Recovery reuses the current SessionRuntime path. Inventory membership alone is
  not recovery interest. Validate the actual returned IDs and retain partial,
  rejected or unknown outcomes separately from connection readiness. Unknown
  mutation outcomes must not become automatic retries after reconnect.

## Verification and release

Reuse exact unchanged evidence. Test changed contracts and reachable failures,
including stale responses, unsupported capabilities, failed mutations, archive
restoration, queue identity and session draft isolation. Validate AgentKit, the
existing Web host and a second public-contract consumer. Run complete compatible
CI after freezing the candidate. Bind release pins to immutable source.

Real Pi/DSH browser acceptance must cover send/stream, Stop with immediate click
while running, reopen/recovery without duplicate input, history and newly exposed
controls. A controlled local model may validate action sequencing but cannot
replace required real-model acceptance. Record exact model request budgets before
execution and never silently reuse exhausted historical quotas. No additional
performance experiments are implied.

The coverage matrix must distinguish supported/consumed, supported/no consumer,
Harness-specific, host-owned and unverified capabilities. Missing functionality
cannot be represented as upstream unsupported or as completed acceptance.
