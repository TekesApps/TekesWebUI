# Existing local runtime

TekesWebUI's TypeScript CLI can reuse the runtime paths already stored by the
existing host. It does not download, package, deploy or install a second runtime.
Node.js 22.12+ (or 20.19+) is required.

## Daily commands

From the TekesWebUI project:

```sh
npm run setup    # Once: import saved configuration and configure Keychain
npm start        # Background startup and authenticated browser opening
npm stop
npm run status
npm run open
```

`npm start` is idempotent: an already running service is opened without a restart
or a second service. `npm start -- --no-open` skips opening the browser. Closing
the browser or terminal does not stop work. Restart with `npm stop` and `npm start`.
There is no launch-at-login service or automatic deployment/update in this change.

For a Native-only service, stop the current service and use
`npm start -- --harnesses native`. This selection is saved for subsequent starts;
`npm start -- --harnesses native,dsh` or `native,pi,dsh` explicitly enables those
additional Harnesses. Omitting the option retains the saved selection; legacy
configurations keep all three enabled. Native remains required by this local
Kernel launcher. Unknown, empty or duplicate selections fail. Changing a running
service's selection requires stopping it first.

A disabled Pi or DSH is not initialized: its registry, runtime, provider selection
and connection credentials are not loaded. Existing paths, configuration and
Harness data are retained for later re-enabling. Enabled Harnesses keep their
normal validation and readiness requirements. The low-level host accepts the
same `--harnesses` option, including with otherwise saved launch references.

Setup imports the existing private `start-options.json` into
`~/.agents/client/agent-web/service-options.json`. This small configuration contains
references to the existing binaries, assets, workspace, settings and data roots;
no runtime binaries or Harness databases are copied. Existing threads and shared
pins remain in their existing locations.

Setup follows the same Kernel configuration mode as startup. For existing canonical
configuration it uses the default provider's `credential_key`; it does not project
the old DeepSeek-only settings into that roster. An existing WebUI-owned Keychain
credential is reused. The configured environment key is accepted only when the
legacy provider id, credential reference and endpoint match that canonical provider;
otherwise setup asks for the selected default provider's key. A provider without a
credential reference needs no key; without a canonical default, setup leaves provider
credentials unchanged. Other providers keep their existing credential availability.

Setup saves only to WebUI's own macOS Keychain service, separate from Tekes App's
protected items. Keys pass to `security -i` through stdin, never arguments or config
files. A new key is bound on the next cold start; setup does not restart a running
host or replace a live Kernel bootstrap. macOS may request Keychain access.

Use `open` instead of entering a bare URL: the private launcher supplies the
current browser token. Restart rotates the token. HTTP stays on loopback with
Host/Origin checks and App-only authentication for DSH pairing.

## Runtime boundaries

The local service verifies the pinned Kernel 0.9.22 bundle, source revision and all
four binary hashes. Use `TekesKernel-0.9.22-macos-arm64.tar.gz` from the official
Kernel release and verify its SHA-256 sidecar. The source revision is
`992ebca52c9fd1026357dd141b10b5a4fbea8a3d`. This release preserves durable user Stop
through recovery, so the public terminal reason remains `aborted`, and retains
remote-task cancellation delivery while reading the cancellation reply.

AgentKit's Pi adapter starts per-session stdio RPC processes on demand,
using the installed Pi runtime. DSH connects to an existing external service; it is
not launched by this CLI. Native UI is not required.

On macOS the directory button invokes the local OS folder chooser. Only a confirmed
canonical directory is granted as the Kernel session's cwd/read/write roots, while
tool/network policy remains intact. The directory chooser grants session execution scope; WorkspaceService root registration remains an independent host decision.

## Runtime consumer and release conditions

