import { threadActionIcons } from '../src/icons/thread-action-assets';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getIconUrl, iconNames } from '@tekesui/icons';
import { toolIcons } from '../src/icons/tool-assets';
import { interfaceIcons } from '../src/icons/interface-assets';
const catalog = JSON.parse(
  await readFile(
    fileURLToPath(import.meta.resolve('@tekesui/icons/catalog.json')),
    'utf8',
  ),
);
assert.equal(iconNames.length, 176);
assert.deepEqual(
  iconNames,
  catalog.icons.map((icon: { name: string }) => icon.name),
);
for (const icon of catalog.icons) {
  const svg = await readFile(fileURLToPath(getIconUrl(icon.name)), 'utf8');
  assert.equal(
    createHash('sha256').update(svg).digest('hex'),
    icon.sha256,
    icon.name,
  );
}
for (const name of [
  ...Object.values(toolIcons),
  ...Object.values(interfaceIcons),
  ...Object.values(threadActionIcons),
])
  assert.ok(getIconUrl(name), name);
console.log(
  `Public TekesUI package: ${iconNames.length} SVG hashes and all Web slots verified; no local assets or fallback.`,
);
