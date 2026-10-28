import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace';
import type { AttachmentPolicy, Endpoint } from '../src/types';
import type { ThreadActionOutcome } from '@tekesagentkit/client-contract';
import { textFingerprint, type Annotation } from '../src/annotations';

type Call = {
  op?: string;
  endpoint: string;
  method?: string;
  actionableId?: string;
  expectedRevision?: number;
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

test('family child drafts stay scoped to parent and child destinations', () => {
  const w = new Workspace();
  const parent = { endpoint: 'native', sessionId: 'parent-a' };
  const otherParent = { endpoint: 'native', sessionId: 'parent-b' };
  w.setDraft('parent composer draft');
  w.setChildDraft(parent, 'child-a', 'first child draft');
  w.setChildDraft(parent, 'child-b', 'second child draft');
  w.setChildDraft(otherParent, 'child-a', 'other parent draft');

  assert.equal(w.childDraft(parent, 'child-a'), 'first child draft');
  assert.equal(w.childDraft(parent, 'child-b'), 'second child draft');
  assert.equal(w.childDraft(otherParent, 'child-a'), 'other parent draft');
  assert.equal(w.snapshot().draft, 'parent composer draft');
  w.dispose();
});

function fixture(
  t: TestContext,
  prompt: (call: Call) => Promise<unknown> = async () => ({ accepted: true }),
  action: (call: Call) => Promise<ThreadActionOutcome> = async (call) => ({
    clearSelection: call.payload.actionId === 'archive',
    ...(call.payload.actionId === 'rename'
      ? { renamedTitle: String(call.payload.title).trim(), renameSeq: 5 }
      : {}),
  }),
  picker: (call: Call) => Promise<{ path: string | null }> = async () => ({
    path: null,
  }),
  permissions?: (call: Call) => Promise<unknown>,
  attachmentPolicy: AttachmentPolicy = {
    inlineMediaTypes: [],
    maxAttachmentsPerMessage: 8,
  },
  reconnect?: (call: Call) => Promise<Endpoint>,
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
        'composer.compileAnnotations',
        'thread.actions',
        'thread.performAction',
        ...(permissions
          ? ['approvals.policy', 'approvals.mode', 'approvals.select']
          : []),
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
      else if (call.op === 'host.info')
        value = {
          workspace: '/authorized',
          directoryPicker: { endpoints: ['tekes', 'pi'] },
        };
      else if (call.op === 'host.pickDirectory') value = await picker(call);
      else if (call.op === 'reconnect')
        value = reconnect
          ? await reconnect(call)
          : endpoints.find((endpoint) => endpoint.id === call.endpoint)!;
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
      } else if (['models.list', 'session.models'].includes(call.method ?? ''))
        value = catalog;
      else if (call.method === 'session.initialPresets')
        value = {
          presets:
            call.endpoint === 'tekes'
              ? [{ id: 'coding' }, { id: 'general' }]
              : [{ id: 'default' }],
          defaultID: call.endpoint === 'tekes' ? 'coding' : 'default',
        };
      else if (call.method === 'attachments.policy') value = attachmentPolicy;
      else if (call.method?.startsWith('approvals.'))
        value = await permissions!(call);
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
      else if (call.method === 'composer.compileAnnotations')
        value = { text: 'AgentKit compiled annotation input' };
      else if (call.method === 'thread.actions')
        value = {
          endpoint: call.endpoint,
          sessionId: call.payload.sessionId,
          label: 'Kit Actions',
          items: [
            {
              id: 'rename',
              label: 'Kit rename',
              icon: 'rename',
              interaction: 'rename',
              enabled: true,
            },
            {
              id: 'futureAction',
              label: 'A future AgentKit action',
              icon: 'future',
              interaction: 'execute',
              enabled: true,
            },
          ],
        };
      else if (call.method === 'thread.performAction')
        value = await action(call);
      else if (call.method === 'session.rename')
        value = { title: call.payload.title, seq: 5 };
      else if (call.method === 'session.prompt') value = await prompt(call);
      return Response.json({ value });
    },
  );
  return { calls, endpoints, w: new Workspace() };
}

