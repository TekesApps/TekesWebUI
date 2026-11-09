import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import App from '../src/App';
import { getLocale, setLocale } from '../src/i18n';
import type { SideChat, SideChatState } from '../src/sidechat';
import { addressKey } from '../src/state';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace';
import type { AttachmentPolicy, Endpoint, Session } from '../src/types';
import type {
  SessionPreset,
  SessionPresetResolution,
} from '../src/session-presets';
import type { ThreadActionOutcome } from '@tekesagentkit/client-contract';
import { textFingerprint, type Annotation } from '../src/annotations';
import parentDenial from './fixtures/j7-parent-denial.json';

type Call = {
  op?: string;
  endpoint: string;
  method?: string;
  actionableId?: string;
  expectedRevision?: number;
  rpcId: string;
  sessionId?: string;
  target?: string;
  connectionId?: string;
  workspaceId?: string;
  request?: Record<string, unknown>;
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

interface AdvancedPresetFixture {
  preview?: (call: Call) => Promise<unknown>;
  create?: (call: Call) => Promise<unknown>;
  models?: (call: Call) => Promise<unknown>;
}
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
  upload?: (call: Call) => Promise<unknown>,
  compileSkills?: (call: Call) => Promise<unknown>,
  workspaceService?: {
    advertised?: boolean;
    list?: () => Promise<unknown>;
    call?: (call: Call) => Promise<unknown>;
  },
  advancedPreset?: AdvancedPresetFixture,
  sideChat?: {
    runningSessions?: string[];
    call?: (call: Call) => Promise<unknown>;
  },
  harnessWorkspace?: (call: Call) => Promise<unknown>,
) {
  const calls: Call[] = [];
  const inventoryControllers = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  const endpoints: Endpoint[] = ['tekes', 'pi'].map((kind) => ({
    id: kind,
    kind,
    name: kind,
    connection: 'ready',
    ...(advancedPreset || sideChat ? { connectionEpoch: 7 } : {}),
    capabilities: {
      methods: [
        'session.initialPresets',
        'session.uploadFile',
        'attachments.policy',
        'composer.compileAnnotations',
        'agent.skills.compile',
        ...(sideChat
          ? [
              'agent.sideChat.state',
              'agent.sideChat.create',
              'agent.sideChat.close',
              'agent.sideChat.reconcile',
              'agent.sideChat.prompt',
              'agent.sideChat.cancel',
            ]
          : []),
        ...(advancedPreset && kind === 'tekes'
          ? ['agent.preset.describe', 'agent.preset.preview']
          : []),
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
          workspaceService: workspaceService?.advertised,
          directoryPicker: { endpoints: ['tekes', 'pi'] },
        };
      else if (call.op === 'workspace.list')
        value = workspaceService?.list
          ? await workspaceService.list()
          : { workspaces: [] };
      else if (call.op === 'workspace.call')
        value = workspaceService?.call
          ? await workspaceService.call(call)
          : { result: {} };
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
                  connectionEpoch: 7,
                  phase: sideChat?.runningSessions?.includes(
                    call.sessionId || '',
                  )
                    ? 'running'
                    : 'idle',
                  canSubmit: true,
                  canCancel:
                    sideChat?.runningSessions?.includes(
                      call.sessionId || '',
                    ) === true,
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
              if (call.target === 'state')
                inventoryControllers.set(call.endpoint, controller);
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
        value = advancedPreset?.models
          ? await advancedPreset.models(call)
          : catalog;
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
      else if (call.method === 'agent.preset.preview')
        value = advancedPreset?.preview
          ? await advancedPreset.preview(call)
          : {};
      else if (call.method === 'agent.preset.describe')
        value = {
          endpointId: call.endpoint,
          connectionEpoch: 7,
          description: {},
        };
      else if (call.method === 'session.create')
        value = advancedPreset?.create
          ? await advancedPreset.create(call)
          : { sessionId: 'created' };
      else if (call.method === 'session.uploadFile')
        value = upload
          ? await upload(call)
          : {
              receiptId: 'upload-receipt',
              file: {
                attachmentId: 'attachment',
                name: call.payload.name,
                bytes: Buffer.from(call.payload.data as string, 'base64')
                  .length,
              },
            };
      else if (call.method === 'agent.skills.compile')
        value = compileSkills
          ? await compileSkills(call)
          : {
              kind: 'prompt',
              content: [
                { type: 'text', text: 'compiled skill' },
                ...(call.payload.attachments as unknown[]),
              ],
              displayText: 'compiled skill',
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
      else if (
        call.method === 'session.prompt' ||
        call.method === 'agent.sideChat.prompt'
      )
        value = await prompt(call);
      else if (call.method === 'agent.workspace.read')
        value = harnessWorkspace ? await harnessWorkspace(call) : {};
      else if (call.method?.startsWith('agent.sideChat.'))
        value = sideChat?.call ? await sideChat.call(call) : {};
      return Response.json({ value });
    },
  );
  return {
    calls,
    endpoints,
    w: new Workspace(),
    emitInventory: (endpoint: string, sessions: Session[]) => {
      inventoryControllers.get(endpoint)?.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            value: {
              description: endpoints.find((entry) => entry.id === endpoint),
              sessions,
            },
          }) + '\n',
        ),
      );
    },
  };
}

