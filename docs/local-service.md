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

The provider key is taken from the configured environment (normally
`DEEPSEEK_KEY`), an existing WebUI Keychain item, or a hidden prompt. Setup saves it
to WebUI's own macOS Keychain service, separate from Tekes App's protected items.
Keys pass to `security -i` through stdin, never command arguments or config files.
Subsequent cold starts can read Keychain without entering environment variables
again. macOS may request Keychain access.

Use `open` instead of entering a bare URL: the private launcher supplies the
current browser token. Restart rotates the token. HTTP stays on loopback with
Host/Origin checks and App-only authentication for DSH pairing.

## Runtime boundaries

The local service verifies the pinned Kernel 0.9.10 bundle. AgentKit 0.4.0 remains a delivery candidate until its applicable gates and immutable release pin are complete. Kernel 0.9.10 retains context-tool archive notifications so existing and fresh connections agree on active sessions (#95), and shortens sandbox probe completion waits while preserving confinement checks (#97). AgentKit's Pi adapter starts per-session stdio RPC processes on demand,
using the installed Pi runtime. DSH connects to an existing external service; it is
not launched by this CLI. Native UI is not required.

On macOS the directory button invokes the local OS folder chooser. Only a confirmed
canonical directory is granted as the Kernel session's cwd/read/write roots, while
tool/network policy remains intact. AgentKit has no directory-browsing API.

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
and settings once. Build the TypeScript UI/CLI and provide those developer inputs:

```sh
npm ci
npm run build
npm run host -- start \
  --agentkit-binary /absolute/path/to/tekes-agent-web \
  --kernel-binary-dir /absolute/path/to/BuiltInKernel \
  --port 65150
npm run setup
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