test('explicit reconnect sends one recovery request and never replays a business operation', async (t) => {
  let finish!: (endpoint: Endpoint) => void;
  const { w, calls, endpoints } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () =>
      new Promise<Endpoint>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await w.connect('browser');
    await ready(w);
    const before = calls.filter((call) => call.op === 'call').length;
    const first = w.reconnectEndpoint('tekes');
    const second = w.reconnectEndpoint('tekes');
    await ready(
      w,
      () => calls.filter((call) => call.op === 'reconnect').length === 1,
    );
    assert.equal(calls.filter((call) => call.op === 'call').length, before);
    finish({ ...endpoints[0], connection: 'ready', canReconnect: false });
    await Promise.all([first, second]);
    assert.equal(calls.filter((call) => call.op === 'reconnect').length, 1);
    assert.equal(
      w.snapshot().endpoints.find((endpoint) => endpoint.id === 'tekes')
        ?.connection,
      'ready',
    );
    assert.equal(
      calls.some(
        (call) => call.method === 'session.prompt' || call.op === 'respond',
      ),
      false,
    );
  } finally {
    w.dispose();
  }
});

test('explicit reconnect keeps authentication and protocol errors visible', async (t) => {
  let errorMessage = 'authentication expired';
  const { w, calls } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => {
      throw new Error(errorMessage);
    },
  );
  try {
    await w.connect('browser');
    await ready(w);
    for (const message of [
      'authentication expired',
      'protocol version mismatch',
    ]) {
      errorMessage = message;
      await w.reconnectEndpoint('tekes');
      assert.equal(w.snapshot().error, message);
    }
    assert.equal(calls.filter((call) => call.op === 'reconnect').length, 2);
    assert.equal(
      calls.some(
        (call) => call.method === 'session.prompt' || call.op === 'respond',
      ),
      false,
    );
  } finally {
    w.dispose();
  }
});

test('mixed image and file attachments follow the advertised inline policy in input order', async (t) => {
  const { w, calls } = fixture(t, undefined, undefined, undefined, undefined, {
    inlineMediaTypes: ['image/png'],
    maxAttachmentsPerMessage: 8,
  });
  try {
    await w.connect('browser');
    await ready(w);
    await w.select({ endpoint: 'tekes', sessionId: 'existing' });
    await ready(w);
    w.setDraft('Mixed attachment request');
    const pixels = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    w.addFiles([
      new File([pixels], 'first.png', { type: 'image/png' }),
      new File(['attached notes'], 'notes.txt', { type: 'text/plain' }),
      new File([pixels], 'second.png', { type: 'image/png' }),
    ]);
    await w.submit();

    const uploads = calls.filter(
      (call) => call.method === 'session.uploadFile',
    );
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].payload.name, 'notes.txt');
    const prompt = calls.find((call) => call.method === 'session.prompt');
    assert.deepEqual(prompt?.payload.content, [
      { type: 'text', text: 'Mixed attachment request' },
      {
        type: 'image',
        mediaType: 'image/png',
        name: 'first.png',
        data: btoa(String.fromCharCode(...pixels)),
      },
      { type: 'file', receiptId: 'upload-receipt' },
      {
        type: 'image',
        mediaType: 'image/png',
        name: 'second.png',
        data: btoa(String.fromCharCode(...pixels)),
      },
    ]);
  } finally {
    w.dispose();
  }
});

test('image media absent from the public inline policy uses the upload receipt path', async (t) => {
  const { w, calls } = fixture(t);
  try {
    await w.connect('browser');
    await ready(w);
    await w.select({ endpoint: 'tekes', sessionId: 'existing' });
    await ready(w);
    w.setDraft('Reference fallback');
    w.addFiles([
      new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' }),
    ]);
    await w.submit();

    assert.equal(
      calls.filter((call) => call.method === 'session.uploadFile').length,
      1,
    );
    assert.deepEqual(
      calls.find((call) => call.method === 'session.prompt')?.payload.content,
      [
        { type: 'text', text: 'Reference fallback' },
        { type: 'file', receiptId: 'upload-receipt' },
      ],
    );
  } finally {
    w.dispose();
  }
});