test('Earlier completion and errors stay bound to the mounted view', async (t) => {
  for (const mode of [
    'switch',
    'return-to-same-address',
    'current-error',
    'current-success',
  ]) {
    await t.test(mode, async (t) => {
      const { w } = fixture(t);
      const baseFetch = globalThis.fetch;
      let finish: ((response: Response) => void) | undefined;
      t.mock.method(
        globalThis,
        'fetch',
        async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const body = JSON.parse(String(init?.body || '{}'));
          if (body.op === 'earlier')
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          return baseFetch(url, init);
        },
      );
      try {
        await w.connect('browser');
        await ready(w);
        await w.select({ endpoint: 'tekes', sessionId: 'a' });
        await ready(w, () => w.snapshot().view?.sessionId === 'a');
        const loading = w.earlier();
        await ready(w, () => Boolean(finish));
        if (mode === 'switch' || mode === 'return-to-same-address') {
          await w.select({ endpoint: 'tekes', sessionId: 'b' });
          await ready(w, () => w.snapshot().view?.sessionId === 'b');
          if (mode === 'return-to-same-address') {
            await w.select({ endpoint: 'tekes', sessionId: 'a' });
            await ready(w, () => w.snapshot().view?.sessionId === 'a');
          }
        }
        finish!(
          Response.json(
            mode === 'current-success'
              ? { value: { loaded: true } }
              : { error: 'protocol: stale history page result' },
          ),
        );
        assert.equal(
          await loading,
          mode === 'current-success',
          'only a current successful page can restore its reading anchor',
        );
        assert.equal(
          w.snapshot().error,
          mode === 'current-error' ? 'protocol: stale history page result' : '',
        );
      } finally {
        w.dispose();
      }
    });
  }
});

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
test('parent Task denial preserves the destination draft and controls while consuming the scoped Family contract', async (t) => {
  const { w, calls, endpoints } = fixture(t);
  const { identity, respond, sourceWitness, expected } = parentDenial;
  const address = {
    endpoint: identity.endpoint,
    sessionId: identity.parentSessionId,
  };
  endpoints[0].id = address.endpoint;
  let family = parentDenial.familyBefore;
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const call = JSON.parse(init.body as string) as Call;
    if (call.op === 'respond') {
      calls.push(call);
      assert.deepEqual(call, respond);
      family = parentDenial.familyAfter;
      return Response.json({ value: null });
    }
    if (call.method === 'agent.familySnapshot') {
      calls.push(call);
      assert.equal(call.endpoint, address.endpoint);
      assert.deepEqual(call.payload, { sessionId: address.sessionId });
      return Response.json({ value: family });
    }
    return fetch(url, init);
  });
  try {
    await w.connect('browser');
    await w.select(address);
    await ready(w);
    await ready(w, () => !!w.snapshot().view);
    w.setDraft(expected.parentDraft);
    const controls = () => ({
      busy: w.snapshot().busy,
      loading: w.snapshot().controlsLoading,
      error: w.snapshot().controlsError,
      canSend: w.canSend(),
      canSubmit: w.snapshot().view?.run.canSubmit,
      canCancel: w.snapshot().view?.run.canCancel,
    });
    const beforeControls = controls();
    assert.equal(beforeControls.canSend, true);
    const before = await w.familySnapshot(address);
    assert.deepEqual(before, parentDenial.familyBefore);
    assert.equal(before.summary.tasks[0].status, 'in_progress');
    assert.equal(sourceWitness.actionable.id, identity.actionableId);
    assert.equal(sourceWitness.actionable.revision, identity.revision);
    const sourceCall = sourceWitness.journalEntriesBefore.find(
      ({ event }) => event.type === 'tool/call',
    )!;
    assert.equal(sourceCall.event.data.callId, identity.callId);
    assert.equal(
      sourceWitness.deniedEntry.event.data.message.source.callId,
      identity.callId,
    );
    assert.deepEqual(sourceWitness.deniedEntry.event.data.error, {
      code: 'denied',
      name: 'Denied',
    });
    await w.respondAt(
      respond.endpoint,
      respond.actionableId,
      respond.expectedRevision,
      respond.outcome,
    );
    const after = await w.familySnapshot(address);
    assert.deepEqual(after, parentDenial.familyAfter);
    assert.equal(after.connectionEpoch, before.connectionEpoch);
    assert.equal(after.connectionEpoch, identity.connectionEpoch);
    assert.deepEqual(after.summary.scope, before.summary.scope);
    assert.equal(after.summary.tasks[0].id, identity.taskId);
    assert.equal(after.summary.tasks[0].id, before.summary.tasks[0].id);
    assert.equal(after.summary.tasks[0].status, 'error');
    assert.ok(after.subagentCatalog);
    assert.deepEqual(after.subagentCatalog, sourceWitness.publicCatalog);
    assert.equal(after.subagentCatalog.parentAvailable, true);
    assert.equal(
      after.subagentCatalog.entries.filter(({ kind }) => kind === 'child')
        .length,
      expected.acceptedChildCount,
    );
    assert.deepEqual(w.snapshot().selected, address);
    assert.equal(w.snapshot().draft, expected.parentDraft);
    assert.deepEqual(controls(), beforeControls);
    assert.equal(
      calls.filter(({ op }) => op === 'respond').length,
      expected.responseCount,
    );
    assert.equal(
      calls.some(({ method }) =>
        ['session.create', 'session.prompt', 'session.cancel'].includes(
          method ?? '',
        ),
      ),
      false,
    );
    // The supplied Family outputs are a synthetic contract, not a live Core
    // projection. respondAt carries no epoch; caller frame guards are separate.
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
test('submission-stage stays with its destination when another acknowledgement settles', async (t) => {
  for (const outcome of ['accepted', 'failed']) {
    await t.test(outcome, async (t) => {
      let acknowledgeA!: (value: unknown) => void,
        rejectA!: (error: Error) => void,
        acknowledgeB!: (value: unknown) => void,
        uploadB!: (value: unknown) => void;
      const pendingA = new Promise((resolve, reject) => {
        acknowledgeA = resolve;
        rejectA = reject;
      });
      const pendingB = new Promise((resolve) => {
        acknowledgeB = resolve;
      });
      const pendingUpload = new Promise((resolve) => {
        uploadB = resolve;
      });
      const { w, calls } = fixture(
        t,
        async (call) => (call.payload.sessionId === 'A' ? pendingA : pendingB),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        async (call) =>
          call.payload.sessionId === 'B'
            ? pendingUpload
            : {
                receiptId: 'A-upload',
                file: {
                  bytes: Buffer.from(call.payload.data as string, 'base64')
                    .length,
                },
              },
      );
      const a = { endpoint: 'tekes', sessionId: 'A' },
        b = { endpoint: 'pi', sessionId: 'B' };
      try {
        await w.connect('browser');
        await w.select(a);
        await ready(w);
        w.setDraft('A original');
        w.saveAnnotation(quote);
        const aFile = new File(['A original file'], 'A-check.txt');
        w.addFiles([aFile]);
        await ready(w, () => w.canSend());
        const sendingA = w.submit();
        await ready(w, () =>
          calls.some(
            (c) => c.method === 'session.prompt' && c.payload.sessionId === 'A',
          ),
        );
        const sendingStage = w.snapshot().submissionStage;
        w.setDraft('A newer');
        w.saveAnnotation({ ...quote, comment: 'A newer annotation' });
        await w.select(b);
        await ready(w);
        w.setDraft('B original');
        w.saveAnnotation({ ...quote, id: 'B-quote' });
        const bFile = new File(['Known B bytes'], 'B-check.txt');
        w.addFiles([bFile]);
        await ready(w, () => w.canSend());
        const sendingB = w.submit();
        await ready(w, () =>
          calls.some(
            (c) =>
              c.method === 'session.uploadFile' && c.payload.sessionId === 'B',
          ),
        );
        const uploadingStage = w.snapshot().submissionStage;
        assert.ok(uploadingStage);
        assert.notEqual(uploadingStage, sendingStage);
        w.setDraft('B newer');
        w.saveAnnotation({
          ...quote,
          id: 'B-quote',
          comment: 'B newer annotation',
        });
        if (outcome === 'accepted') acknowledgeA({ accepted: true });
        else rejectA(new Error('A admission failed'));
        await sendingA;
        assert.equal(w.snapshot().submissionStage, uploadingStage);
        assert.equal(w.snapshot().busy, true);
        assert.deepEqual(w.snapshot().selected, b);
        assert.equal(w.snapshot().draft, 'B newer');
        assert.deepEqual(
          w.snapshot().attachments.map((f) => f.file),
          [bFile],
        );
        assert.equal(w.snapshot().annotations[0].comment, 'B newer annotation');
        await w.select(a);
        await ready(w);
        assert.equal(w.snapshot().submissionStage, '');
        assert.equal(w.snapshot().draft, 'A newer');
        assert.deepEqual(
          w.snapshot().attachments.map((f) => f.file),
          outcome === 'accepted' ? [] : [aFile],
        );
        assert.equal(w.snapshot().annotations[0].comment, 'A newer annotation');
        await w.select(b);
        await ready(w);
        assert.equal(w.snapshot().submissionStage, uploadingStage);
        uploadB({ receiptId: 'B-upload', file: { bytes: bFile.size } });
        await ready(w, () =>
          calls.some(
            (c) => c.method === 'session.prompt' && c.payload.sessionId === 'B',
          ),
        );
        assert.equal(w.snapshot().submissionStage, sendingStage);
        acknowledgeB({ accepted: true });
        await sendingB;
        assert.equal(w.snapshot().submissionStage, '');
        assert.equal(w.snapshot().busy, false);
        assert.equal(w.snapshot().draft, 'B newer');
        assert.deepEqual(
          w.snapshot().attachments.map((f) => f.file),
          [],
        );
        assert.equal(w.snapshot().annotations[0].comment, 'B newer annotation');
      } finally {
        acknowledgeA({ accepted: true });
        acknowledgeB({ accepted: true });
        uploadB({ receiptId: 'cleanup', file: { bytes: 13 } });
        w.dispose();
      }
    });
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

const permissionCommand = {
  name: 'browser-command-proof',
  title: 'Browser command proof',
  description: '',
  argumentHint: null,
  supportsAttachments: false,
};

test('completed commands refresh confirmed permission and model before a skill draft is sent once', async (t) => {
  let mode = 'workspace-write';
  let changed = false;
  let commands = 0;
  const { w, calls } = permissionFixture(t, undefined, async () => mode);
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const call = JSON.parse(String(init?.body || '{}')) as Call;
      if (call.method === 'agent.command.run') {
        commands++;
        changed = true;
        mode = 'read-only';
        return Response.json({
          value: {
            commandId: 'completed-command',
            accepted: true,
            text: 'permission read-only',
          },
        });
      }
      if (changed && call.method === 'session.models') {
        calls.push(call);
        return Response.json({
          value: {
            groups: [{ id: 'configured', models: [{ id: 'command-model' }] }],
            current: { provider: 'configured', model: 'command-model' },
          },
        });
      }
      return originalFetch(url, init);
    },
  );
  await w.connect('browser');
  const address = { endpoint: 'tekes', sessionId: 'existing' };
  await w.select(address);
  await ready(w);
  assert.equal(w.snapshot().permissionMode, 'workspace-write');
  w.setDraft('keep this skill draft');
  w.selectSkill(address, {
    id: 'review',
    name: 'review',
    title: 'Review',
    description: '',
    selectable: true,
  });
  const receipt = await w.runCommand(address, 7, permissionCommand, '');
  assert.equal(receipt.commandId, 'completed-command');
  assert.equal(w.snapshot().permissionMode, 'read-only');
  assert.equal(w.snapshot().model?.model, 'command-model');
  assert.equal(w.snapshot().draft, 'keep this skill draft');
  assert.equal(w.snapshot().skills[0]?.id, 'review');
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    0,
  );
  await w.submit();
  assert.equal(
    calls.filter((call) => call.method === 'agent.skills.compile').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    1,
  );
  assert.equal(commands, 1);
  assert.equal(w.snapshot().error, '');
  w.dispose();
});

test('a late command completion cannot refresh another destination or clear either draft', async (t) => {
  const { w, calls } = permissionFixture(t);
  const originalFetch = globalThis.fetch;
  let finish!: (value: Response) => void;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const call = JSON.parse(String(init?.body || '{}')) as Call;
      if (call.method === 'agent.command.run')
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return originalFetch(url, init);
    },
  );
  await w.connect('browser');
  const address = { endpoint: 'tekes', sessionId: 'existing' };
  await w.select(address);
  await ready(w);
  w.setDraft('origin draft');
  const pending = w.runCommand(address, 7, permissionCommand, '');
  await ready(w, () => !!finish);
  assert.equal(w.canSend(), false);
  await w.select({ endpoint: 'pi', sessionId: 'other' });
  await ready(w);
  w.setDraft('destination draft');
  const readCount = calls.filter(
    (call) =>
      call.method === 'approvals.mode' || call.method === 'session.models',
  ).length;
  finish(
    Response.json({
      value: { commandId: 'late-command', accepted: true, text: null },
    }),
  );
  await pending;
  assert.equal(
    calls.filter(
      (call) =>
        call.method === 'approvals.mode' || call.method === 'session.models',
    ).length,
    readCount,
  );
  assert.equal(w.snapshot().draft, 'destination draft');
  await w.select(address);
  await ready(w);
  assert.equal(w.snapshot().draft, 'origin draft');
  w.dispose();
});

