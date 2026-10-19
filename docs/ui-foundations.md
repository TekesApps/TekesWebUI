# UI foundations

All action and choice menus use `src/components/ui/Menu.tsx` and `menu.css`.
Do not add independent click-outside listeners, absolute-positioned dropdowns,
or browser-native selects to the application chrome. Use `Menu`, `MenuItem`,
`MenuSub`, `MenuLabel`, `MenuSeparator`, and `ChoiceMenu` instead.

Radix Dropdown Menu owns keyboard focus, typeahead, nested navigation, dismissal,
disabled-item skipping and collision placement. Native HTML dialogs remain the
modal foundation. Menus opened inside a dialog portal into that dialog so that
the browser's top layer and inert background do not hide or disable them.

The visual reference is open-claude-ui's grouped selector panels: quiet surfaces,
fine borders, generous section spacing, rounded rows and layered elevation.
Styles are independently authored. Sage semantic brand roles supply the selected
wash and checkmark. Changing the theme changes every menu together.

Shared dimensions: 14px panel radius, 8px row radius, 6px panel padding, 34px minimum
row height, 13px labels and 11px supporting text. Panels use 236px width, or 304px
for descriptive choices, bounded by the viewport with 12px collision padding.
Menu entrance uses the shared 150ms motion role and a 100ms exit. Both are disabled
under reduced-motion preferences.

Harness presets remain real catalog choices. Models retain provider/model identity;
internal provider IDs are only shown when needed to distinguish duplicate model IDs.
Sidebar sorting, grouping and Harness filtering live in submenus to keep the first
level short. Files, prompts and mutations continue through the existing Workspace.

For a menu change, check pointer and keyboard opening, arrow navigation, Enter,
Escape and focus restoration, outside dismissal, checked/disabled states, dialog
containment, long labels, viewport boundaries, and light/dark themes. Do not treat
static screenshots as proof of keyboard or assistive-technology acceptance.

## Text and motion

`motion.css` owns duration/easing roles for menus, dialogs, tooltips, message
entrance, attachments, disclosure expansion, button feedback and working status.
Its vocabulary follows the reference's text reveal, message rise, quiet dots and
status shimmer; it is independently implemented with the existing Sage theme.

Live assistant output uses `useTypedText` to advance the Markdown source by whole
graphemes. Text ahead of the visible frontier is not laid out under an opacity or
blur overlay. History and authoritative replacements are immediately visible;
only appended live output is paced. A bounded 96-grapheme tail accelerates when
network frames coalesce, avoiding an indefinitely delayed display. Pending text
continues to settle when a run finishes. The original transcript and Copy payload
are unchanged. Stable Markdown renderers preserve existing semantic nodes.

Reduced motion displays all available text immediately. Backgrounding the page
flushes pending presentation instead of accumulating work while animation frames
are suspended. Timers and listeners are removed on settlement and unmount.
There is no text blur, mutation retry or animation-driven auto-scroll.

Disclosure height transitions use progressive enhancement; browsers lacking
`interpolate-size` retain the native instant expansion. This is a presentation
fallback, not a dependency on a particular browser engine.

## Status color and transcript chrome

Status icons use TekesUI's compiled Sage semantic tokens from the immutable public
package. Running uses `status-running` (amber), completed `status-succeeded`
(green), failed `status-failed` (red), and cancelled `status-info` (blue). Other
neutral or waiting states use secondary/warning roles. Glyph shapes and labels
remain distinct without color, and light/dark/increased-contrast values come
from the same compiler output. The Web introduces no second color calculation.

The transcript title bar is 44px on desktop and 48px on narrow touch layouts.

## Message timestamps

Output timestamps follow Copy in the bottom action row, matching ClientKit’s
output footnote lane, and appear on message hover or keyboard focus. Completed
turns prefer the authoritative end time; unfinished output has no finish caption.
Hovering or focusing a timestamp shows full date/time through seconds in the
shared delayed tooltip. Both input and output captions use
Today/Yesterday, weekday within seven calendar days, then month/day, with HH:mm.
Calendar boundaries follow the browser's local timezone, including DST. Relative
labels refresh across midnight and when the window regains focus; missing dates
never become fabricated timestamps. Chinese and English retain the same rules.

## Reported output tokens

