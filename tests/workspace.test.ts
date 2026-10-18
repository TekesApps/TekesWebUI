import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace';
import type { Endpoint } from '../src/types';

type Call = {
  op: string;
  endpoint: string;
  method: string;
  rpcId: string;
  sessionId?: string;
  target?: string;
  payload: Record<string, unknown>;
};
async function ready(
  w: Workspace,
  condition = () => !w.snapshot().modelLoading && !w.snapshot().controlsLoading,
) {
  const deadline = Date.now() + 1000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'fixture authority did not settle');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
function fixture(
  t: TestContext,
  prompt: (call: Call) => Promise<unknown> = async () => ({ accepted: true }),
) {
  const calls: Call[] = [];
  const endpoints: Endpoint[] = ['tekes', 'pi'].map((kind) => ({
    id: kind,
    kind,
    name: kind,
    connection: 'ready',
    capabilities: {
      methods: [
        'session.initialPresets',
        'session.uploadFile',
        'attachments.policy',
      ],
      supportsArchiveSession: true,
    },
  }));
  const catalog = {
    groups: [
      {
        id: 'configured',
        models: [
          {
            id: 'model',
            reasoning: {
              defaultEffort: 'high',
              efforts: [{ id: 'low' }, { id: 'high' }],
            },
          },
        ],
      },
    ],
    current: { provider: 'configured', model: 'model' },
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      const call = JSON.parse(init.body as string) as Call;
      calls.push(call);
      let value: unknown = {};
      if (call.op === 'endpoints') value = endpoints;
      else if (call.op === 'host.info') value = { workspace: '/authorized' };
      else if (call.op === 'follow') {
        const value =
          call.target === 'state'
            ? {
                description: endpoints.find((e) => e.id === call.endpoint),
                sessions: [],
              }
            : {
                endpoint: call.endpoint,
                sessionId: call.sessionId,
                run: {
                  phase: 'idle',
                  canSubmit: true,
                  canCancel: false,
                  connection: { phase: 'connected' },
                  actionables: [],
                  queue: [],
                },
                transcript: {
                  items: [],
                  tools: [],
                  hasMoreBefore: false,
                  isStale: false,
                },
              };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify({ value }) + '\n'),
              );
              init.signal?.addEventListener(
                'abort',
                () => {
                  try {
                    controller.close();
                  } catch {
                    /* Reader already cancelled. */
                  }
                },
                { once: true },
              );
            },
          }),
        );
      } else if (['models.list', 'session.models'].includes(call.method))
        value = catalog;
      else if (call.method === 'session.initialPresets')
        value = {
          presets:
            call.endpoint === 'tekes'
              ? [{ id: 'coding' }, { id: 'general' }]
              : [{ id: 'default' }],
          defaultID: call.endpoint === 'tekes' ? 'coding' : 'default',
        };
      else if (call.method === 'attachments.policy')
        value = { inlineMediaTypes: [], maxAttachmentsPerMessage: 8 };
      else if (call.method === 'session.create')
        value = { sessionId: 'created' };
      else if (call.method === 'session.uploadFile')
        value = {
          receiptId: 'upload-receipt',
          file: {
            attachmentId: 'attachment',
            name: call.payload.name,
            bytes: Buffer.from(call.payload.data as string, 'base64').length,
          },
        };
      else if (call.method === 'session.prompt') value = await prompt(call);
      return Response.json({ value });
    },
  );
  return { calls, w: new Workspace() };
}
test('pending files and preset choices remain scoped to a Harness destination', async (t) => {
  const { w, calls } = fixture(t);
  try {
    await w.connect('browser');
    await ready(w);
    w.choosePreset('general');
    w.addFiles([new File(['kernel'], 'kernel.txt')]);
    w.setDraft('Kernel input');
    w.newSession('/authorized', 'pi');
    await ready(w);
    assert.equal(w.snapshot().attachments.length, 0);
    assert.equal(w.snapshot().draft, '');
    w.addFiles([new File(['pi'], 'pi.txt')]);
    w.setDraft('Pi input');
    w.newSession('/authorized', 'tekes');
    await ready(w);
    assert.equal(w.snapshot().preset, 'general');
    assert.equal(w.snapshot().attachments[0].file.name, 'kernel.txt');
    assert.equal(w.snapshot().draft, 'Kernel input');
    w.newSession('/authorized', 'pi');
    await ready(w);
    assert.equal(w.snapshot().attachments[0].file.name, 'pi.txt');
    assert.equal(w.snapshot().draft, 'Pi input');
    assert.equal(
      calls.filter(
        (c) =>
          c.method === 'session.uploadFile' || c.method === 'session.create',
      ).length,
      0,
    );
  } finally {
    w.dispose();
  }
});
test('upload precedes admission; an old acknowledgement preserves text typed while sending', async (t) => {
  let acknowledge!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const { w, calls } = fixture(t, async () => pending);
  try {
    await w.connect('browser');
    await ready(w);
    w.setDraft('Original');
    w.addFiles([new File(['Known bytes'], 'check.txt')]);
    const sending = w.submit();
    await ready(w, () => calls.some((c) => c.method === 'session.prompt'));
    assert.equal(w.snapshot().attachments.length, 1);
    w.setDraft('New input while waiting');
    acknowledge({ accepted: true });
    await sending;
    assert.equal(w.snapshot().draft, 'New input while waiting');
    assert.equal(w.snapshot().attachments.length, 0);
    assert.ok(
      calls.findIndex((c) => c.method === 'session.uploadFile') <
        calls.findIndex((c) => c.method === 'session.prompt'),
    );
    assert.equal(
      calls.find((c) => c.method === 'session.create')!.payload.identityProfile,
      'coding',
    );
    assert.deepEqual(
      calls.find((c) => c.method === 'session.prompt')!.payload.content,
      [
        { type: 'text', text: 'Original' },
        { type: 'file', receiptId: 'upload-receipt' },
      ],
    );
  } finally {
    w.dispose();
  }
});
test('uncertain admission retains files and reuses confirmed upload receipts on explicit retry', async (t) => {
  let attempts = 0;
  const { w, calls } = fixture(t, async () => {
    if (++attempts === 1) throw new Error('timeout');
    return { accepted: true };
  });
  try {
    await w.connect('browser');
    await ready(w);
    w.setDraft('Input');
    w.addFiles([new File(['Known'], 'check.txt')]);
    await w.submit();
    assert.match(w.snapshot().error, /可能已经提交/);
    assert.equal(w.snapshot().attachments.length, 1);
    assert.equal(attempts, 1);
    await w.submit();
    assert.equal(w.snapshot().error, '');
    assert.equal(w.snapshot().attachments.length, 0);
    const prompts = calls.filter((c) => c.method === 'session.prompt');
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].rpcId, prompts[1].rpcId);
    assert.equal(
      calls.filter((c) => c.method === 'session.uploadFile').length,
      1,
    );
    assert.equal(calls.filter((c) => c.method === 'session.create').length, 1);
  } finally {
    w.dispose();
  }
});