test('family approval responses stay bound to the pane endpoint after selection moves', async (t) => {
  const { w, calls } = fixture(t);
  try {
    await w.connect('browser');
    await ready(w);
    await w.select({ endpoint: 'tekes', sessionId: 'parent' });
    await ready(w);
    await w.select({ endpoint: 'pi', sessionId: 'other' });
    await ready(w);
    await w.respondAt('tekes', 'approval-1', 3, { outcome: 'allowed-once' });
    const response = calls.find((call) => call.op === 'respond');
    assert.equal(response?.endpoint, 'tekes');
    assert.equal(response?.actionableId, 'approval-1');
    assert.equal(response?.expectedRevision, 3);
  } finally {
    w.dispose();
  }
});
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

const quote: Annotation = {
  id: 'quote',
  excerpt: '原文',
  comment: '解释',
  source: 'Reply',
  sourceLocator: {
    endpoint: 'tekes',
    sessionId: 'source',
    itemId: 'reply',
    turnId: 't',
    kind: 'assistant',
    start: 0,
    end: 2,
    fingerprint: textFingerprint('原文'),
  },
};
test('missing AgentKit annotation capability preserves the draft without creating a session or sending a private fallback', async (t) => {
  const { w, calls, endpoints } = fixture(t);
  endpoints[0].capabilities!.methods =
    endpoints[0].capabilities!.methods!.filter(
      (method) => method !== 'composer.compileAnnotations',
    );
  try {
    await w.connect('browser');
    await ready(w);
    w.saveAnnotation(quote);
    await w.submit();
    assert.deepEqual(w.snapshot().annotations, [quote]);
    assert.match(w.snapshot().error, /AgentKit.*批注接口/);
    assert.equal(
      calls.filter(
        (c) => c.method === 'session.create' || c.method === 'session.prompt',
      ).length,
      0,
    );
  } finally {
    w.dispose();
  }
});
test('annotation-only prompts survive creation, failure and explicit retry with one durable payload and identity', async (t) => {
  let attempts = 0;
  const { w, calls } = fixture(t, async () => {
    if (++attempts === 1) throw new Error('timeout');
    return { accepted: true };
  });
  try {
    await w.connect('browser');
    await ready(w);
    w.saveAnnotation(quote);
    w.newSession('/authorized', 'pi');
    await ready(w);
    assert.equal(w.snapshot().annotations.length, 0);
    w.newSession('/authorized', 'tekes');
    await ready(w);
    assert.equal(w.canSend(), true);
    await w.submit();
    assert.equal(attempts, 1);
    assert.deepEqual(w.snapshot().annotations, [quote]);
    await w.submit();
    assert.equal(w.snapshot().annotations.length, 0);
    const prompts = calls.filter((c) => c.method === 'session.prompt');
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].rpcId, prompts[1].rpcId);
    const content = prompts[0].payload.content as { text: string }[];
    assert.equal(content[0].text, 'AgentKit compiled annotation input');
    assert.deepEqual(
      calls.find((c) => c.method === 'composer.compileAnnotations')!.payload,
      { text: '', annotations: [quote] },
    );
  } finally {
    w.dispose();
  }
});
test('old prompt acknowledgement cannot remove a newer annotation edit or a different destination draft', async (t) => {
  let acknowledge!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const { w, calls } = fixture(t, async () => pending);
  try {
    await w.connect('browser');
    await ready(w);
    w.saveAnnotation(quote);
    const sending = w.submit();
    await ready(w, () => calls.some((c) => c.method === 'session.prompt'));
    const target = w.snapshot().selected!;
    w.saveAnnotation({ ...quote, comment: 'new edit' });
    w.saveAnnotation({ ...quote, id: 'added' });
    w.newSession('/other', 'pi');
    await ready(w);
    w.saveAnnotation({ ...quote, id: 'other' });
    acknowledge({ accepted: true });
    await sending;
    assert.equal(w.snapshot().annotations[0].id, 'other');
    await w.select(target);
    await ready(w);
    assert.deepEqual(
      w.snapshot().annotations.map((a) => [a.id, a.comment]),
      [
        ['quote', 'new edit'],
        ['added', '解释'],
      ],
    );
  } finally {
    w.dispose();
  }
});