WebUI 0.3.0 uses the shared service operations listed in
[delivery integration](agentkit-delivery-integration.md#independent-maintenance-and-runtime-dependencies).
Use the immutable AgentKit 0.5.0 Core executable and the pinned public Kernel
0.9.22 cohort. The declaration archive alone cannot supply the runtime operations.
The immutable declaration dependency in package.json/package-lock.json includes the public WorkspaceService subpath. It does not identify the running executable. Keep the release source revision and binary hashes
with the installed cohort; do not substitute a private candidate manifest for the
published-runtime checks.

Build this UI/CLI, then use the Native-only command below with the accepted binary
and an owned host-state directory. The referenced canonical Kernel data root must
have a single owner: do not cold-start a second Supervisor on the same live root.
Changed binaries/assets are adopted by a cold start after the owned service is
idle and stopped; idempotent `start` on an already running service only opens it.
No accepted P1/history/browser result authorizes access to the refused original
manual instance. Final tag/main identity, published assets and entry upgrade remain
coordinator-owned under #58/#59, separately from the completed Native UI subset.

## Existing Native configuration

Native defaults to `~/.agents`. Existing `config/providers.json` and
`config/settings.json` are authoritative: the host uses Kernel's `existing`
configuration mode, omits the provider document from the launch request, and
never republishes either file. Existing formatted JSON is validated and normalized
only in memory; its original bytes remain untouched. The configured default model is retained. A
missing or invalid document fails startup; there is no fallback to a new empty
profile. No historical threads are moved.

Only credentials already owned by WebUI or explicitly matched to the configured
provider id, credential reference and endpoint are bound through the private
bootstrap pipe. Other providers remain configured and report unavailable
credentials when used. Tekes App's protected Keychain is not accessed by this
service. Pi uses its own selected provider and original registry/session root;
DSH uses the saved external connection and its own durable data.

`--kernel-configuration-mode existing` makes this behavior explicit. `auto` also
selects it whenever either canonical config file exists. `provided` is reserved
for a fresh, explicitly isolated fixture root and is rejected for `~/.agents`.

## First-time developer configuration

A machine without saved host configuration still needs explicit existing binaries
and settings once. An AgentKit source checkout is optional; `--agentkit-source`
is retained as an explicit developer reference. Build the TypeScript UI/CLI and provide those developer inputs:

```sh
npm ci
npm run build
npm run host -- start \
  --agentkit-binary /absolute/path/to/tekes-agent-web \
  --kernel-binary-dir /absolute/path/to/BuiltInKernel \
  --runtime-dir /absolute/path/to/owned-web-state \
  --kernel-configuration-mode existing \
  --harnesses native --port 0
npm run setup -- --runtime-dir /absolute/path/to/owned-web-state
# On this newly configured idle host, cold-start to bind a newly saved key:
npm stop -- --runtime-dir /absolute/path/to/owned-web-state
npm start -- --runtime-dir /absolute/path/to/owned-web-state --no-open
npm run open -- --runtime-dir /absolute/path/to/owned-web-state
```

Daily use then needs only the short commands. AgentKit is frozen by content hash
as before; supplying an already frozen binary reuses that exact existing file.
For local development, `--in-place` uses the supplied binary directly and saves
that choice for daily starts, without creating a binary copy. Finish rebuilding
that binary before starting the service.
`--runtime-dir` isolates a test instance. Other advanced overrides remain available
through `npm run host -- …`; ordinary use reads the saved configuration.

`npm test` exercises the daily commands against isolated protocol fixtures, without
running models or changing live sessions. `TEKES_AGENTKIT_BINARY=/path/to/binary
npm test` also exercises the real published AgentKit pipe. Manual browser/native
dialog and real model acceptance are separate from these checks.

Kernel 0.9.7 also distinguishes retired endpoint projection caches from semantic
ledgers during recovery. It retains strict rejection of damaged semantic history;
this is not a general data repair or a database migration.

Kernel 0.9.8 exposes recognized pre-tool-catalog development histories as read-only
through the public endpoint, including bounded pagination. Missing tool catalogs
still prevent execution: the service does not fabricate catalog facts or rewrite
historical messages. AgentKit shared presentation consumes `historyAccess` to
disable mutations while retaining readable transcripts. Unknown historical formats
continue to fail closed.

## Files and Git authority

Files/Git use a host-owned WorkspaceService, independent of the selected Harness.
The default registry exposes only the configured workspace with read access.
An embedding host can supply `Options.workspaceService.workspaces`; saved private
service options preserve the same configuration. For example:

```json
{
  "workspaceService": {
    "workspaces": [
      {
        "id": "project",
        "title": "Project",
        "root": "/absolute/path/to/project",
        "allowRead": true,
        "allowFileWrites": true,
        "git": {
          "operations": ["commit", "branch.create", "branch.switch"],
          "repositories": [""]
        }
      }
    ]
  }
}
```

Only configure grants for the intended project. `push` is a separate explicit
operation grant. Repository paths are relative to the registered root; the empty
path denotes its root repository. Browser requests cannot change this registry
or provide execution roots or helper credentials. The service verifies the
version-bound helper from the Kernel bundle without changing Kernel source or
restoring any historical Kernel HTTP endpoint. Overlapping registrations share
locks while keeping grants separate. Unknown mutation results require explicit
inspection; reconnecting never replays them.

Turn-change facts are not advertised without a real producer. Git diff is not
a replacement for per-turn change history. These options do not change existing
service data or grants until the owning host is explicitly configured/restarted.
