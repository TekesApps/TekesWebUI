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
