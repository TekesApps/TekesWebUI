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

`RevealText` immediately renders the full authoritative string. Only appended text
in live assistant Markdown receives a 320ms opacity/3px blur reveal,
with at most 60ms staggering. It uses grapheme boundaries (including emoji/ZWJ),
groups three graphemes per span, bounds each range to 120 graphemes and retains at
most four active ranges per leaf. Spans are removed after settling. Reconciled
replacement strings appear immediately. Code stays plain and selectable.

Initial history does not enter again. Transcript presentation resets on a session
change; loading older turns does not trigger latest-message entrance. The browser
reduced-motion preference disables new reveal work, and CSS also disables blur,
translation, shimmer and animated dots. Increased contrast keeps text fully solid.
No typing queue, mutation replay, or animation-driven auto-scroll is introduced.

Disclosure height transitions use progressive enhancement; browsers lacking
`interpolate-size` retain the native instant expansion. This is a presentation
fallback, not a dependency on a particular browser engine.