test('selected skills compile through AgentKit, preserve attachments and stay in the originating draft', async (t) => {
  const { w, calls } = fixture(t);
  await w.connect('token');
  const address = { endpoint: 'tekes', sessionId: 'existing' };
  await w.select(address);
  await ready(w);
  w.selectSkill(address, {
    id: 'review',
    name: 'review',
    title: 'Review',
    description: '',
    selectable: true,
  });
  w.setDraft('review this');
  w.addFiles([new File(['proof'], 'proof.txt', { type: 'text/plain' })]);
  await w.select({ endpoint: 'pi', sessionId: 'other' });
  await ready(w);
  assert.deepEqual(w.snapshot().skills, []);
  await w.select(address);
  await ready(w);
  assert.equal(w.snapshot().skills[0].id, 'review');
  await w.submit();
  const compile = calls.find((c) => c.method === 'agent.skills.compile')!;
  const send = calls.find((c) => c.method === 'session.prompt')!;
  assert.equal(compile.payload.connectionEpoch, 7);
  assert.deepEqual(compile.payload.skillIds, ['review']);
  assert.deepEqual(compile.payload.attachments, [
    { type: 'file', receiptId: 'upload-receipt' },
  ]);
  assert.deepEqual(send.payload.content, [
    { type: 'text', text: 'compiled skill' },
    { type: 'file', receiptId: 'upload-receipt' },
  ]);
  assert.equal(w.snapshot().skills.length, 0);
  w.dispose();
});

test('failed skill compilation sends nothing and preserves the selected skill and text', async (t) => {
  const { w, calls } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => {
      throw new Error('skill removed from catalog');
    },
  );
  await w.connect('token');
  const address = { endpoint: 'tekes', sessionId: 'existing' };
  await w.select(address);
  await ready(w);
  w.setDraft('keep this');
  w.selectSkill(address, {
    id: 'review',
    name: 'review',
    title: 'Review',
    description: '',
    selectable: true,
  });
  await w.submit();
  assert.equal(calls.filter((c) => c.method === 'session.prompt').length, 0);
  assert.equal(w.snapshot().draft, 'keep this');
  assert.equal(w.snapshot().skills[0].id, 'review');
  assert.match(w.snapshot().error, /skill removed/);
  w.dispose();
});

