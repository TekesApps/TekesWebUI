import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { toolIcons, sharedIconNames } from '../src/icons/tool-assets';
import { interfaceIcons } from '../src/icons/interface-assets';
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
test('shared TekesUI SVGs and MIT notice retain their exact imported hashes', async () => {
  const manifest = JSON.parse(await readFile('design/icons.json', 'utf8'));
  assert.equal(manifest.entries.length, sharedIconNames.length);
  assert.equal(
    sha(await readFile('public/tekes-icons/LICENSE', 'utf8')),
    manifest.licenseSha256,
  );
  for (const entry of manifest.entries) {
    const svg = await readFile(
      `public/tekes-icons/defaults/${entry.name}.svg`,
      'utf8',
    );
    assert.equal(sha(svg), entry.sha256);
    assert.ok(svg.includes('viewBox="0 0 24 24"'));
    assert.ok(!/<(?:script|foreignObject|image)\b|\b(?:href|src)=/i.test(svg));
  }
});
test('every interface and tool slot requests a canonical TekesUI name', () => {
  for (const name of [
    ...Object.values(toolIcons),
    ...Object.values(interfaceIcons),
  ])
    assert.match(name, /^tekes-[a-z-]+$/);
  assert.equal(toolIcons.shell, 'tekes-shell');
  assert.equal(toolIcons.unknown, 'tekes-unknown-tool');
  assert.equal(interfaceIcons.Settings2, 'tekes-settings');
});
test('optional local Gallery assets cover all requested slots with original bytes', async (t) => {
  try {
    await access('src/icons/local/provenance.json');
  } catch {
    t.skip(
      'External Gallery legacy catalog not installed; public shared fallback is used.',
    );
    return;
  }
  const manifest = JSON.parse(
    await readFile('src/icons/local/provenance.json', 'utf8'),
  );
  const names = new Set<string>(sharedIconNames);
  for (const entry of manifest.entries) {
    assert.equal(
      sha(await readFile(`src/icons/local/${entry.name}.svg`, 'utf8')),
      entry.sha256,
    );
    names.add(entry.name);
  }
  for (const name of [
    ...Object.values(toolIcons),
    ...Object.values(interfaceIcons),
  ])
    assert.ok(names.has(name), name);
});
