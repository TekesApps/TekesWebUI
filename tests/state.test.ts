import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addressKey,
  DraftStore,
  groupSessions,
  timestampMillis,
  shouldSend,
  scrollPolicy,
  safeLink,
  TitleReceipts,
  displayError,
} from '../src/state';
import type { Session } from '../src/types';

test('folder grouping combines Harnesses while preserving endpoint + session identities', () => {
  const rows = new Map<string, Session[]>([
    [
      'kernel',
      [
        {
          sessionId: 'same',
          summary: {
            cwd: '/work/project',
            title: 'Kernel',
            updatedAt: 1700000000,
          },
        },
      ],
    ],
    [
      'pi',
      [
        {
          sessionId: 'same',
          summary: {
            cwd: '/work/project',
            title: 'Pi',
            updatedAt: 1700000001000,
          },
        },
        {
          sessionId: 'scratch',
          summary: { cwd: '/work/project', ephemeral: true },
        },
      ],
    ],
  ]);
  const groups = groupSessions(
    [
      { id: 'kernel', name: 'Kernel' },
      { id: 'pi', name: 'Pi' },
    ],
    rows,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[0].entries[0].endpoint, 'pi');
  assert.notEqual(addressKey('pi', 'same'), addressKey('kernel', 'same'));
});
test('search and filters do not mutate authoritative inventories', () => {
  const rows: Session[] = [
    {
      sessionId: 'one',
      summary: { cwd: '/work/alpha', title: '计划', running: true },
    },
    { sessionId: 'two', summary: { cwd: '/work/beta', title: '总结' } },
    { sessionId: 'old', summary: { status: 'archived' } },
  ];
  const endpoints = [{ id: 'pi', name: 'Pi' }],
    inventories = new Map([['pi', rows]]);
  assert.equal(
    groupSessions(endpoints, inventories, 'alpha')[0].entries[0].sessionId,
    'one',
  );
  assert.equal(groupSessions(endpoints, inventories, '', '', true).length, 1);
  assert.equal(
    groupSessions(endpoints, inventories, '总结')[0].entries[0].sessionId,
    'two',
  );
  assert.equal(rows.length, 3);
});
test('native seconds, milliseconds and ISO timestamps sort consistently', () => {
  const expected = Date.parse('2026-10-18T00:00:00Z');
  for (const value of [expected, expected / 1000, '2026-10-18T00:00:00Z'])
    assert.equal(timestampMillis(value), expected);
  assert.equal(timestampMillis('not a date'), 0);
});
test('draft acknowledgement cannot erase newer input or another destination', () => {
  const memory = new Map<string, string>(),
    storage = {
      getItem: (key: string) => memory.get(key) || null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
  const drafts = new DraftStore(storage),
    a = addressKey('pi', 'same'),
    b = addressKey('kernel', 'same');
  drafts.set(a, 'first');
  drafts.set(b, 'other');
  drafts.set(a, 'new input');
  drafts.clearIfUnchanged(a, 'first');
  assert.equal(drafts.get(a), 'new input');
  assert.equal(drafts.get(b), 'other');
  assert.equal(new DraftStore(storage).get(a), 'new input');
  assert.notEqual(addressKey('pi', '', '/a'), addressKey('pi', '', '/b'));
});
test('Enter respects composition, legacy IME 229, Shift and Alt', () => {
  assert.equal(shouldSend({ key: 'Enter' }), true);
  for (const flags of [
    { isComposing: true },
    { keyCode: 229 },
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { ctrlKey: true },
  ])
    assert.equal(shouldSend({ key: 'Enter', ...flags }), false);
});
test('reading older content and text selection prevent auto-follow', () => {
  assert.equal(
    scrollPolicy({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }),
    true,
  );
  assert.equal(
    scrollPolicy({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }),
    false,
  );
  assert.equal(
    scrollPolicy(
      { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 },
      true,
    ),
    false,
  );
});
test('provider links cannot execute script or open local files', () => {
  for (const value of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,test',
    '/api',
  ])
    assert.equal(safeLink(value), null);
  assert.equal(safeLink('https://example.com/a'), 'https://example.com/a');
});
test('rename receipts bridge stream lag and yield to newer authority', () => {
  const receipts = new TitleReceipts();
  receipts.remember('kernel', 'one', 'Confirmed', 12);
  assert.equal(
    receipts.title('kernel', 'one', {
      projections: { asOfSeq: 10, values: { title: 'Old' } },
    }),
    'Confirmed',
  );
  assert.equal(
    receipts.title('pi', 'one', { title: 'Other Harness' }),
    'Other Harness',
  );
  assert.equal(
    receipts.title('kernel', 'one', {
      projections: { asOfSeq: 13, values: { title: 'Changed elsewhere' } },
    }),
    'Changed elsewhere',
  );
  assert.equal(receipts.values.size, 0);
});
test('uncertain mutations call for reconciliation and hide private error details', () => {
  assert.match(
    displayError(Error('request timed out; reconcile mutation receipt')),
    /可能已经提交/,
  );
  assert.match(
    displayError(Error('execution directory must match')),
    /默认工作目录/,
  );
  assert.equal(
    displayError(
      Error('remote: {"message":"Unavailable","details":{"trace":"private"}}'),
    ),
    'Unavailable',
  );
});
test('light and dark foreground roles preserve readable text contrast', async () => {
  const css = await readFile(
    new URL('../src/styles.css', import.meta.url),
    'utf8',
  );
  const brand = await readFile(
    new URL('../src/theme/brand.css', import.meta.url),
    'utf8',
  );
  const blocks = [
    css.match(/:root\s*\{([^}]+)\}/)![1] +
      brand.match(/:root\s*\{([^}]+)\}/)![1],
    css.match(/:root\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/)![1] +
      brand.match(/:root\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/)![1],
  ];
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const block of blocks) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    for (const [fg, bg] of [
      ['text', 'canvas'],
      ['secondary', 'sidebar'],
      ['tertiary', 'sidebar'],
      ['accent', 'canvas'],
      ['accent-foreground', 'action'],
      ['accent-foreground', 'action-hover'],
      ['accent-foreground', 'action-pressed'],
    ]) {
      const [low, high] = [luminance(tokens[fg]), luminance(tokens[bg])].sort(
        (a, b) => a - b,
      );
      assert.ok((high + 0.05) / (low + 0.05) >= 4.5, `${fg} on ${bg}`);
    }
  }
});