The Web consumes AgentKit's uniform `TranscriptReportedUsage` on each turn.
DSH's adapter obtains the facts via its public session follow/page interfaces;
the renderer never reads DSH files or calls its specialized API. The Responses
protocol remains selected.

The running footnote shows the sum of actual completed response reports, matching
ClientKit: zero/missing counts are omitted, sub-1000 counts are integers, and
1000+ counts use a fixed one-decimal `k` suffix (`1.0k`, `12.4k`). Completed,
failed and cancelled turns hide the counter and retain the ordinary output
controls and finish time. Durable history and restored snapshots still carry
reported usage in AgentKit; only an active connected run displays it. If history or usage is incomplete,
the caption says recorded output tokens rather than claiming a complete total.
Loading earlier history or receiving an authoritative turn total can complete it.
Accounting updates only when admitted reports change, never from text/chunk length
or a timer. No unavailable realtime usage is simulated.

The visual counter follows ClientKit's count-through behavior: each real report
starts a 240ms cubic ease-out from the currently presented integer to the reported
target. Intermediate integers are presentation frames only and never enter usage
or accounting. An unchanged target does not restart the animation; a new target
continues from the current presentation value. Downward corrections, reduced
motion and hidden tabs show the authoritative target immediately. Mounting an
existing count does not animate from zero. Tabular numerals keep the caption
stable. The accessible label retains the reported target throughout the animation.

Native references: TekesMetalTextKit `Engine/MetalRenderer.swift`
(`AsideTickAnimation`, `presentedAsideTickCount`) and
`Shared/TypewriterSupport.swift` (240ms catch-up), plus
`Shared/CompactCountFormat.swift` for the `k` suffix.

## Settled activity handoff

Following ClientKit, an in-progress assistant response stays in the activity until
its finality is promoted at turn settlement. The final response then appears once
outside the activity, without replaying entry or typing animation. A terminal turn
collapses the activity in the same render even if the control phase still says
running. Tool rows remain inside the disclosure. Completed turns show `Worked for`
and the duration derived from their actual start/end timestamps; missing timestamps
use `Worked` without an invented duration. Failed and stopped turns use their own
terminal captions. Expanding the disclosure reveals the tool timeline.

Native references: ClientKit `SessionEventProjector.swift` (settlement finality),
`TranscriptMetalSnapshotBuilder.swift` (final mirror promotion),
`TranscriptMetalActivity.swift` (settled disclosure) and
`TurnEvaluationPresentation.swift` (elapsed duration and terminal captions).

## Input and output footnotes

The ClientKit reference is `TranscriptTurnFootnote.swift`, with action roles in
`TranscriptFootnoteTarget.swift` and callbacks in `RunView.swift`.
Input time precedes Copy; both appear together on hover/focus, and remain visible
on touch devices. Copy uses the displayed input text, rather than the encoded
annotation envelope. The Input lane is not the location for completed-turn Fork.

AgentKit supplies each turn's optional `footnoteActions`, using its public
`ThreadActionDefinition` type. Web renders those definitions with TekesUI icons
and sends the exact action ID through `thread.performAction`. AgentKit resolves
Fork to the selected durable settlement's `atSeq` or native `entryId`, rechecks
current availability, and returns the existing navigation/warning outcome.
No whole-session fork substitutes for a missing turn boundary. Stale or disconnected
views do not expose active footnote actions. No-output settled turns still have a
footnote when AgentKit supplies actions.

This is not a claim of full footnote parity: native Input rewind/edit, feedback and
notes, optimistic delivery captions, goal state and memory detail require their
corresponding public presentation/commands before Web can expose them. The current
ClientKit target/callback still defines Fork, although its current
`rawOutputNodes` does not insert that control; the Web implementation follows its
completed-turn capability and through-turn command semantics, rather than copying
that omission.

## Local working-directory selection

The new-chat directory button opens the local macOS folder chooser through the
Tekes host's authenticated `host.pickDirectory` operation. AgentKit has no added
file or directory browsing API. Cancel leaves the draft, model and working path
unchanged. An in-flight chooser disables repeated opening, and its result cannot
replace a newer chat or Harness selection.

The host advertises only its local Harness IDs. A successful native selection
admits the canonical directory; Kernel session creation scopes the execution
read/write roots to that directory while retaining the existing tool/network
policy. No directory selection starts a model or creates a session by itself.
