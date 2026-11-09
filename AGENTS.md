# TekesWebUI

This is a standalone TypeScript project, licensed MIT.
Keep browser UI in `src/` and the local Node.js CLI service in `host/`.
Do not add Python service implementations or move this service into Tekes/AgentKit.

The authenticated host owns credentials, process lifetime, execution permissions,
and serving `dist/`. AgentKit owns SessionRuntime and Kernel/Pi/DSH adapters.
The Harness owns durable threads. The browser does not read private databases, run models, store provider credentials,
or stop work on disconnection. The local service passes credentials through private
pipes and uses the Harness public APIs.
Kernel source changes require separate user confirmation. ClientKit is planned for deprecation
and is not part of this delivery path. Future native Agent consumers use AgentKit
shared interfaces and state; native rendering is outside this Web batch.
Harness adapters prefer their own public capabilities. Host-shared services are
explicit fallbacks, not a claim that every Harness delegates its functionality to Kernel.

Use strict TypeScript. Validate with `npm test` and `npm run build`. Keep secrets,
local connection descriptors, screenshots of private threads, and runtime data out
of the public repository. Lock dependencies. Do not automatically retry mutations.