test('an older host never invents a workspace connection or probes an unsupported workspace API', async (t) => {
  const { w, calls } = fixture(t);
  await w.connect('token');
  assert.equal(w.snapshot().workspaceServiceAvailable, false);
  assert.deepEqual(w.snapshot().workspaceServices, []);
  assert.equal(
    calls.some((call) => call.op === 'workspace.list'),
    false,
  );
  await assert.rejects(
    w.workspaceServiceCall(
      'invented',
      'cwd-as-id',
      'filesList',
      { path: '' },
      'rpc',
    ),
    /宿主授权/,
  );
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  assert.equal(w.snapshot().authenticated, true);
  w.dispose();
});

test('workspace requests use the host registry, preserve the mutation rpc identity and propagate unknown outcomes once', async (t) => {
  const { w, calls } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      advertised: true,
      list: async () => ({
        workspaces: [
          {
            connectionId: 'host-connection',
            workspaceId: 'opaque-project',
            title: 'Registered project',
          },
        ],
      }),
      call: async () => ({
        error: {
          code: 'outcome-unknown',
          message: 'Check current state',
          details: { operation: 'rpc-write' },
        },
      }),
    },
  );
  await w.connect('token');
  await ready(w, () => !w.snapshot().workspaceServicesLoading);
  assert.equal(w.snapshot().workspaceServices[0].workspaceId, 'opaque-project');
  w.setDraft('keep the conversation draft');
  await assert.rejects(
    w.workspaceServiceCall(
      'host-connection',
      'opaque-project',
      'filesWrite',
      {
        workspaceId: 'opaque-project',
        path: 'proof.txt',
        content: 'YQ==',
        expectedRevision: 'old',
      },
      'rpc-write',
    ),
    (cause: unknown) =>
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'outcome-unknown',
  );
  const wire = calls.find((call) => call.op === 'workspace.call')!;
  assert.equal(wire.rpcId, 'rpc-write');
  assert.equal(wire.connectionId, 'host-connection');
  assert.equal(wire.workspaceId, 'opaque-project');
  assert.deepEqual(wire.request, {
    path: 'proof.txt',
    content: 'YQ==',
    expectedRevision: 'old',
  });
  assert.equal(calls.filter((call) => call.op === 'workspace.call').length, 1);
  assert.equal(w.snapshot().draft, 'keep the conversation draft');
  await assert.rejects(
    w.workspaceServiceCall(
      'host-connection',
      'opaque-project',
      'filesList',
      { workspaceId: 'other', path: '' },
      'wrong-scope',
    ),
    /来源已变化/,
  );
  assert.equal(calls.filter((call) => call.op === 'workspace.call').length, 1);
  w.dispose();
});

test('late workspace inventories cannot replace a new host', async (t) => {
  let resolve!: (value: unknown) => void;
  const first = new Promise((done) => {
    resolve = done;
  });
  let count = 0;
  const { w } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      advertised: true,
      list: async () =>
        ++count === 1
          ? first
          : {
              workspaces: [
                {
                  connectionId: 'second-host',
                  workspaceId: 'second',
                  title: 'Second project',
                },
              ],
            },
    },
  );
  await w.connect('first-token');
  await w.connect('second-token');
  await ready(w, () => !w.snapshot().workspaceServicesLoading);
  resolve({
    workspaces: [
      {
        connectionId: 'first-host',
        workspaceId: 'first',
        title: 'First project',
      },
    ],
  });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(w.snapshot().workspaceServices[0].workspaceId, 'second');
  assert.equal(w.snapshot().authenticated, true);
  w.dispose();
});

test('workspace directory failures stay visible without disconnecting session APIs', async (t) => {
  const { w } = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      advertised: true,
      list: async () => {
        throw new Error('registry unavailable');
      },
    },
  );
  await w.connect('token');
  await ready(w, () => !w.snapshot().workspaceServicesLoading);
  assert.equal(w.snapshot().authenticated, true);
  assert.equal(w.snapshot().workspaceServicesError, 'registry unavailable');
  assert.deepEqual(w.snapshot().workspaceServices, []);
  assert.equal(w.snapshot().error, '');
  w.dispose();
});

function advancedFixture(t: TestContext, options: AdvancedPresetFixture = {}) {
  return fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options,
  );
}
function presetResolution(
  preset: SessionPreset,
  digest = 'sha256-preview',
): SessionPresetResolution {
  return {
    base: 'general',
    layers: (preset.layers || []).map((layer) => ({
      kind: layer.kind,
      id: layer.id,
      version: layer.kind === 'inline' ? layer.version : '1',
    })),
    presetText: 'Previewed preset',
    digest,
    ...(preset.defaults ? { defaults: preset.defaults } : {}),
  };
}
async function applyPreset(w: Workspace, preset: SessionPreset) {
  const result = await w.previewAdvancedPreset(
    'tekes',
    '/authorized',
    7,
    preset,
  );
  w.applyAdvancedPreset('tekes', '/authorized', 7, preset, result.resolution);
  return result;
}
function presetModels(call: Call) {
  return Promise.resolve({
    groups: [
      { id: 'configured', models: [{ id: 'model' }, { id: 'preset-model' }] },
    ],
    current: {
      provider: 'configured',
      model: call.payload.sessionId ? 'preset-model' : 'model',
    },
  });
}

test('advanced preset submission captures the applied selection, waits for inventory identity and never overwrites resolved defaults', async (t) => {
  let emit!: (endpoint: string, sessions: Session[]) => void;
  let beforeInventoryPrompts = -1;
  let calls: Call[] = [];
  const fixtureState = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: call.payload.connectionEpoch,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
    models: presetModels,
    create: async () => {
      setTimeout(() => {
        beforeInventoryPrompts = calls.filter(
          (call) => call.method === 'session.prompt',
        ).length;
        emit('tekes', [
          {
            sessionId: 'created',
            summary: {
              cwd: '/authorized',
              preset: { base: 'general', digest: 'sha256-preview' },
            },
          },
        ]);
      }, 20);
      return { sessionId: 'created' };
    },
  });
  const { w } = fixtureState;
  calls = fixtureState.calls;
  emit = fixtureState.emitInventory;
  await w.connect('token');
  await ready(w);
  const preset: SessionPreset = {
    layers: [
      {
        kind: 'inline',
        id: 'reviewer',
        version: '1',
        duty: 'Review carefully',
      },
    ],
    defaults: { provider: 'configured', model: 'preset-model' },
  };
  const expected = structuredClone(preset);
  const preview = await applyPreset(w, preset);
  preset.layers = [];
  preview.resolution.defaults!.model = 'changed-after-apply';
  w.setDraft('start the applied preset');
  await w.submit();
  const create = calls.find((call) => call.method === 'session.create')!;
  assert.deepEqual(create.payload, { cwd: '/authorized', preset: expected });
  assert.equal('identityProfile' in create.payload, false);
  assert.equal('agentPreset' in create.payload, false);
  assert.equal(
    calls.some((call) => call.method === 'session.selectModel'),
    false,
  );
  assert.equal(beforeInventoryPrompts, 0);
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    1,
  );
  assert.equal(w.snapshot().model?.model, 'preset-model');
  w.dispose();
});

