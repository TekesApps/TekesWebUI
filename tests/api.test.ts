import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient, AuthenticationError } from '../src/api';

test('NDJSON handles fragmented UTF-8, multiple frames and heartbeat lines', async (t) => {
  const wire = new TextEncoder().encode(
    '\n{"value":{"text":"你好"}}\n\n{"value":{"text":"完成"}}\n',
  );
  const abort = new AbortController(),
    received: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < wire.length; i += 3)
              controller.enqueue(wire.slice(i, i + 3));
            controller.close();
          },
        }),
      ),
  );
  await new AgentClient('browser-token').follow<{ text: string }>(
    { endpoint: 'pi', target: 'state' },
    (value) => {
      received.push(value.text);
      if (received.length === 2) abort.abort();
    },
    abort.signal,
  );
  assert.deepEqual(received, ['你好', '完成']);
});
test('mutation passes its receipt unchanged and never automatically retries', async (t) => {
  let attempts = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      attempts++;
      assert.equal(JSON.parse(init.body as string).rpcId, 'stable-id');
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        'Bearer browser-token',
      );
      throw new Error('timeout');
    },
  );
  await assert.rejects(
    new AgentClient('browser-token').call(
      'kernel',
      'session.prompt',
      {},
      'stable-id',
    ),
    /timeout/,
  );
  assert.equal(attempts, 1);
});
test('authentication failure is explicit; stream errors do not masquerade as data', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}', { status: 401 }),
  );
  await assert.rejects(
    new AgentClient('bad').unary({ op: 'endpoints' }),
    AuthenticationError,
  );
});
test('NDJSON service error rejects instead of showing a connected idle view', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{"error":"History is unavailable"}\n'),
  );
  await assert.rejects(
    new AgentClient('token').follow(
      {},
      () => assert.fail('No data expected'),
      new AbortController().signal,
    ),
    /History is unavailable/,
  );
});
