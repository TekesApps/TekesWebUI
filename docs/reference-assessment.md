# Reference assessment: open-claude-ui

Inspected 2026-10-18 at commit
`638800b8a4cee4513c8763c3df0ecf8a77b32379`.

Source: <https://github.com/Caho1/open-claude-ui> (MIT, copyright 2026 Caho1).

The repository is a component/style library, not a complete agent client or server.
Its entry point exports component examples and hooks. Package scripts build the
library and validate types and token references. Its CI invokes those same checks.
We installed the locked dependencies with lifecycle scripts disabled and confirmed
`typecheck`, `check:tokens`, and `build` pass at the inspected revision.

Those checks do not establish behavioral or end-to-end correctness. In particular,
`ChatComposer` supplies historical fixed Claude model constants, a simulated
attachment action and an optional send callback; it immediately clears local
input without awaiting submission acknowledgement. That behavior is unsuitable
for our real asynchronous session contract. The package also exports Electron
window code, which this browser project does not need. No Kernel/Pi/DSH adapter
architecture or session authority was found in the exported source.

Decision: use the visual direction as a reference and implement the browser app
independently in React + strict TypeScript. Use existing AgentKit services for
actual models, threads, tool execution and task lifetime. Do not fork upstream
model, session or attachment simulations. We make no claim that upstream is a
fully tested production application.

No upstream source, branding, fonts, audio or other assets are vendored here.
The reference's MIT license permits code reuse with its notice retained if future
contributions choose to copy code. Dependencies retain their respective licenses.