test('thread actions render shared definitions and dispatch to their explicit target without local menu policy', async (t) => {
  const { w, calls } = fixture(t);
  const shown = { endpoint: 'tekes', sessionId: 'shown' },
    other = { endpoint: 'pi', sessionId: 'other' };
  try {
    await w.connect('browser');
    await ready(w);
    await w.select(shown);
    await ready(w);
    const definition = await w.loadThreadActions(other);
    assert.equal(definition.items[1].label, 'A future AgentKit action');
    assert.deepEqual(
      w.snapshot().threadActions.get(JSON.stringify(['pi', 'other', '']))
        ?.items,
      definition.items,
    );
    await w.performThreadAction(other, 'rename', ' Other title ');
    await w.performThreadAction(other, 'archive');
    await w.performThreadAction(other, 'futureAction');
    assert.deepEqual(w.snapshot().selected, shown);
    assert.deepEqual(
      calls
        .filter((c) => c.method === 'thread.performAction')
        .map((c) => [c.endpoint, c.payload]),
      [
        [
          'pi',
          { sessionId: 'other', actionId: 'rename', title: ' Other title ' },
        ],
        ['pi', { sessionId: 'other', actionId: 'archive' }],
        ['pi', { sessionId: 'other', actionId: 'futureAction' }],
      ],
    );
    assert.equal(
      calls.filter((c) =>
        ['session.rename', 'session.archive'].includes(c.method ?? ''),
      ).length,
      0,
    );
  } finally {
    w.dispose();
  }
});
test('late action navigation cannot replace a newer user selection', async (t) => {
  let acknowledge!: (value: ThreadActionOutcome) => void;
  const pending = new Promise<ThreadActionOutcome>((resolve) => {
    acknowledge = resolve;
  });
  const { w, calls } = fixture(t, undefined, async () => pending);
  const source = { endpoint: 'tekes', sessionId: 'source' },
    other = { endpoint: 'pi', sessionId: 'other' };
  try {
    await w.connect('browser');
    await ready(w);
    await w.select(source);
    await ready(w);
    const action = w.performThreadAction(source, 'fork');
    await ready(w, () =>
      calls.some((c) => c.method === 'thread.performAction'),
    );
    await w.select(other);
    await ready(w);
    acknowledge({
      clearSelection: false,
      navigation: { endpoint: 'tekes', sessionId: 'child' },
    });
    await action;
    assert.deepEqual(w.snapshot().selected, other);
  } finally {
    w.dispose();
  }
});
test('uncertain thread mutations never retry automatically and explicit retry keeps identity', async (t) => {
  let attempts = 0;
  const { w, calls } = fixture(t, undefined, async () => {
    if (++attempts === 1) throw new Error('timeout');
    return { clearSelection: false };
  });
  const target = { endpoint: 'tekes', sessionId: 'source' };
  try {
    await w.connect('browser');
    await ready(w);
    await assert.rejects(w.performThreadAction(target, 'fork'));
    assert.equal(attempts, 1);
    await w.performThreadAction(target, 'fork');
    const mutations = calls.filter((c) => c.method === 'thread.performAction');
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0].rpcId, mutations[1].rpcId);
  } finally {
    w.dispose();
  }
});

test('an older service without action definitions reports an explicit error and never invents menu entries', async (t) => {
  const { w, endpoints, calls } = fixture(t);
  endpoints[0].capabilities!.methods =
    endpoints[0].capabilities!.methods!.filter(
      (method) => method !== 'thread.actions',
    );
  const target = { endpoint: 'tekes', sessionId: 'source' };
  try {
    await w.connect('browser');
    await ready(w);
    await assert.rejects(w.loadThreadActions(target), /AgentKit.*会话操作接口/);
    assert.equal(w.snapshot().threadActions.size, 0);
    assert.equal(w.snapshot().threadActionErrors.size, 1);
    assert.equal(calls.filter((c) => c.method === 'thread.actions').length, 0);
  } finally {
    w.dispose();
  }
});

