# Kernel public capability coverage — 2026-11-09

Source witness: Kernel 0.9.22 (`992ebca`), AgentKit adapter candidate `7980f62`,
WebUI source `43dee2d` before this batch. This table records gaps, not a claim of
complete support. Session Endpoint registers 51 unary methods (13 base, 38
extensions); the historical spec count of 37 extensions is stale.

| Public capability                                              | Existing consumer                    | Batch work / remaining gap                                                                                               |
| -------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Session create, rename, ordinary fork, archive, prompt, cancel | Web navigation, composer and actions | Archive inventory/restore candidate implemented; SideChat consumer in integration                                        |
| Model catalog/select and reasoning effort                      | Composer                             | New Pi/DSH browser validation required                                                                                   |
| Attachment policy/upload/retrieval                             | Composer/transcript                  | New Pi/DSH browser validation required; this does not cover a general file browser                                       |
| Preset describe/resolve/initial selection                      | Composer initial preset              | Typed structured preset editor/preview/create in integration; execution remains host-owned                               |
| Commands and skills                                            | Adapter routes                       | Catalog, command execution and skill draft selection implemented; final browser acceptance pending                       |
| resources/list/read, tools/list/resolve                        | Generic transport only               | Native declarations and read-only tools/Skill resource consumer implemented; final acceptance pending                    |
| sessions.recover                                               | Adapter route                        | Explicit-interest runtime recovery and receipt consumer implemented; pending-call disconnect regression under correction |
| Approvals policy/mode/select/respond                           | Permission selector and ActionCard   | Preserve per-Harness authority                                                                                           |
| feedback.list/put/delete                                       | Adapter route                        | CAS-bound message feedback/notes consumer implemented; final acceptance pending                                          |
| settings.describe/mutate/update/document                       | Adapter route                        | Non-secret Harness settings consumer implemented; Kernel policy applies next launch, not a general instruction editor    |
| goals.get/edit/clear/pause/resume                              | Adapter routes                       | Typed controls implemented; create/resume may execute models, no implicit live-test allowance                            |
| subagents.list/history                                         | FamilyPanel                          | Kernel bounded children remain read-only by contract                                                                     |
| session.files.stat/read/readBytes                              | Typed runtime routes                 | Independent host-owned file consumer implemented; explicit registration/grants, no Kernel HTTP WSE claim                 |
| session.search, thread.search                                  | Session search                       | Typed title-index search with visibility/cursor implemented; separate from local list filtering                          |
| usage.summary/cacheAttribution                                 | Generic transport                    | Native declarations corrected; context and authoritative billing/cache consumer implemented                              |
| contextUsage/contextDetails projections                        | Generic store                        | Context detail consumer implemented; unknown remains unknown and cumulative cost is separate                             |
| Workspace Service tekesWorkspace.*                             | No WSE Web consumer                  | Host-owned Files/Git candidate tested with official helper; turnChanges not advertised without a real producer           |

The historical independent Workspace Service contract includes filesList/filesSearch/filesRead/filesWrite,
gitRepository/gitChangesNavigator/gitStatus/gitBranches/gitDiff/gitLog,
gitChangeBranch/gitCommit/gitPush and turnChanges. The retained helper and historical documentation do not prove that the current
Kernel exposes that HTTP carrier. Live-source inspection supersedes the earlier
document-only claim: only fileTransfer routes remain under tekesWorkspace in
current transport code. A new consumer must use a real host-authorized service.

## Actual upstream limits

- Kernel bounded children have no prompt/cancel API.
- tools/list/resolve are read-only; they do not authorize tool installation or switches.
- Kernel resource browsing currently covers skill resources, not MCP resource/prompt browsing.
- Arbitrary queue reorder has no common contract. Queue editing must preserve
  attachments or explicitly reject the unsupported item; do not silently drop them.
- DSH 0.2.2 exposes Goal creation upstream; the old adapter omitted its route.
  This is an adaptation gap, not an upstream lack of support.

Evidence: Kernel `endpoint_host.rs`, `client_extensions.rs`,
`docs/workspace-service-wse.md`; AgentKit `crates/endpoint-kernel/src/lib.rs`,
`crates/web/src/lib.rs`; WebUI `src/workspace.ts`, `src/components/Sidebar.tsx`.

User boundary: any Kernel source change requires separate user confirmation. Shared AgentKit capabilities must remain reusable by future TekesUI hosts; Web rendering is a separate consumer.
