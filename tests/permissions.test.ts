import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePermissions } from '../src/permissions';
test('permission authority accepts opaque advertised modes and fixed server state, refusing unknown/duplicate values', () => {
  const policy = {
    threadLevel: [{ value: 'future-harness-mode' }],
    serverLevel: { options: [], currentValue: null },
  };
  validatePermissions(policy, 'future-harness-mode');
  assert.throws(() => validatePermissions(policy, 'danger-full-access'));
  assert.throws(() =>
    validatePermissions(
      {
        ...policy,
        threadLevel: [...policy.threadLevel, ...policy.threadLevel],
      },
      null,
    ),
  );
  validatePermissions(
    {
      threadLevel: [],
      serverLevel: { options: [{ value: 'fixed' }], currentValue: 'fixed' },
    },
    'fixed',
  );
  assert.throws(() =>
    validatePermissions(
      {
        threadLevel: [],
        serverLevel: { options: [], currentValue: 'unadvertised' },
      },
      null,
    ),
  );
});