test('native directory selection calls only the local host and cancellation preserves the draft and controls', async (t) => {
  let selected: string | null = null;
  const { w, calls } = fixture(t, undefined, undefined, async () => ({
    path: selected,
  }));
  try {
    await w.connect('browser');
    await ready(w);
    w.newSession('/authorized', 'tekes');
    await ready(w);
    w.setDraft('unsent');
    const before = w.snapshot();
    assert.equal(await w.pickDirectory(), null);
    assert.equal(w.snapshot().cwd, before.cwd);
    assert.equal(w.snapshot().draft, 'unsent');
    assert.deepEqual(w.snapshot().model, before.model);
    selected = '/chosen/project';
    assert.equal(await w.pickDirectory(), selected);
    const picks = calls.filter((c) => c.op === 'host.pickDirectory');
    assert.equal(picks.length, 2);
    assert.equal(picks[1].endpoint, 'tekes');
    assert.equal((picks[1] as unknown as { path: string }).path, '/authorized');
    assert.equal(
      calls.filter((c) => c.method?.startsWith('directories.')).length,
      0,
    );
    assert.equal(calls.filter((c) => c.method === 'session.create').length, 0);
    assert.equal(w.snapshot().directoryPicking, false);
    w.newSession(selected, 'tekes');
    await ready(w);
    w.setDraft('new directory task');
    await w.submit();
    assert.equal(
      calls.find((c) => c.method === 'session.create')!.payload.cwd,
      selected,
    );
    w.newSession('/authorized', 'tekes');
    await ready(w);
    assert.equal(w.snapshot().draft, 'unsent');
  } finally {
    w.dispose();
  }
});

test('an open native folder picker cannot replace a newer destination or open twice', async (t) => {
  let finish!: (value: { path: string | null }) => void;
  const { w, calls } = fixture(
    t,
    undefined,
    undefined,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await w.connect('browser');
    await ready(w);
    w.newSession('/authorized', 'tekes');
    await ready(w);
    const pick = w.pickDirectory();
    await ready(w, () => calls.some((c) => c.op === 'host.pickDirectory'));
    assert.equal(w.snapshot().directoryPicking, true);
    assert.equal(await w.pickDirectory(), null);
    w.newSession('/other', 'pi');
    await ready(w);
    finish({ path: '/late/result' });
    assert.equal(await pick, null);
    assert.equal(w.snapshot().cwd, '/other');
    assert.equal(w.snapshot().newEndpoint, 'pi');
    assert.equal(calls.filter((c) => c.op === 'host.pickDirectory').length, 1);
  } finally {
    w.dispose();
  }
});

