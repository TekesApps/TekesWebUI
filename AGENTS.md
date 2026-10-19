# TekesWebUI

This is a standalone TypeScript project, licensed MIT.
Keep browser UI in `src/` and the local Node.js CLI service in `host/`.
Do not add Python service implementations or move this service into Tekes/AgentKit.

The authenticated host owns credentials, process lifetime, execution permissions,
and serving `dist/`. AgentKit owns SessionRuntime and Kernel/Pi/DSH adapters.
The Harness owns durable threads. The browser does not read private databases, run models, store provider credentials,
or stop work on disconnection. The local service passes credentials through private
pipes and uses the Harness public APIs.
Kernel changes are outside scope. Swift reusable Agent UI remains ClientKit-owned.

Use strict TypeScript. Validate with `npm test` and `npm run build`. Keep secrets,
local connection descriptors, screenshots of private threads, and runtime data out
of the public repository. Lock dependencies. Do not automatically retry mutations.
