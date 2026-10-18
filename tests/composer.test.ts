import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient } from '../src/api';
import {
  creationPreset,
  fileBase64,
  readPresets,
  validateFiles,
} from '../src/composer';
import { formatTimestamp, groupSessions, shortAge } from '../src/state';
import type { Endpoint, Session } from '../src/types';

const endpoint = (kind: string, methods: string[] = []): Endpoint => ({
  id: kind,
  name: kind,
  kind,
  connection: 'ready',
  capabilities: { methods },
});
test('Harness preset creation respects each native contract and never sends conflicting Kernel sugar', () => {
  assert.deepEqual(creationPreset(endpoint('tekes'), 'coding'), {
    identityProfile: 'coding',
  });
  assert.deepEqual(creationPreset(endpoint('pi'), 'default'), {
    agentPreset: 'default',
  });
  assert.deepEqual(creationPreset(endpoint('dsh'), 'minimal'), {
    agentPreset: 'minimal',
  });
  assert.deepEqual(creationPreset(endpoint('tekes'), null), {});
});
test('initial preset catalog keeps Harness configuration text unchanged', async (t) => {
  const catalog = {
    defaultID: 'general',
    presets: [
      {
        id: 'coding',
        title: 'Coding',
        configurationText: 'Harness-owned instructions',
      },
    ],
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      assert.equal(
        JSON.parse(init.body as string).method,
        'session.initialPresets',
      );
      return Response.json({ value: catalog });
    },
  );
  assert.deepEqual(
    await readPresets(
      new AgentClient('browser'),
      endpoint('tekes', ['session.initialPresets']),
    ),
    catalog,
  );
});
test('DSH composes actual preset roster and read-only document endpoints', async (t) => {
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string);
      calls.push(request.method);
      return Response.json({
        value:
          request.method === 'presets.list'
            ? {
                presets: [
                  { id: 'standard', isDefault: true },
                  { id: 'minimal' },
                ],
              }
            : { content: `Configuration for ${request.payload.agentPreset}` },
      });
    },
  );
  const catalog = await readPresets(
    new AgentClient('browser'),
    endpoint('dsh', ['presets.list', 'presets.read']),
  );
  assert.equal(catalog.defaultID, 'standard');
  assert.equal(
    catalog.presets[1].configurationText,
    'Configuration for minimal',
  );
  assert.deepEqual(calls.sort(), [
    'presets.list',
    'presets.read',
    'presets.read',
  ]);
});
test('file validation applies the Harness limits before any mutation', () => {
  const file = (bytes: number, name = 'check.txt', type = 'text/plain') =>
    new File([new Uint8Array(bytes)], name, { type });
  assert.throws(() => validateFiles([file(0)], [], null), /空文件/);
  assert.throws(
    () =>
      validateFiles([file(2), file(2)], [], {
        inlineMediaTypes: [],
        maxAttachmentsPerMessage: 1,
      }),
    /数量/,
  );
  assert.throws(
    () =>
      validateFiles([file(5)], [file(5)], {
        inlineMediaTypes: [],
        maxMessageAttachmentBytes: 8,
      }),
    /总大小/,
  );
  assert.throws(
    () => validateFiles([file(9 * 1024 * 1024)], [], null),
    /大小限制/,
  );
  assert.doesNotThrow(() =>
    validateFiles([file(8)], [], { inlineMediaTypes: [] }),
  );
});
test('binary upload encoding round-trips UTF-8 and non-text bytes', async () => {
  const bytes = new Uint8Array([0, 255, 17, 29, 128]);
  assert.deepEqual(
    Buffer.from(await fileBase64(new File([bytes], 'binary.dat')), 'base64'),
    Buffer.from(bytes),
  );
  assert.equal(
    Buffer.from(
      await fileBase64(new File(['附件验证'], 'check.txt')),
      'base64',
    ).toString(),
    '附件验证',
  );
});
test('list sorting and grouping are view-only preferences and preserve native addresses', () => {
  const rows: Session[] = [
    { sessionId: 'one', summary: { cwd: '/b', title: 'Zebra', updatedAt: 20 } },
    { sessionId: 'two', summary: { cwd: '/a', title: 'Alpha', updatedAt: 10 } },
  ];
  const inputs = new Map([['pi', rows]]),
    agents = [{ id: 'pi', name: 'Pi' }];
  const flat = groupSessions(agents, inputs, '', '', false, undefined, {
    grouping: false,
    sort: 'titleAscending',
  });
  assert.equal(flat.length, 1);
  assert.deepEqual(
    flat[0].entries.map((e) => e.sessionId),
    ['two', 'one'],
  );
  assert.equal(
    groupSessions(agents, inputs, '', '', false, undefined, {
      grouping: false,
      sort: 'titleDescending',
    })[0].entries[0].sessionId,
    'one',
  );
  assert.deepEqual(
    rows.map((e) => e.sessionId),
    ['one', 'two'],
  );
});
test('hover times normalize native timestamps and use local absolute dates', () => {
  const value = Date.parse('2026-10-18T08:00:00Z');
  assert.equal(
    formatTimestamp(value, 'Asia/Shanghai'),
    formatTimestamp(value / 1000, 'Asia/Shanghai'),
  );
  assert.match(
    formatTimestamp(value, 'Asia/Shanghai'),
    /2026.*10.*18.*16:00:00/,
  );
  assert.equal(formatTimestamp('invalid'), '');
  assert.equal(shortAge(value, value + 30_000), '刚刚');
  assert.equal(shortAge(value, value + 120_000), '2 分钟前');
});
