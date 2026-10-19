import { threadActionIcons } from '../src/icons/thread-action-assets';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { iconNames, getIconUrl, type IconName } from '@tekesui/icons';
import { toolIcons } from '../src/icons/tool-assets';
import { interfaceIcons } from '../src/icons/interface-assets';
test('the complete public TekesUI dependency contains every original SVG with its catalog hash', async () => {
  const manifest = JSON.parse(
    await readFile(
      fileURLToPath(import.meta.resolve('@tekesui/icons/catalog.json')),
      'utf8',
    ),
  );
  assert.equal(manifest.icons.length, 176);
  assert.equal(
    await readFile('public/tekes-icons/LICENSE', 'utf8'),
    await readFile(
      new URL('./LICENSE', import.meta.resolve('@tekesui/icons/package.json')),
      'utf8',
    ),
  );
  assert.equal(iconNames.length, 176);
  for (const entry of manifest.icons) {
    const svg = await readFile(fileURLToPath(getIconUrl(entry.name)), 'utf8');
    assert.equal(createHash('sha256').update(svg).digest('hex'), entry.sha256);
    assert.ok(svg.includes('viewBox="0 0 24 24"'));
    assert.ok(svg.includes('currentColor'));
  }
});
test('all Web interface and tool slots resolve to actual shared catalog artwork', () => {
  for (const name of [
    ...Object.values(toolIcons),
    ...Object.values(interfaceIcons),
    ...Object.values(threadActionIcons),
  ]) {
    assert.ok(iconNames.includes(name));
    assert.match(getIconUrl(name), new RegExp(name + '\\.svg$'));
  }
});
test('unknown or retired icon names fail explicitly rather than falling back to provider', () => {
  for (const name of ['missing-icon', 'tekes-annotation', 'tekes-computer-use'])
    assert.throws(() => getIconUrl(name as IconName), /Unknown TekesUI icon/);
});
