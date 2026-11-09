# Harness brand artwork

These are the existing Tekes App's original, unmodified brand assets, not
TekesUI action icons. Source: Tekes commit
`8858ccd9d46590852ec7a0949aee289fc6798d70`, under
`Tekes/Assets.xcassets/`:

- `pi-official.svg`: `PiHarnessLogo.imageset/pi-official.svg`.
- `deepseek.svg`: `HarnessDeepSeek.imageset/harness.svg` (light appearance).
- `deepseek-dark.svg`: `HarnessDeepSeek.imageset/harness-dark.svg` (dark appearance).

The source repository's MIT notice is retained in `LICENSE`. The source image
sets contain no separate asset license. Brand names and artwork retain their
original identities; these copies do not create new TekesUI catalog entries.
Native uses the existing `public/app-icon.png`, the Tekes application icon.

Placement follows `ComposerSetupChipView.harnessImage` and the Harness menu in
`ComposerActionBarView`: full-color images, Native sized 1.25× the bare logos.
Ordinary Sidebar rows retain their existing status presentation.

Harness identity colors affect user input bubbles, rather than run status.
The CSS sRGB values were evaluated with the original Swift
`TekesMetalTextKit/Sources/TekesMetalTextKit/Design/AgentColor.swift`
(`7ee9703fd28c3cb7a65ab6b298c78efb17dd4507`) for the App's default
Native/Pi `#144D8B` and DSH `#4D6BFE`, in light/dark and increased-contrast
appearances. No runtime color engine or private App preferences are imported.
