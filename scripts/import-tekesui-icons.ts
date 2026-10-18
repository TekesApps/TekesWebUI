import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { toolIcons, sharedIconNames } from '../src/icons/tool-assets';
import { interfaceIcons } from '../src/icons/interface-assets';
const args = process.argv.slice(2),
  source = args[0],
  legacyIndex = args.indexOf('--legacy');
if (!source)
  throw new Error(
    'Usage: npm run icons:import -- /path/to/TekesUI [--legacy /path/to/TekesIcons]',
  );
const root = resolve(source),
  legacy = legacyIndex >= 0 ? resolve(args[legacyIndex + 1]!) : undefined;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function validate(svg: string, name: string) {
  if (
    Buffer.byteLength(svg) > 256 * 1024 ||
    !svg.includes('viewBox="0 0 24 24"') ||
    /<(?:script|foreignObject|image|style)\b|\bon\w+\s*=|\b(?:href|src)\s*=|C2PA/i.test(
      svg,
    )
  )
    throw new Error(`Unsupported SVG: ${name}`);
}
const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
if (!license.startsWith('MIT License'))
  throw new Error('TekesUI MIT license not found');
const catalog = await readFile(
  resolve(root, 'crates/tekes-ui-gallery/src/gallery/icon_catalog.rs'),
  'utf8',
);
if (!catalog.includes('Tekes/Tekes/Assets.xcassets/TekesIcons'))
  throw new Error('TekesUI Gallery legacy source contract changed');
await mkdir('public/tekes-icons/defaults', { recursive: true });
const entries = [];
for (const name of sharedIconNames) {
  const relative = `crates/tekes-ui-icons/assets/${name}.svg`,
    svg = await readFile(resolve(root, relative), 'utf8');
  validate(svg, name);
  await writeFile(`public/tekes-icons/defaults/${name}.svg`, svg);
  entries.push({ name, source: relative, sha256: digest(svg) });
}
await writeFile('public/tekes-icons/LICENSE', license);
await writeFile(
  'design/icons.json',
  JSON.stringify(
    {
      format: 'tekesui-web-icons/1',
      repository: 'https://github.com/TekesApps/TekesUI',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      licenseSha256: digest(license),
      entries,
    },
    null,
    2,
  ) + '\n',
);
let localCount = 0;
if (legacy) {
  await mkdir('src/icons/local', { recursive: true });
  const local = [];
  for (const name of new Set([
    ...Object.values(toolIcons),
    ...Object.values(interfaceIcons),
  ])) {
    if (sharedIconNames.some((shared) => shared === name)) continue;
    const svg = await readFile(
      resolve(legacy, `${name}.imageset/${name}.svg`),
      'utf8',
    );
    validate(svg, name);
    await writeFile(`src/icons/local/${name}.svg`, svg);
    local.push({ name, sha256: digest(svg) });
    localCount++;
  }
  await writeFile(
    'src/icons/local/provenance.json',
    JSON.stringify(
      {
        format: 'tekesui-gallery-local-icons/1',
        source: 'TekesUI Gallery external read-only catalog',
        entries: local,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(
  `Imported ${entries.length} MIT TekesUI defaults and ${localCount} ignored local Gallery tool assets; SVG bytes unchanged.`,
);