test('a changed preview scope or edited preset cannot be applied or create a session', async (t) => {
  let release!: (value: unknown) => void;
  const delayed = new Promise((done) => {
    release = done;
  });
  const { w, calls } = advancedFixture(t, { preview: async () => delayed });
  await w.connect('token');
  await ready(w);
  const preset: SessionPreset = { tools: ['read'] };
  const preview = w.previewAdvancedPreset('tekes', '/authorized', 7, preset);
  w.newSession('/other', 'tekes');
  release({
    endpointId: 'tekes',
    connectionEpoch: 7,
    preset,
    resolution: presetResolution(preset),
  });
  await assert.rejects(preview, /预览与当前草稿不一致/);
  assert.throws(
    () =>
      w.applyAdvancedPreset(
        'tekes',
        '/authorized',
        7,
        preset,
        presetResolution(preset),
      ),
    /预览已失效/,
  );
  assert.equal(
    calls.some((call) =>
      ['session.create', 'session.prompt'].includes(call.method || ''),
    ),
    false,
  );
  w.dispose();
});

test('applied presets keep their draft but become unsendable after the endpoint epoch changes until previewed again or cleared', async (t) => {
  const { w, calls, endpoints, emitInventory } = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: call.payload.connectionEpoch,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
  });
  await w.connect('token');
  await ready(w);
  await applyPreset(w, { tools: ['read'] });
  w.setDraft('keep this');
  endpoints[0].connectionEpoch = 8;
  emitInventory('tekes', []);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(w.snapshot().advancedPreset?.connectionEpoch, 7);
  assert.equal(w.canSend(), false);
  await w.submit();
  assert.equal(
    calls.some((call) => call.method === 'session.create'),
    false,
  );
  w.clearAdvancedPreset();
  assert.equal(w.snapshot().advancedPreset, null);
  assert.equal(w.canSend(), true);
  w.dispose();
});

test('a failed preset preview and unpreviewed edits do not apply or send anything', async (t) => {
  const { w, calls } = advancedFixture(t, {
    preview: async () => {
      throw new Error('resolver rejected preset');
    },
  });
  await w.connect('token');
  await ready(w);
  await assert.rejects(
    w.previewAdvancedPreset('tekes', '/authorized', 7, { tools: ['read'] }),
    /resolver rejected/,
  );
  assert.throws(
    () =>
      w.applyAdvancedPreset(
        'tekes',
        '/authorized',
        7,
        { tools: ['write'] },
        presetResolution({ tools: ['write'] }),
      ),
    /预览已失效/,
  );
  assert.equal(w.snapshot().advancedPreset, null);
  assert.equal(
    calls.some((call) =>
      ['session.create', 'session.prompt'].includes(call.method || ''),
    ),
    false,
  );
  w.dispose();
});

test('a mismatched created preset stops before prompt and keeps the created session and draft without another create', async (t) => {
  let emit!: (endpoint: string, sessions: Session[]) => void;
  const state = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: 7,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
    create: async () => {
      setTimeout(
        () =>
          emit('tekes', [
            {
              sessionId: 'created',
              summary: { preset: { digest: 'sha256-other' } },
            },
          ]),
        0,
      );
      return { sessionId: 'created' };
    },
  });
  const { w, calls } = state;
  emit = state.emitInventory;
  await w.connect('token');
  await ready(w);
  await applyPreset(w, { tools: ['read'] });
  w.setDraft('retain after mismatch');
  await w.submit();
  assert.equal(w.snapshot().selected?.sessionId, 'created');
  assert.equal(w.snapshot().draft, 'retain after mismatch');
  assert.match(w.snapshot().error, /预设与预览不一致/);
  assert.equal(
    calls.filter((call) => call.method === 'session.create').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    0,
  );
  await w.submit();
  assert.equal(
    calls.filter((call) => call.method === 'session.create').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    0,
  );
  w.dispose();
});

test('advanced presets without defaults preserve ordinary model choice and basic preset selection clears the override', async (t) => {
  let emit!: (endpoint: string, sessions: Session[]) => void;
  const state = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: 7,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
    create: async () => {
      setTimeout(
        () =>
          emit('tekes', [
            {
              sessionId: 'created',
              summary: { preset: { digest: 'sha256-preview' } },
            },
          ]),
        0,
      );
      return { sessionId: 'created' };
    },
  });
  const { w, calls } = state;
  emit = state.emitInventory;
  await w.connect('token');
  await ready(w);
  await applyPreset(w, { tools: ['read'] });
  w.choosePreset('general');
  assert.equal(w.snapshot().advancedPreset, null);
  await applyPreset(w, { tools: ['read'] });
  w.setDraft('ordinary model');
  await w.submit();
  assert.equal(
    calls.filter((call) => call.method === 'session.selectModel').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    1,
  );
  w.dispose();
});

test('a created preset with an unexpected default model remains unadmitted on later explicit sends', async (t) => {
  let emit!: (endpoint: string, sessions: Session[]) => void;
  const state = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: 7,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
    create: async () => {
      setTimeout(
        () =>
          emit('tekes', [
            {
              sessionId: 'created',
              summary: { preset: { digest: 'sha256-preview' } },
            },
          ]),
        0,
      );
      return { sessionId: 'created' };
    },
    models: async () => ({
      groups: [
        { id: 'configured', models: [{ id: 'model' }, { id: 'preset-model' }] },
      ],
      current: { provider: 'configured', model: 'model' },
    }),
  });
  const { w, calls } = state;
  emit = state.emitInventory;
  await w.connect('token');
  await ready(w);
  await applyPreset(w, {
    defaults: { provider: 'configured', model: 'preset-model' },
  });
  w.setDraft('retain model mismatch');
  await w.submit();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(w.snapshot().selected?.sessionId, 'created');
  assert.match(w.snapshot().error, /启动模型尚未与预设一致/);
  assert.equal(w.snapshot().draft, 'retain model mismatch');
  await w.submit();
  assert.equal(
    calls.filter((call) => call.method === 'session.create').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    0,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.selectModel').length,
    0,
  );
  w.dispose();
});

