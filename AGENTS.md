# TekesWebUI

This is a standalone React + TypeScript browser application, licensed MIT.
Keep UI in `src/`; never embed pages or scripts in a Python host.

The authenticated host owns credentials, process lifetime, execution permissions,
and serving `dist/`. AgentKit owns SessionRuntime and Kernel/Pi/DSH adapters.
The Harness owns durable threads. This frontend does not read private databases,
run models, store provider credentials, or stop work on browser disconnection.
Kernel changes are outside scope. Swift reusable Agent UI remains ClientKit-owned.

Use strict TypeScript. Validate with `npm test` and `npm run build`. Keep secrets,
local connection descriptors, screenshots of private threads, and runtime data out
of the public repository. Lock dependencies. Do not automatically retry mutations.
