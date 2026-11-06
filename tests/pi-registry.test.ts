import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { piRegistrySessions } from '../host/runtime.js';

const root = '/tmp/tekes-web-pi-registry';
const id = '1646b162-f867-4fa4-80f2-0fe45774deeb';
const registryPath = join(root, 'agentkit-sessions.json');
const sessionFile = join(root, 'sessions', id + '.jsonl');
const cwd = '/tmp/workspace';

test('accepts legacy WebUI session arrays', () => {
  assert.deepEqual(
    piRegistrySessions({ sessions: [{ id, cwd }] }, registryPath),
    [{ id, cwd, sessionFile }],
  );
});

test('accepts AgentKit public keyed entries and verifies their file pointers', () => {
  assert.deepEqual(
    piRegistrySessions(
      { sessions: { [id]: { id, cwd, file: sessionFile } } },
      registryPath,
    ),
    [{ id, cwd, sessionFile }],
  );
  const adoptedFile = join(root, 'sessions', 'native-timestamp-file.jsonl');
  assert.deepEqual(
    piRegistrySessions(
      { sessions: { [id]: { id, cwd, file: adoptedFile } } },
      registryPath,
    ),
    [{ id, cwd, sessionFile: adoptedFile }],
  );
  assert.deepEqual(piRegistrySessions({ sessions: {} }, registryPath), []);
});

test('rejects malformed, mismatched, and relative registry pointers', () => {
  const invalid: unknown[] = [
    null,
    {},
    { sessions: 'not a collection' },
    { sessions: [null] },
    { sessions: [{ id: '../escape', cwd }] },
    { sessions: [{ id, cwd: 'relative' }] },
    { sessions: { [id]: { id: 'different-id', cwd, file: sessionFile } } },
    { sessions: { [id]: { id, cwd, file: 'relative.jsonl' } } },
  ];
  for (const value of invalid)
    assert.throws(() => piRegistrySessions(value, registryPath));
});