test('a create acknowledgement without a session identity never sends a prompt or performs an automatic second create', async (t) => {
  const { w, calls } = advancedFixture(t, {
    preview: async (call) => ({
      endpointId: call.endpoint,
      connectionEpoch: 7,
      preset: call.payload.preset,
      resolution: presetResolution(call.payload.preset as SessionPreset),
    }),
    create: async () => ({}),
  });
  await w.connect('token');
  await ready(w);
  await applyPreset(w, { tools: ['read'] });
  w.setDraft('retain unknown identity');
  await w.submit();
  assert.match(w.snapshot().error, /未包含会话身份/);
  assert.equal(w.snapshot().draft, 'retain unknown identity');
  assert.equal(w.snapshot().selected, null);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(
    calls.filter((call) => call.method === 'session.create').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.prompt').length,
    0,
  );
  w.dispose();
});

function sideChatFixture(
  t: TestContext,
  prompt?: (call: Call) => Promise<unknown>,
  options?: {
    runningSessions?: string[];
    call?: (call: Call) => Promise<unknown>;
  },
) {
  return fixture(
    t,
    prompt,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options || {},
  );
}
function temporaryChat(
  sessionId = 'scratch-child',
  handle = 'side-handle',
): SideChat {
  return {
    handle,
    parent: { endpointId: 'tekes', threadId: 'parent', sessionId: 'parent' },
    scope: { endpointId: 'tekes', threadId: sessionId, sessionId },
    connectionEpoch: 7,
    title: 'Temporary branch',
    phase: 'ready',
    error: null,
  };
}
function temporaryState(chat: SideChat, removed = false): SideChatState {
  return {
    endpointId: 'tekes',
    parentSessionId: chat.parent.sessionId,
    connectionEpoch: 7,
    supported: true,
    creating: false,
    unknownCreation: null,
    chats: removed ? [] : [chat],
    ...(removed ? { removedHandles: [chat.handle] } : {}),
  };
}

test('SideChat reuses full attachment and annotation compilation while parent drafts remain isolated', async (t) => {
  const { w, calls } = sideChatFixture(t);
  const parent = { endpoint: 'tekes', sessionId: 'parent' },
    chat = temporaryChat();
  await w.connect('token');
  await w.select(parent);
  await ready(w);
  w.setDraft('parent draft');
  w.addFiles([new File(['parent'], 'parent.txt', { type: 'text/plain' })]);
  const parentQuote = { ...quote, id: 'parent-quote' };
  w.saveAnnotation(parentQuote);
  await w.openSideChat(chat);
  await ready(w);
  assert.equal(w.snapshot().draft, '');
  assert.deepEqual(w.snapshot().attachments, []);
  assert.deepEqual(w.snapshot().annotations, []);
  w.setDraft('child draft');
  w.addFiles([new File(['child'], 'child.txt', { type: 'text/plain' })]);
  const childQuote = { ...quote, id: 'child-quote' };
  w.saveAnnotation(childQuote);
  await w.submit();
  const compile = calls.find(
    (call) => call.method === 'composer.compileAnnotations',
  )!;
  assert.deepEqual(compile.payload, {
    text: 'child draft',
    annotations: [childQuote],
  });
  const upload = calls.find((call) => call.method === 'session.uploadFile')!;
  assert.equal(upload.payload.sessionId, chat.scope.sessionId);
  assert.equal(upload.payload.name, 'child.txt');
  const prompt = calls.find((call) => call.method === 'agent.sideChat.prompt')!;
  assert.equal(prompt.payload.parentSessionId, 'parent');
  assert.equal(prompt.payload.handle, 'side-handle');
  assert.equal(prompt.payload.connectionEpoch, 7);
  assert.equal('sessionId' in prompt.payload, false);
  assert.deepEqual(prompt.payload.content, [
    { type: 'text', text: 'AgentKit compiled annotation input' },
    { type: 'file', receiptId: 'upload-receipt' },
  ]);
  assert.equal(
    calls.filter((call) => call.method === 'agent.sideChat.prompt').length,
    1,
  );
  assert.equal(
    calls.some(
      (call) =>
        call.method === 'session.prompt' || call.method === 'session.create',
    ),
    false,
  );
  await w.select(parent);
  await ready(w);
  assert.equal(w.snapshot().draft, 'parent draft');
  assert.equal(w.snapshot().attachments[0].file.name, 'parent.txt');
  assert.deepEqual(w.snapshot().annotations, [parentQuote]);
  w.dispose();
});

test('a late SideChat send acknowledgement cannot clear another selected session draft or artifacts', async (t) => {
  let acknowledge!: (value: unknown) => void;
  const pending = new Promise((done) => {
    acknowledge = done;
  });
  const { w, calls } = sideChatFixture(t, async () => pending);
  const parent = { endpoint: 'tekes', sessionId: 'parent' },
    chat = temporaryChat();
  await w.connect('token');
  await w.select(parent);
  await ready(w);
  w.setDraft('parent stays');
  await w.openSideChat(chat);
  await ready(w);
  w.setDraft('submitted child');
  w.addFiles([new File(['child'], 'child.txt')]);
  const sending = w.submit();
  await ready(w, () =>
    calls.some((call) => call.method === 'agent.sideChat.prompt'),
  );
  await w.select(parent);
  await ready(w);
  w.setDraft('new parent typing');
  w.addFiles([new File(['parent'], 'parent-later.txt')]);
  const parentQuote = { ...quote, id: 'late-parent-quote' };
  w.saveAnnotation(parentQuote);
  acknowledge({ accepted: true });
  await sending;
  assert.deepEqual(w.snapshot().selected, parent);
  assert.equal(w.snapshot().draft, 'new parent typing');
  assert.equal(w.snapshot().attachments[0].file.name, 'parent-later.txt');
  assert.deepEqual(w.snapshot().annotations, [parentQuote]);
  assert.equal(w.drafts.get(addressKey('tekes', chat.scope.sessionId)), '');
  assert.equal(
    calls.filter((call) => call.method === 'agent.sideChat.prompt').length,
    1,
  );
  w.dispose();
});

test('SideChat Stop captures its parent handle and epoch before navigation changes', async (t) => {
  let acknowledge!: (value: unknown) => void;
  const pending = new Promise((done) => {
    acknowledge = done;
  });
  const chat = temporaryChat();
  const { w, calls } = sideChatFixture(t, undefined, {
    runningSessions: [chat.scope.sessionId],
    call: async (call) =>
      call.method === 'agent.sideChat.cancel' ? pending : {},
  });
  await w.connect('token');
  await w.openSideChat(chat);
  await ready(
    w,
    () =>
      !w.snapshot().modelLoading &&
      !w.snapshot().controlsLoading &&
      w.snapshot().view?.run.canCancel === true,
  );
  const stopping = w.cancel();
  await ready(w, () =>
    calls.some((call) => call.method === 'agent.sideChat.cancel'),
  );
  await w.select({ endpoint: 'tekes', sessionId: 'different' });
  await ready(w);
  w.setDraft('different draft');
  acknowledge({ accepted: true });
  await stopping;
  const cancel = calls.find((call) => call.method === 'agent.sideChat.cancel')!;
  assert.deepEqual(cancel.payload, {
    parentSessionId: 'parent',
    handle: 'side-handle',
    connectionEpoch: 7,
  });
  assert.equal(
    calls.some((call) => call.method === 'session.cancel'),
    false,
  );
  assert.equal(w.snapshot().draft, 'different draft');
  w.dispose();
});