const permissionPolicy = {
  threadLevel: [
    { value: 'read-only', title: 'Read Only' },
    { value: 'workspace-write', title: 'Workspace Write' },
    { value: 'danger-full-access', title: 'Full Access' },
  ],
  serverLevel: { options: [], currentValue: null },
};
function permissionFixture(
  t: TestContext,
  select?: (call: Call) => Promise<void>,
  read?: (call: Call) => Promise<string>,
) {
  const modes = new Map<string, string>();
  return fixture(t, undefined, undefined, undefined, async (call) => {
    if (call.method === 'approvals.policy') return permissionPolicy;
    const key = call.endpoint + ':' + call.payload.sessionId;
    if (call.method === 'approvals.select') {
      await select?.(call);
      modes.set(key, String(call.payload.mode));
      return { accepted: true };
    }
    return {
      mode: read ? await read(call) : modes.get(key) || 'workspace-write',
    };
  });
}
test('new-chat permission is applied and read back before any prompt; draft choice is destination scoped', async (t) => {
  const { w, calls } = permissionFixture(t);
  await w.connect('browser');
  await ready(w);
  await w.choosePermission('read-only');
  w.setDraft('request');
  assert.equal(
    calls.some((c) => c.method === 'approvals.select'),
    false,
  );
  w.newSession('/authorized', 'pi');
  await ready(w);
  assert.equal(w.snapshot().permissionMode, null);
  w.newSession('/authorized', 'tekes');
  await ready(w);
  assert.equal(w.snapshot().permissionMode, 'read-only');
  await w.submit();
  await ready(w);
  const selected = calls.findIndex((c) => c.method === 'approvals.select');
  const prompt = calls.findIndex((c) => c.method === 'session.prompt');
  assert.ok(selected >= 0 && prompt > selected);
  assert.equal(calls[selected].payload.mode, 'read-only');
  assert.ok(
    calls
      .slice(selected + 1, prompt)
      .some((c) => c.method === 'approvals.mode'),
  );
  assert.equal(w.snapshot().permissionMode, 'read-only');
  w.dispose();
});
test('failed permission update never admits a prompt and preserves the new-chat draft for explicit retry', async (t) => {
  let fail = true;
  const { w, calls } = permissionFixture(t, async () => {
    if (fail) throw new Error('permission refused');
  });
  await w.connect('browser');
  await ready(w);
  await w.choosePermission('read-only');
  w.setDraft('keep this input');
  await w.submit();
  assert.equal(
    calls.some((c) => c.method === 'session.prompt'),
    false,
  );
  assert.equal(w.snapshot().draft, 'keep this input');
  const create = calls.find((c) => c.method === 'session.create')!;
  fail = false;
  await w.submit();
  assert.equal(
    calls.filter((c) => c.method === 'session.create').at(-1)!.rpcId,
    create.rpcId,
  );
  assert.equal(calls.filter((c) => c.method === 'session.prompt').length, 1);
  w.dispose();
});
test('existing-session permission updates show only confirmed modes and late replies cannot overwrite another destination', async (t) => {
  let release!: () => void;
  let delaying = false;
  const { w } = permissionFixture(t, async () => {
    if (delaying)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  });
  await w.connect('browser');
  await ready(w);
  await w.select({ endpoint: 'tekes', sessionId: 'existing' });
  await ready(w);
  assert.equal(w.snapshot().permissionMode, 'workspace-write');
  await w.choosePermission('read-only');
  assert.equal(w.snapshot().permissionMode, 'read-only');
  delaying = true;
  const selecting = w.choosePermission('danger-full-access');
  assert.equal(w.snapshot().permissionMode, 'read-only');
  assert.equal(w.snapshot().permissionLoading, true);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  w.newSession('/other', 'pi');
  await ready(w);
  release();
  await selecting;
  assert.equal(w.snapshot().permissionMode, null);
  assert.equal(w.snapshot().permissionError, '');
  w.dispose();
});
test('unknown effective permissions are never guessed or used to admit a prompt', async (t) => {
  const { w, calls } = permissionFixture(
    t,
    undefined,
    async () => 'unknown-mode',
  );
  await w.connect('browser');
  await ready(w);
  await w.select({ endpoint: 'tekes', sessionId: 'existing' });
  await ready(w);
  w.setDraft('blocked');
  assert.ok(w.snapshot().permissionError);
  assert.equal(w.canSend(), false);
  await w.submit();
  assert.equal(
    calls.some((c) => c.method === 'session.prompt'),
    false,
  );
  w.dispose();
});

test('a policy changed by another client is read before admission instead of sending under a stale mode', async (t) => {
  let current = 'workspace-write';
  const { w, calls } = permissionFixture(t, undefined, async () => current);
  await w.connect('browser');
  await ready(w);
  await w.select({ endpoint: 'tekes', sessionId: 'existing' });
  await ready(w);
  assert.equal(w.snapshot().permissionMode, 'workspace-write');
  current = 'read-only';
  w.setDraft('keep the draft');
  await w.submit();
  assert.equal(
    calls.some((c) => c.method === 'session.prompt'),
    false,
  );
  assert.equal(w.snapshot().permissionMode, 'read-only');
  assert.equal(w.snapshot().draft, 'keep the draft');
  await w.submit();
  assert.equal(calls.filter((c) => c.method === 'session.prompt').length, 1);
  w.dispose();
});
