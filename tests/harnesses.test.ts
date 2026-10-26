import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHarnesses } from '../host/harnesses.js';

test('legacy selection enables all and explicit Native subsets are canonical', () => {
  assert.deepEqual(parseHarnesses(undefined), ['native', 'pi', 'dsh']);
  assert.deepEqual(parseHarnesses('native'), ['native']);
  assert.deepEqual(parseHarnesses('native,dsh'), ['native', 'dsh']);
  assert.deepEqual(parseHarnesses(['pi', 'native']), ['native', 'pi']);
});

test('invalid selections fail instead of dropping enabled Harness validation', () => {
  for (const value of [
    '',
    [],
    'pi',
    'native,',
    'native,native',
    'native,unknown',
    ['native', 1],
    null,
    {},
  ])
    assert.throws(() => parseHarnesses(value), /Invalid harnesses/);
});
