/** The original Tekes App's Harness artwork, separate from UI action icons. */
export const harnessAssets = {
  tekes: { light: '/app-icon.png' },
  pi: {
    light: new URL('../assets/harness/pi-official.svg', import.meta.url).href,
  },
  dsh: {
    light: new URL('../assets/harness/deepseek.svg', import.meta.url).href,
    dark: new URL('../assets/harness/deepseek-dark.svg', import.meta.url).href,
  },
} as const;

export function HarnessLogo({
  kind,
  size = 18,
}: {
  kind?: string;
  size?: number;
}) {
  const asset = harnessAssets[kind as keyof typeof harnessAssets];
  if (!asset) return null;
  // The App icon has an enclosure; match the native toolbar's 1.25 scale.
  const extent = kind === 'tekes' ? size * 1.25 : size;
  return (
    <span
      className="harness-logo"
      aria-hidden="true"
      style={{ width: extent, height: extent }}
    >
      <img className="harness-logo-light" src={asset.light} alt="" />
      {'dark' in asset && (
        <img className="harness-logo-dark" src={asset.dark} alt="" />
      )}
    </span>
  );
}
