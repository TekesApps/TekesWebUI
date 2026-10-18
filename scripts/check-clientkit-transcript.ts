import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { toolRole } from '../src/transcript';
const root = process.argv[2];
if (!root)
  throw new Error(
    'Usage: npx tsx scripts/check-clientkit-transcript.ts /path/to/TekesClientKit',
  );
const source = await readFile(
  resolve(root, 'Sources/TranscriptRendering/TranscriptToolDisplay.swift'),
  'utf8',
);
const body = source
  .split('func tekesIcon(for toolName: String)')[1]!
  .split('public static func icon(')[0]!;
let count = 0;
for (const match of body.matchAll(
  /case\s+((?:"[^"]+"\s*,?\s*)+):\s*\.([A-Za-z]+)/g,
)) {
  const native = match[2]!;
  const role = native.startsWith('tool')
    ? native[4]!.toLowerCase() + native.slice(5)
    : native;
  for (const name of match[1]!.matchAll(/"([^"]+)"/g)) {
    assert.equal(toolRole(name[1]!), role, name[1]);
    count++;
  }
}
assert.ok(count >= 45, 'ClientKit role table was not recognized');
assert.equal(toolRole('terminal_read'), 'shell');
assert.equal(toolRole('schedule_add'), 'job');
console.log(
  `ClientKit tool icon families: ${count} exact names and both prefixes aligned; browser glyphs use the TekesUI catalog.`,
);
