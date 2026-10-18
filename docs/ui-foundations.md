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
Motion is 140ms and disabled under reduced-motion preferences.

Harness presets remain real catalog choices. Models retain provider/model identity;
internal provider IDs are only shown when needed to distinguish duplicate model IDs.
Sidebar sorting, grouping and Harness filtering live in submenus to keep the first
level short. Files, prompts and mutations continue through the existing Workspace.

For a menu change, check pointer and keyboard opening, arrow navigation, Enter,
Escape and focus restoration, outside dismissal, checked/disabled states, dialog
containment, long labels, viewport boundaries, and light/dark themes. Do not treat
static screenshots as proof of keyboard or assistive-technology acceptance.
