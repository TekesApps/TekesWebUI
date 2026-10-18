# TekesUI icon source

All tool and interface glyphs use the canonical TekesUI Gallery catalog through
`TekesIcon`. Lucide has been removed. Original SVG geometry is preserved; CSS alpha
masks apply the surrounding semantic color without editing SVG strokes or paths.
The source art uses a 24pt viewBox and 1.5pt rounded strokes.

TekesUI has two different resource sources:

1. `crates/tekes-ui-icons/assets`: eight approved, self-contained MIT SVG resources.
   These ship in `public/tekes-icons/defaults`, with the complete upstream MIT notice.
   `design/icons.json` pins their source revision, paths and SHA256 hashes.
2. The Gallery also reads the existing external `TekesIcons` catalog. Its handoff
   explicitly keeps old artwork read-only/local pending public provenance/license
   review. Those resources are copied byte-for-byte only to ignored `src/icons/local`;
   they are included in the user's local build, never committed to this public repo.
   A local manifest records the selected names and hashes, without publishing paths.

Import from the same source as the running Gallery:

```sh
npm run icons:import -- /path/to/TekesUI \
  --legacy /path/to/Tekes/Tekes/Assets.xcassets/TekesIcons
npm run build
```

The importer checks the Gallery's external-source contract, SVG budgets/active
content and the MIT source notice. It imports 8 shared defaults and 42 selected
external glyphs for the current interface/tool mapping, without modifying source
repositories. The approved default always wins over its legacy counterpart.

A clean public checkout builds without the external catalog. Unavailable slots
show the shared Provider symbol as an explicit generic fallback, retain their
requested canonical name in `data-icon-requested`, and expose `data-icon-fallback`.
The label/operation is still available; a generic fallback is not represented as
complete artwork parity. Install the external catalog for the full local glyph set.

SVGs are emitted as same-origin files (`assetsInlineLimit: 0`) to satisfy the host's
strict CSP without data URLs or an expanded policy. Local images are rendered as
masks; no raw SVG markup is injected. Icon labels and decorative/accessibility roles
remain in their owning buttons or rows. Reduced motion still applies to spinners.
