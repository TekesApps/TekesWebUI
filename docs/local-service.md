# Local TypeScript service

TekesWebUI includes its own Node.js CLI in `host/`; no Python service or separate
repository is required. `npm run build` compiles the UI to `dist/` and the service
to `dist-host/`. The service uses only Node built-ins at runtime.

## Run

Use Node 22.12+ (or 20.19+), the exact published AgentKit `v0.3.7`
(`a8610a420bad72eaedcf706b30df87153a0f3e16`), and the unmodified Kernel `v0.9.0`
bundle. The Kernel revision and binary hashes are verified before launch.
Build AgentKit with `cargo build --locked -p tekes-agent-web` in its checkout.

```sh
npm ci
npm run build
npm run host -- start \
  --agentkit-source /absolute/path/to/TekesAgentKit \
  --agentkit-binary /absolute/path/to/TekesAgentKit/target/debug/tekes-agent-web \
  --kernel-binary-dir /absolute/path/to/BuiltInKernel \
  --port 65150
npm run host -- open
npm run host -- status
npm run host -- stop
```

`--web-root` defaults to this project's `dist/`. All other source/binary overrides
are explicit; no sibling checkout is discovered. AgentKit is copied to a private,
content-addressed executable. Production deployment can freeze `dist-host/`,
`package.json` and `dist/` together in an immutable release directory.

The service imports the enabled direct DeepSeek **Responses** connection from
Tekes' existing `providers-and-routers.json` settings. Supply its existing key as
`DEEPSEEK_KEY`, or select an existing environment name with `--credential-env`.
The service never substitutes a test model. Kernel and Pi must select the same
configured provider. Pi uses its installed runtime and the included compiled
`pi-models.js` extension through public provider APIs. DSH uses its authenticated
public endpoint, never a private database. `TEKES_DSH_COOKIE` or the private
previously paired connection supplies its authentication.

Defaults preserve the existing Kernel 0.9 data root, Pi registry, workspace and
`~/.agents/client/agent-web` runtime directory. They can be overridden with
`--kernel-data-root`, `--pi-registry`, `--pi-runtime`, `--workspace`, `--settings`,
`--runtime-dir`, and `--dsh-url`. Model credentials and startup frames travel only
through private pipes, never command arguments, browser storage or checked-in
configuration. Runtime files are local and private (0700 directories/0600 files).
The CLI prints readiness metadata, never browser tokens or provider keys.

## Browser authentication and lifetime

The service binds only to `127.0.0.1`, checks Host/Origin, and requires an access
token for `/api`. `open` opens a private local launcher that transfers a browser
token in the URL fragment. Restart rotates tokens; run `open` again. Browser
credentials cannot pair DSH; that requires the privileged App token.

`start` detaches the service from the terminal. Closing the browser disconnects
only its observation; it does not cancel mutations or stop AgentKit/Kernel.
`stop`, logout, or machine shutdown ends the service. This is not a launch-at-login
service. The CLI can stop the earlier Python service for a one-time migration;
stop it before starting the TypeScript service on the same port.

On macOS, the new-chat directory button invokes `host.pickDirectory`; the service
opens the standard OS folder chooser with `osascript`. Arguments carry paths
without embedding user paths in script source. Cancel changes no draft or grant.
Only one chooser opens at a time. The selected canonical directory becomes the
Kernel session's cwd/read/write roots while retaining its tool/network policy.
Grants last for this service instance. AgentKit has no directory-browsing API.
Other platforms can serve the UI but do not advertise a native folder chooser.

## Verification

`npm test` covers authentication/Origin checks, static path containment, App-only
DSH pairing, native chooser cancellation/concurrency/grants, observer-only
cancellation, detached CLI lifecycle and private-file handling.

For the published AgentKit private-pipe integration without creating a model or
session, use:

```sh
TEKES_AGENTKIT_BINARY=/absolute/path/to/tekes-agent-web npm test
```

Browser/native-dialog interaction and real model task acceptance are separate
manual verification; deterministic process fixtures do not establish those claims.