test('failed SideChat close preserves the pointer and full child draft until the service confirms removal', async (t) => {
  const chat = temporaryChat();
  const { w, calls } = sideChatFixture(t, undefined, {
    call: async (call) => {
      if (call.method === 'agent.sideChat.close')
        throw new Error('outcome-unknown');
      return temporaryState(chat);
    },
  });
  await w.connect('token');
  await w.openSideChat(chat);
  await ready(w);
  w.setDraft('keep child');
  w.addFiles([new File(['child'], 'child.txt')]);
  w.saveAnnotation({ ...quote, id: 'child' });
  const operations = w.sideChatOperations({
    endpoint: 'tekes',
    sessionId: 'parent',
  });
  await assert.rejects(operations.close(chat, 'close-once'), /outcome-unknown/);
  assert.equal(w.sideChatOrigin()?.handle, chat.handle);
  assert.equal(w.snapshot().draft, 'keep child');
  assert.equal(w.snapshot().attachments[0].file.name, 'child.txt');
  assert.equal(w.snapshot().annotations[0].id, 'child');
  assert.equal(
    calls.filter((call) => call.method === 'agent.sideChat.close').length,
    1,
  );
  const close = calls.find((call) => call.method === 'agent.sideChat.close')!;
  assert.deepEqual(close.payload, {
    parentSessionId: 'parent',
    handle: chat.handle,
    connectionEpoch: 7,
  });
  assert.equal(close.rpcId, 'close-once');
  w.dispose();
});

test('confirmed SideChat cleanup clears only its original pointer and returns to the intact parent', async (t) => {
  const chat = temporaryChat();
  const { w } = sideChatFixture(t, undefined, {
    call: async () => temporaryState(chat, true),
  });
  const parent = { endpoint: 'tekes', sessionId: 'parent' };
  await w.connect('token');
  await w.select(parent);
  await ready(w);
  w.setDraft('parent retained');
  w.addFiles([new File(['parent'], 'parent.txt')]);
  w.saveAnnotation({ ...quote, id: 'parent' });
  await w.openSideChat(chat);
  await ready(w);
  w.setDraft('child cleared');
  w.addFiles([new File(['child'], 'child.txt')]);
  w.saveAnnotation({ ...quote, id: 'child' });
  await w.closedSideChat({ ...chat, handle: 'stale-other-pointer' });
  assert.equal(w.snapshot().draft, 'child cleared');
  assert.equal(w.sideChatOrigin()?.handle, chat.handle);
  const result = await w.sideChatOperations(parent).close(chat, 'close-once');
  assert.ok(result.removedHandles?.includes(chat.handle));
  await w.closedSideChat(chat);
  await ready(w);
  assert.deepEqual(w.snapshot().selected, parent);
  assert.equal(w.snapshot().draft, 'parent retained');
  assert.equal(w.snapshot().attachments[0].file.name, 'parent.txt');
  assert.equal(w.snapshot().annotations[0].id, 'parent');
  assert.equal(w.drafts.get(addressKey('tekes', chat.scope.sessionId)), '');
  assert.deepEqual(
    w.annotationDrafts.get(addressKey('tekes', chat.scope.sessionId)),
    [],
  );
  assert.equal(
    w.sideChatOrigin({ endpoint: 'tekes', sessionId: chat.scope.sessionId }),
    undefined,
  );
  w.dispose();
});

test('a confirmed close finishing after navigation does not return the user to an older parent', async (t) => {
  const chat = temporaryChat();
  const { w } = sideChatFixture(t);
  await w.connect('token');
  await w.openSideChat(chat);
  await ready(w);
  w.setDraft('child discarded');
  await w.select({ endpoint: 'pi', sessionId: 'other' });
  await ready(w);
  w.setDraft('other preserved');
  await w.closedSideChat(chat);
  assert.deepEqual(w.snapshot().selected, {
    endpoint: 'pi',
    sessionId: 'other',
  });
  assert.equal(w.snapshot().draft, 'other preserved');
  assert.equal(w.drafts.get(addressKey('tekes', chat.scope.sessionId)), '');
  w.dispose();
});

function harnessFilesFixture(
  t: TestContext,
  read: (call: Call) => Promise<unknown>,
  host?: {
    advertised?: boolean;
    list?: () => Promise<unknown>;
    call?: (call: Call) => Promise<unknown>;
  },
) {
  const state = fixture(
    t,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    host,
    undefined,
    undefined,
    read,
  );
  Object.assign(state.endpoints[1], {
    id: 'remote-dsh',
    kind: 'dsh',
    name: 'Remote DSH',
    connectionEpoch: 7,
  });
  state.endpoints[1].capabilities!.methods!.push('agent.workspace.read');
  return state;
}
function harnessFilesReply(call: Call, result: unknown) {
  return {
    provider: 'harness',
    endpointId: call.endpoint,
    sessionId: call.payload.sessionId,
    workspaceId: call.payload.sessionId,
    connectionEpoch: call.payload.connectionEpoch,
    method: call.payload.method,
    result,
  };
}
const harnessReadCaps = {
  version: 1,
  methods: ['filesList', 'filesRead'],
  mutations: false,
  turnChanges: false,
};

test('DSH session files use their Harness reader identity and never a cwd-based local workspace', async (t) => {
  const { w, calls } = harnessFilesFixture(t, async (call) =>
    harnessFilesReply(
      call,
      call.payload.method === 'capabilities'
        ? harnessReadCaps
        : {
            workspaceId: call.payload.sessionId,
            path: '',
            entries: [],
            truncated: false,
          },
    ),
  );
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'remote-session' });
  await ready(w);
  const source = w.harnessWorkspaceSource()!;
  assert.ok(source);
  assert.equal(source.workspaceId, 'remote-session');
  assert.equal(source.provider, 'harness');
  assert.equal(
    source.connectionId,
    JSON.stringify(['harness', 'remote-dsh', 'remote-session', 7]),
  );
  const result = await w.harnessWorkspaceCall(
    source,
    'filesList',
    { workspaceId: source.workspaceId, path: '' },
    'remote-read',
  );
  assert.deepEqual(result, {
    workspaceId: 'remote-session',
    path: '',
    entries: [],
    truncated: false,
  });
  const request = calls.find((call) => call.method === 'agent.workspace.read')!;
  assert.equal(request.endpoint, 'remote-dsh');
  assert.equal(request.rpcId, 'remote-read');
  assert.deepEqual(request.payload, {
    sessionId: 'remote-session',
    connectionEpoch: 7,
    method: 'filesList',
    request: { path: '' },
  });
  await assert.rejects(
    w.harnessWorkspaceCall(
      source,
      'filesWrite',
      { path: 'remote.txt', content: 'YQ==', expectedRevision: 'r' },
      'no-write',
    ),
    /只支持读取/,
  );
  assert.equal(
    calls.filter((call) => call.method === 'agent.workspace.read').length,
    1,
  );
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  w.dispose();
});

