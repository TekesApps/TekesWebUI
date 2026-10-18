# ClientKit transcript presentation alignment

Compared 2026-10-19 against ClientKit checkout commit
`c289bc9d33edcd83a782ac17927a8c65a027eccd`:

- `Sources/Contract/TranscriptThinkingMode.swift`
- `Sources/TranscriptRendering/TranscriptToolDisplay.swift`
- `Sources/TranscriptRendering/TranscriptToolRowModel.swift`
- `Sources/TranscriptRendering/TranscriptMetalActivity.swift`
- `Sources/TranscriptRendering/TranscriptMetalNodeConstructors.swift`
- `Sources/TranscriptRendering/TranscriptDisplaySupport.swift`
- `Sources/TranscriptRendering/TranscriptToolCardModel.swift`
- `Sources/Session/SessionEndpoint/AgentKit/AgentKitTranscriptView.swift`

Only the standalone Web repository changed. Native ClientKit/Tekes and Kernel
implementations are unchanged.

| Information                                   | Browser rule                                                         |
| --------------------------------------------- | -------------------------------------------------------------------- |
| User input                                    | User bubble, attachments and timestamp                               |
| Final assistant output                        | Separate Markdown output, attachments and copy action                |
| Nonfinal assistant with tools / narration     | Process content, separate from final answer                          |
| Reasoning                                     | Never render its body or a disclosure entry, live or historical      |
| Active reasoning-only record                  | Transient thinking status until output/tools arrive                  |
| Tool/process history                          | Normal completion collapses; failure/stopping keeps context open     |
| System prompt                                 | Collapsed literal-text disclosure                                    |
| Host notice / error                           | Literal warning/failure quote; no accidental Markdown interpretation |
| Usage-only / invisible rows                   | No conversation bubble                                               |
| Unknown event                                 | Explicit event disclosure rather than assistant output               |
| Artifact                                      | Retain attachment cards and optional text disclosure                 |
| Queued input / actionable approvals/questions | Existing queue and ActionCard flow retained                          |

ClientKit defaults to `none` thinking for live output, but retains reasoning in an
explicitly expanded settled history. The user explicitly requested that thinking
not be exposed: the Web rule is stricter and omits that historical entry too.
Reasoning remains in the authoritative read model; this does not edit session data.

## Tool glyph provenance

ClientKit supplies semantic roles; its native IconRole implementation uses SF Symbols.
Web uses the original TekesUI Gallery SVG catalog via `TekesIcon`. The TypeScript role
mapping mirrors every exact ClientKit family (51 names) and the `terminal_` and
`schedule_` prefixes, with explicit Kernel/Pi aliases. MCP action labels are humanized;
unknown tools use `tekes-unknown-tool` rather than a shell glyph.

`src/components/ui/ToolIcon.tsx` maps semantic roles to browser glyphs. No SF Symbols or reference-project artwork is used. Web directly consumes TekesUI's
complete public 176-SVG package, with all names and source hashes checked during
build. See `icons.md` for the locked public dependency.

Validate source drift using:

```sh
npm run check:clientkit -- /path/to/TekesClientKit
```

Collapsed summaries derive from semantic input fields; they do not become stdout
or arbitrary JSON/private-field previews. Full input/output remains selectable and
copyable. Failed/stopped/completed states are distinct; historical calls never
restart a running animation. Structured nonzero exit signals also mark failure.

## Public read-model boundary

The current AgentKit public Tool DTO supplies name, arguments, result, phase,
callView and resultView, but no shared tool/item chronological order or response-frame
identity. Web preserves each authoritative list's order and separates process/output;
it does not invent a merged native-style event order. Rich native read/search/diff/
terminal cards require their validated producer metadata. Unsupported payloads use
ClientKit's generic complete Input/Output fallback, with call/result views retained
as additional disclosures. This change does not claim full native renderer parity.
