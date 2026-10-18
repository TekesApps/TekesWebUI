# TekesWebUI

A quiet, independent web workspace for Tekes agents. Built with **React,
TypeScript and Vite**, published under the **MIT license**.

Warm paper surfaces and a soft Sage green brand, a folder-based thread sidebar, readable Markdown, live tool
activity, and a focused composer. Light, dark and system appearance; responsive
navigation; keyboard search; IME-aware submission; drafts scoped to each thread.

## Boundaries

```text
Tekes App ──────┐
               ├── authenticated local host ── AgentKit ── Kernel / Pi / DSH
TekesWebUI ────┘
```

This repository owns the browser UI and its view state. It has no threads database,
model proxy or simulated model. It consumes the host's public API, so App and browser
see the same AgentKit endpoints and Harness threads. Closing a tab only releases
observation; the host continues running the task.

The local Tekes host owns browser authentication, provider credentials, execution
permissions, and detached startup. AgentKit owns normalized runtime and adapters.
Neither the Kernel nor native ClientKit views are implemented here.

## Build

Use Node.js 22.12+ (or 20.19+).

```sh
npm ci
npm test
npm run build
```

Serve **`dist/`** through the authenticated host using its explicit `--web-root`
option. The production frontend calls `/api` on the same origin. Open the host's
browser entry point to authenticate. A static preview alone does not start agents.

For development against an already running local host:

```sh
TEKES_HOST_URL=http://127.0.0.1:65150 npm run dev
```

Open the Vite URL and enter the host's **browser** access token. The dev proxy
forwards `/api` to that loopback host; it still requires authentication. Never use
the privileged App token, expose the dev server publicly, or put tokens in `.env`
files committed to Git. Model credentials never enter the frontend.

## Current scope

- Kernel, Pi and DSH connection health and shared inventories
- Compact sidebar with expandable search, persisted activity/title sorting, optional folder grouping and running/Harness filters
- Hover/focus timestamps, local absolute dates, consistent control tooltips and keyboard shortcuts
- Create a thread, select a configured real model, send, queue and cancel
- Streaming transcript, tool results, reasoning, earlier history, approvals and questions
- Per-destination drafts, mutation receipts, reconnecting observations and theme preferences
- Add/remove files, drag and paste attachments, destination-scoped pending files and real Harness uploads
- Harness-specific initial presets and configuration text, model reasoning effort and input details

Rendered artifact previews, native permission panels and complete
App feature parity are not implemented. Existing Harness version compatibility and
data migration remain host/adapter responsibilities. The UI does not convert older
Kernel ledgers into a newer format.

The `+` opens the browser's file chooser. Files stay with their draft destination
when switching Harnesses, and upload through the selected Harness before prompt
admission. Failed submissions retain pending files; acknowledged input clears only
the submitted files and text. Pending local files are memory-only and must be added
again after reloading or closing the tab. Uploads currently use the public file
receipt contract, including images as files; inline image preview/editing is not
implemented. The UI uses advertised limits, with an 8 MB per-file transport bound.

Presets come from `session.initialPresets`, or DSH's public roster/document APIs.
New Kernel choices use `identityProfile`; Pi/DSH choices use `agentPreset`. An
existing thread's Harness and initial preset remain locked. If a Harness does not
report an older thread's preset, input details say so instead of inferring it.

Real-host opt-in acceptance uses `tests/live-composer.ts`. Supply `TEKES_HOST_URL`
and `TEKES_BROWSER_TOKEN` privately, then run `npx tsx tests/live-composer.ts`.
It creates temporary threads, uploads known test bytes, asks the configured real
DeepSeek Flash model to read them, and archives its own threads. It never runs
as part of ordinary unit tests or CI.

## Design reference

[open-claude-ui](https://github.com/Caho1/open-claude-ui) inspired the warm surfaces,
spacing and composer treatment. We author the application and styles independently;
we do not ship its Electron code, simulated attachment workflow, model constants,
Claude branding, proprietary fonts or assets. See [the assessment](docs/reference-assessment.md).

Brand colors use **TekesUI's compiled Sage preset**, seed `#7FA27B`. Main actions,
links, hover/pressed colors and increased-contrast variants come from its existing
color compiler; we do not maintain a parallel palette algorithm. Checked-in CSS
works without Python, Rust or a TekesUI checkout at build/runtime. To refresh it
from a checkout with current compiler outputs:

```sh
npx tsx scripts/import-tekesui-brand.ts /path/to/TekesUI
```

The importer verifies every recorded compiler input hash and records provenance
in `design/brand.json`. Generated token data retains TekesUI's MIT copyright.

## Project layout

| Path               | Responsibility                                      |
| ------------------ | --------------------------------------------------- |
| `src/api.ts`       | Authenticated HTTP and NDJSON observation transport |
| `src/types.ts`     | AgentKit public service projections                 |
| `src/workspace.ts` | Browser selection, drafts, receipts and lifecycle   |
| `src/state.ts`     | Pure grouping, identity and draft helpers           |
| `src/components/`  | Transcript, tool cards, dialogs and action forms    |
| `src/App.tsx`      | Workspace composition and navigation                |
| `src/styles.css`   | Semantic tokens, responsive layout and appearance   |

MIT © TekesApps

### TekesUI icons

The complete 176-icon catalog is a public TekesUI dependency, locked to an immutable
HTTPS source archive and integrity hash. `npm ci` installs all artwork; `npm run build`
checks every SVG and emits the assets. No local directory, import command, private
repository, SSH key or generic icon fallback is required. See [icon sources](docs/icons.md).