test('a Harness file failure stays at that source while local access remains an explicit independent operation', async (t) => {
  const { w, calls } = harnessFilesFixture(
    t,
    async (call) => ({
      ...harnessFilesReply(call, null),
      result: undefined,
      error: { code: 'remote-path-missing', message: 'Remote path missing' },
    }),
    {
      advertised: true,
      list: async () => ({
        workspaces: [
          {
            connectionId: 'local-host',
            workspaceId: 'local-project',
            title: 'Local project',
          },
        ],
      }),
      call: async () => ({ result: { local: true } }),
    },
  );
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'remote-session' });
  await ready(
    w,
    () =>
      !w.snapshot().workspaceServicesLoading &&
      !w.snapshot().controlsLoading &&
      !w.snapshot().modelLoading,
  );
  const source = w.harnessWorkspaceSource()!;
  await assert.rejects(
    w.harnessWorkspaceCall(source, 'filesList', { path: '' }, 'failed-remote'),
    (cause: unknown) =>
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'remote-path-missing',
  );
  assert.equal(w.harnessWorkspaceSource()?.connectionId, source.connectionId);
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  assert.deepEqual(
    await w.workspaceServiceCall(
      'local-host',
      'local-project',
      'filesList',
      { path: '' },
      'explicit-local',
    ),
    { local: true },
  );
  assert.equal(calls.filter((call) => call.op === 'workspace.call').length, 1);
  w.dispose();
});

test('late Harness file reads and mismatched source envelopes cannot populate a different selected session', async (t) => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((done) => {
    finish = done;
  });
  let captured!: Call;
  const { w, calls } = harnessFilesFixture(t, async (call) => {
    captured = call;
    return pending;
  });
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'first' });
  await ready(w);
  const source = w.harnessWorkspaceSource()!;
  const reading = w.harnessWorkspaceCall(
    source,
    'filesRead',
    { path: 'remote.txt', maxBytes: 0 },
    'read-first',
  );
  await w.select({ endpoint: 'remote-dsh', sessionId: 'second' });
  await ready(w);
  finish(
    harnessFilesReply(captured, { workspaceId: 'first', path: 'remote.txt' }),
  );
  await assert.rejects(reading, /文件来源已变化/);
  assert.equal(w.harnessWorkspaceSource()?.workspaceId, 'second');
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  w.dispose();
});

test('the actual Web workspace picker defaults to current DSH files, retains failed Harness selection and resets preference for another session', async (t) => {
  const { w, calls } = harnessFilesFixture(
    t,
    async (call) =>
      call.payload.method === 'capabilities'
        ? harnessFilesReply(call, harnessReadCaps)
        : {
            ...harnessFilesReply(call, null),
            result: undefined,
            error: { code: 'remote-missing', message: 'Remote read failed' },
          },
    {
      advertised: true,
      list: async () => ({
        workspaces: [
          {
            connectionId: 'local-host',
            workspaceId: 'local-project',
            title: 'Local project',
          },
        ],
      }),
      call: async () => ({ result: harnessReadCaps }),
    },
  );
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'first' });
  await ready(
    w,
    () =>
      !w.snapshot().workspaceServicesLoading &&
      !w.snapshot().controlsLoading &&
      !w.snapshot().modelLoading,
  );
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost',
  });
  const media = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const originals = [
    'window',
    'document',
    'matchMedia',
    'requestAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    matchMedia: media,
    requestAnimationFrame: (callback: (time: number) => void) => {
      callback(0);
      return 0;
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', { value: media });
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(App, { workspace: w })));
    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="文件与 Git"]',
    )!;
    assert.ok(open);
    await act(async () => open.click());
    const sourceSelect = () =>
      [...container.querySelectorAll<HTMLSelectElement>('select')].find(
        (select) =>
          [...select.options].some(
            (option) => option.textContent === 'DSH 会话文件（只读）',
          ),
      )!;
    assert.equal(
      sourceSelect().selectedOptions[0].textContent,
      'DSH 会话文件（只读）',
    );
    assert.match(container.textContent!, /Remote read failed/);
    assert.equal(
      calls.some((call) => call.op === 'workspace.call'),
      false,
    );
    assert.equal(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Git',
      ),
      false,
    );
    await act(async () => {
      const select = sourceSelect();
      select.value = JSON.stringify(['local-host', 'local-project']);
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.match(sourceSelect().selectedOptions[0].textContent!, /本地宿主/);
    assert.equal(
      calls.some((call) => call.op === 'workspace.call'),
      true,
    );
    await act(async () =>
      w.select({ endpoint: 'remote-dsh', sessionId: 'second' }),
    );
    await ready(w);
    assert.equal(
      sourceSelect().selectedOptions[0].textContent,
      'DSH 会话文件（只读）',
    );
    assert.equal(w.snapshot().selected?.sessionId, 'second');
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
    w.dispose();
  }
});

test('a Harness reply for a different session is rejected without changing the chosen source', async (t) => {
  const { w, calls } = harnessFilesFixture(t, async (call) => ({
    ...harnessFilesReply(call, {
      workspaceId: 'wrong',
      path: '',
      entries: [],
      truncated: false,
    }),
    sessionId: 'different-session',
    workspaceId: 'different-session',
  }));
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'expected' });
  await ready(w);
  const source = w.harnessWorkspaceSource()!;
  await assert.rejects(
    w.harnessWorkspaceCall(source, 'filesList', { path: '' }, 'wrong-reply'),
    /文件来源已变化/,
  );
  assert.equal(w.harnessWorkspaceSource()?.connectionId, source.connectionId);
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  w.dispose();
});

test('nonstandard remote Harness errors remain inspectable without a local fallback', async (t) => {
  const remoteError = {
    kind: 'remote-denied',
    reason: { operation: 'filesRead', message: 'remote policy' },
  };
  const { w, calls } = harnessFilesFixture(t, async (call) => ({
    ...harnessFilesReply(call, null),
    result: undefined,
    error: remoteError,
  }));
  await w.connect('token');
  await w.select({ endpoint: 'remote-dsh', sessionId: 'expected' });
  await ready(w);
  const source = w.harnessWorkspaceSource()!;
  await assert.rejects(
    w.harnessWorkspaceCall(
      source,
      'filesRead',
      { path: '/remote/only.txt' },
      'remote-denied',
    ),
    (cause: unknown) => {
      assert.ok(cause instanceof Error);
      assert.ok('details' in cause);
      assert.deepEqual(cause.details, remoteError);
      return true;
    },
  );
  assert.equal(
    calls.some((call) => call.op === 'workspace.call'),
    false,
  );
  w.dispose();
});
