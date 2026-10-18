# Complete public TekesUI icons

Every interface and tool glyph comes directly from the public `@tekesui/icons`
package in TekesUI. All 176 canonical SVGs live in TekesUI's
`crates/tekes-ui-icons/assets`; Web has no copied SVG catalog, external directory,
manual import step or generic missing-icon fallback.

The Tekes product mark is `public/app-icon.png`, the unchanged 256px AppIcon
from Tekes's `Assets.xcassets/AppIcon.appiconset/icon_128x128@2x.png`.
The sidebar, welcome screen and favicon use this checked-in asset; building Web
does not require a local Tekes checkout. Its original colors are preserved.

The dependency is an immutable HTTPS archive of the public TekesUI commit, pinned
in `package.json` and by SHA512 integrity in `package-lock.json`. Installing it
requires neither an SSH key, a private repository, a local TekesUI checkout nor a
Rust toolchain. The package exports `iconNames`, typed `IconName`, and
`getIconUrl(name)`. Its public `catalog.json` records every SVG's hash and provenance.

From a fresh checkout:

```sh
npm ci
npm test
npm run build
```

Build first runs `icons:check`: it checks all 176 SVG hashes and every requested
interface/tool slot. Missing or unknown names fail explicitly. Tests are never
skipped because a local directory is absent.

Vite resolves the package's static module-relative SVG URLs and emits same-origin
asset files under the existing strict CSP. The package is excluded from development
prebundling so dev URLs also resolve to the original package assets. CSS alpha masks
apply the surrounding semantic color without editing geometry. The MIT notice is
retained in `public/tekes-icons/LICENSE`.

The current public source is TekesUI commit
`80d6b05649234f953ea452d42e1cbed369fdddbb` (`icons-v0.1.1`). This supersedes the earlier
8-resource/local-only integration. All valid catalog artwork is now shared publicly;
the 5 retired originals remain excluded. ClientKit semantic role mapping is unchanged.
