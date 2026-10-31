import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FamilyPanel } from '../src/components/FamilyPanel';
import { Workspace } from '../src/workspace';
import { getLocale, setLocale } from '../src/i18n';
import type { ChildPane, ChildViewFrame, FamilySnapshot } from '../src/types';

async function withFamily(
  summary: FamilySnapshot['summary']['subagents'][number],
  availability: ChildPane['availability'],
  check: (fixture: {
    container: HTMLElement;
    workspace: Workspace;
    pane: ChildPane;
    publishFamily: (family: FamilySnapshot) => void;
    family: FamilySnapshot;
    publishChild: (frame: ChildViewFrame) => void;
    open: () => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  setLocale('en');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const workspace = new Workspace();
  const address = { endpoint: 'native', sessionId: 'parent-uuid' };
  const family: FamilySnapshot = {
    endpointId: address.endpoint,
    parentSessionId: address.sessionId,
    connectionEpoch: 7,
    summary: {
      scope: {
        endpointId: address.endpoint,
        sessionId: address.sessionId,
        threadId: 'thread',
      },
      tasks: [],
      subagents: [summary],
    },
    subagentCatalog: {
      parentAvailable: true,
      entries: [
        {
          kind: 'child',
          id: 'child-uuid',
          label: 'Catalog label',
          mode: 'continuable',
        },
      ],
    },
  };
  const pane: ChildPane = {
    handle: 'child-handle',
    endpointId: address.endpoint,
    parentSessionId: address.sessionId,
    childId: 'child-uuid',
    connectionEpoch: 7,
    layout: 'independentSessions',
    availability,
    transcript: {
      items: [],
      tools: [],
      turns: [],
      hasMoreBefore: false,
      isStale: false,
    },
    run: {
      scope: {
        endpointId: address.endpoint,
        sessionId: 'child-uuid',
        threadId: 'thread',
      },
      connectionEpoch: 7,
      phase: 'idle',
      canSubmit: true,
      canCancel: true,
      canUpdateQueue: false,
      connection: { phase: 'ready', canSubmit: true, historyIsStale: false },
      actionables: [],
      queue: [],
      jobs: [],
    },
  };
  let publishFamily!: (frame: FamilySnapshot) => void;
  let publishChild!: (frame: ChildViewFrame) => void;
  const untilAborted = (signal: AbortSignal) =>
    new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  workspace.followFamily = async (receivedAddress, receive, signal) => {
    assert.deepEqual(receivedAddress, address);
    publishFamily = receive;
    receive(family);
    await untilAborted(signal);
  };
  workspace.followChild = async (receivedAddress, opened, receive, signal) => {
    assert.deepEqual(receivedAddress, address);
    assert.equal(opened.childId, 'child-uuid');
    publishChild = receive;
    await untilAborted(signal);
  };
  workspace.openChild = async (receivedAddress, childId) => {
    assert.deepEqual(receivedAddress, address);
    assert.equal(
      childId,
      'child-uuid',
      'navigation uses session identity, never tool-call identity',
    );
    return pane;
  };
  workspace.setDraft('parent draft');
  workspace.setChildDraft(address, 'child-uuid', 'child draft');
  try {
    await act(async () =>
      root.render(createElement(FamilyPanel, { workspace, address })),
    );
    await check({
      container,
      workspace,
      pane,
      family,
      publishFamily: (frame) => publishFamily(frame),
      publishChild: (frame) => publishChild(frame),
      open: () =>
        act(async () =>
          container.querySelector<HTMLButtonElement>('.family-child')!.click(),
        ),
    });
    assert.equal(workspace.snapshot().draft, 'parent draft');
    assert.equal(workspace.childDraft(address, 'child-uuid'), 'child draft');
  } finally {
    await act(async () => root.unmount());
    workspace.dispose();
    dom.window.close();
    setLocale(locale);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

for (const [status, availability] of [
  ['failed', 'oneShot'],
  ['running', 'unavailable'],
] as const) {
  test(`family resolves tool-call Summary identity to child title/${status}, preserving ${availability}`, async () => {
    await withFamily(
      {
        id: 'spawn-call-1',
        sessionId: 'child-uuid',
        title: 'Audit child',
        status,
      },
      availability,
      async ({ container, open }) => {
        assert.equal(
          container.querySelector('.family-child span')?.textContent,
          'Audit child',
        );
        assert.equal(
          container.querySelector('.family-child small')?.textContent,
          status,
        );
        await open();
        assert.equal(
          container.querySelector('.family-heading strong')?.textContent,
          'Audit child',
        );
        assert.equal(
          container.querySelector('.child-composer'),
          null,
          'readonly/oneShot never gains a composer',
        );
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>('[aria-label="Back to tasks"]')!
            .click(),
        );
        assert.equal(
          container.querySelector('.family-child span')?.textContent,
          'Audit child',
        );
      },
    );
  });
}

for (const sessionId of [null, 'unknown-child']) {
  test(`family never falls back to tool-call identity for ${sessionId} child session`, async () => {
    await withFamily(
      { id: 'child-uuid', sessionId, title: 'Wrong child', status: 'failed' },
      'oneShot',
      async ({ container, open }) => {
        assert.equal(
          container.querySelector('.family-child span')?.textContent,
          'Catalog label',
        );
        assert.equal(
          container.querySelector('.family-child small')?.textContent,
          'continuable',
        );
        await open();
        assert.equal(
          container.querySelector('.family-heading strong')?.textContent,
          'child-uuid',
        );
      },
    );
  });
}

test('family identity projection preserves endpoint/parent and child epoch mutation gates', async () => {
  await withFamily(
    {
      id: 'spawn-call-1',
      sessionId: 'child-uuid',
      title: 'Audit child',
      status: 'running',
    },
    'available',
    async ({ container, family, publishFamily, pane, publishChild, open }) => {
      for (const foreign of [
        { ...family, endpointId: 'other' },
        { ...family, parentSessionId: 'other-parent' },
      ]) {
        await act(async () =>
          publishFamily({
            ...foreign,
            summary: {
              ...foreign.summary,
              subagents: [
                {
                  id: 'call',
                  sessionId: 'child-uuid',
                  title: 'Foreign child',
                  status: 'failed',
                },
              ],
            },
          }),
        );
        assert.equal(container.textContent?.includes('Foreign child'), false);
      }
      await open();
      const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
      assert.equal(input.value, 'child draft');
      assert.equal(
        input.disabled,
        true,
        'opening does not establish live mutation authority',
      );
      const frame: ChildViewFrame = { ...pane };
      for (const foreign of [
        { ...frame, connectionEpoch: 6 },
        { ...frame, parentSessionId: 'other-parent' },
        { ...frame, endpointId: 'other' },
      ]) {
        await act(async () => publishChild(foreign));
        assert.equal(input.disabled, true);
      }
      await act(async () => publishChild(frame));
      assert.equal(
        input.disabled,
        false,
        'matching live authority still enables the existing composer',
      );
      assert.equal(input.value, 'child draft');
    },
  );
});
