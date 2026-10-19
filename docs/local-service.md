# Install and run TekesWebUI

The browser and local service are one TypeScript project. Node.js 22.12+ (or
20.19+) is required. The first published runtime package targets **macOS Apple
Silicon (`darwin-arm64`)**; unsupported platforms fail explicitly. Kernel/Pi/DSH
adapters and native App UI remain unchanged.

## First installation

From this repository:

```sh
npm ci
npm run setup
```

`setup` downloads this version's published TekesWebUI package, including the
compiled UI/CLI, AgentKit 0.3.7 and Kernel 0.9.0 executables. It verifies the archive,
every file, dependency pins and Kernel build identity before installing. No Rust
compiler, AgentKit checkout, Tekes build directory or path arguments are needed.
A release archive also includes the compiled manager; after unpacking it, run
`npm run setup` directly without `npm ci` or a build.

Existing Tekes provider settings, Kernel data root, Pi registry, DSH pairing,
workspace and port are imported automatically. Without Tekes settings, setup asks
for a real DeepSeek Responses endpoint and the model IDs configured there. It does
not invent model availability or substitute a test model.

Setup takes the provider key from the configured credential environment (normally
`DEEPSEEK_KEY`), a previously saved WebUI key, or a hidden terminal prompt. It saves
the key in the **TekesWebUI macOS Keychain service**, separate from Tekes App's
protected credentials. The key is sent to `security -i` through stdin, never argv,
configuration files, browser storage or release packages. Ordinary starts read it
from Keychain; no environment variable needs to be entered again. macOS may ask for
Keychain access. This project does not change the native App's Keychain items.

Installation configuration is stored privately in
`~/.agents/client/agent-web/installation.json`. Runtime binaries live under that
directory's `installed/`, independent of source checkouts. Existing Harness thread
data and `thread-preferences.json` are retained.

## Daily commands

```sh
npm start        # Start in the background and open the authenticated browser
npm stop         # Stop the service and its owned Kernel/AgentKit processes
npm run status   # Show running version and address
npm run open     # Open the authenticated browser again
npm run update   # Install and activate the latest published release
```

`npm start` is idempotent: if already running, it opens the browser without starting
a second service. `npm start -- --no-open` starts without opening a browser. Closing
the browser or terminal leaves the background service running. Restart with
`npm stop` followed by `npm start`. This is not a launch-at-login service.

Use `open` rather than entering a bare URL: it supplies the current browser token
through a private launcher. Restart rotates tokens. HTTP access remains loopback
only, with Host/Origin checks; privileged DSH pairing still requires the App token.

Updates download and validate into a staging directory before changing the active
installation. Failed downloads/validation retain the previous installation. If an
activated update fails to start, the manager restores its previous configuration
and attempts to restart the old release. A running or queued task, or unavailable
Harness state, prevents automatic restart: finish work and rerun `npm run update`.
Updating to the already installed release does not restart the service. Setup does
not stop an existing service; use stop/start once when migrating an older host.

## What starts what

The local service starts the verified Kernel supervisor and AgentKit. AgentKit's
Pi adapter starts per-session Pi stdio RPC processes on demand. Pi is optional and
reuses an installed runtime; setup does not install Pi. DSH is an existing external
service that the DSH adapter connects to over its public interface; setup/start do
not launch DSH. No Harness databases are copied or privately queried.

On macOS the new-chat directory button opens the native folder chooser through
the local service. Only a confirmed canonical directory is granted as the Kernel
session's cwd/read/write roots; tool and network policy stay unchanged. Cancel
changes no draft or grant. AgentKit has no file/directory-browsing API.

## Advanced development

`npm run build` produces `dist/` and `dist-host/`. The low-level development CLI
remains available for explicit binary/config overrides:

```sh
npm run host -- start --agentkit-binary /absolute/path/to/tekes-agent-web \
  --kernel-binary-dir /absolute/path/to/BuiltInKernel --port 65150
```

Normal users do not need these arguments. `--runtime-dir`, `--settings`,
`--kernel-data-root`, `--workspace`, `--pi-registry`, `--pi-runtime`, `--dsh-url`
and credential environment overrides remain developer options. Manager commands
accept `--runtime-dir` for an isolated installation.

## Release packaging and verification

Release maintainers build the exact AgentKit revision recorded in
`host/install.ts` using `cargo build --locked --release -p tekes-agent-web`, then:

```sh
npm ci
npm test
npm run build
npm run release:bundle -- \
  --agentkit-source /absolute/path/to/pinned/AgentKit \
  --agentkit-binary /absolute/path/to/pinned/AgentKit/target/release/tekes-agent-web \
  --kernel-binary-dir /absolute/path/to/verified/BuiltInKernel
```

Upload the generated platform archive and JSON manifest from `release-artifacts/`
to this repository's matching `vX.Y.Z` GitHub Release. The packager includes runtime
licenses and rejects an AgentKit checkout that differs from the published exact
pin. The Kernel bundle's provenance, identity and hashes are verified. No account
settings, model keys or thread data are packaged.

Tests cover installation/hash rejection, unsafe archive entries, immutable install
reuse, update rollback, active-work guards, path-free start/status/stop and repeated
start without a second service. The opt-in `TEKES_AGENTKIT_BINARY=/path/to/binary
npm test` also exercises the real AgentKit pipe. Process fixtures never run models;
manual browser/native-dialog acceptance remains separate.
