import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useSyncExternalStore } from 'react';
import { Workspace, type WorkspaceState } from '../src/workspace';
import { groupSessions } from '../src/state';
import { getLocale, setLocale } from '../src/i18n';
import type { Address, Session } from '../src/types';

const endpoints = [
  { id: 'kernel', name: 'Kernel', kind: 'native', connection: 'ready' },
  { id: 'pi', name: 'Pi', kind: 'pi', connection: 'ready' },
] as const;

function archived(title: string, sessionId = 'same'): Session {
  return {
    sessionId,
    summary: { status: 'idle', title, cwd: '/work/project' },
    organization: {
      archived: true,
      applicationArchived: true,
      harnessArchived: false,
      archiveOwner: 'agentkit',
    },
  };
}

test('archive filtering preserves original summaries and scopes search to archived endpoint rows', () => {
  const kernel = archived('Kernel archive'),
    pi = archived('Pi archive');
  kernel.summary!.status = 'idle';
  const active: Session = { sessionId: 'active', summary: { title: 'Active' } };
  const rows = new Map([
    ['kernel', [kernel, { sessionId: 'missing' }]],
    [
      'pi',
      [
        pi,
        {
          ...archived('Scratch'),
          summary: { status: 'archived', ephemeral: true },
        },
      ],
    ],
  ]);
  const before = structuredClone(rows);
  const groups = groupSessions([...endpoints], rows, '', '', false, undefined, {
    archived: true,
  });
  assert.equal(groups.flatMap((g) => g.entries).length, 2);
  assert.equal(
    groups[0].entries.find((e) => e.endpoint === 'kernel')?.row,
    kernel.summary,
  );
  assert.deepEqual(
    groupSessions([...endpoints], rows, 'Pi archive', 'pi', false, undefined, {
      archived: true,
    })
      .flatMap((g) => g.entries)
      .map((e) => [e.endpoint, e.sessionId]),
    [['pi', 'same']],
  );
  assert.deepEqual(
    groupSessions(
      [...endpoints],
      new Map([['kernel', [active, archived('Archived')]]]),
    )
      .flatMap((g) => g.entries)
      .map((e) => e.sessionId),
    ['active'],
  );
  assert.deepEqual(
    rows,
    before,
    'display filters never change authoritative inventory',
  );
});

test('archive navigation only observes the chosen identity and authoritative restore moves the row to active', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'Element',
    'Node',
    'CustomEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: (time: number) => void) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const { Sidebar } = await import('../src/components/Sidebar');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const workspace = new Workspace();
  const observed: Address[] = [];
  let mutations = 0;
  workspace.select = async (address) => {
    observed.push(address);
  };
  workspace.performThreadAction = async () => {
    mutations++;
    return {} as never;
  };
  let state: WorkspaceState = {
    ...workspace.snapshot(),
    endpoints: endpoints.map((e) => ({ ...e })),
    inventories: new Map([
      [
        'kernel',
        [{ sessionId: 'live', summary: { title: 'Active conversation' } }],
      ],
    ]),
    archivedInventories: new Map([
      ['kernel', [archived('Kernel archive')]],
      ['pi', [archived('Pi archive')]],
    ]),
    authenticated: true,
  };
  const render = () =>
    act(() =>
      root.render(
        createElement(Sidebar, {
          workspace,
          state,
          health: 'ready',
          onNew() {},
          onSelect() {},
          onRename() {},
          onSettings() {},
          onHelp() {},
          onCollapse() {},
        }),
      ),
    );
  const switchView = async (value: string) => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="会话列表选项"]')!
        .dispatchEvent(
          new dom.window.MouseEvent('pointerdown', {
            button: 0,
            ctrlKey: false,
            bubbles: true,
          }),
        );
      await Promise.resolve();
      const view = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[aria-haspopup="menu"]',
        ),
      ].find((item) => item.textContent?.includes('会话视图'))!;
      assert.ok(view, dom.window.document.body.innerHTML);
      view.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
        }),
      );
      await Promise.resolve();
      const option = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[role^="menuitem"]',
        ),
      ].find((item) =>
        item.textContent?.includes(
          value === 'archived' ? '已归档会话' : '活动会话',
        ),
      );
      assert.ok(
        option,
        'session view choices are available in the options menu',
      );
      option.click();
    });
  };
  const titles = () =>
    [...container.querySelectorAll('.thread-label')].map((e) => e.textContent);
  try {
    await render();
    assert.equal(
      container.querySelector('select[aria-label="查找方式"]'),
      null,
      'find mode is not permanently shown in the sidebar',
    );
    assert.equal(
      container.querySelector('select[aria-label="会话视图"]'),
      null,
      'session view is not permanently shown in the sidebar',
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="搜索会话"]')!
        .click(),
    );
    assert.ok(container.querySelector('input[aria-label="搜索会话"]'));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="会话列表选项"]')!
        .dispatchEvent(
          new dom.window.MouseEvent('pointerdown', {
            button: 0,
            ctrlKey: false,
            bubbles: true,
          }),
        );
      await Promise.resolve();
      const findBy = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[aria-haspopup="menu"]',
        ),
      ].find((item) => item.textContent?.includes('查找方式'))!;
      findBy.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
        }),
      );
      await Promise.resolve();
      const nameSearch = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[role="menuitemcheckbox"]',
        ),
      ].find((item) => item.textContent?.includes('名称检索'))!;
      assert.equal(nameSearch.getAttribute('aria-disabled'), 'true');
      const listFilter = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[role="menuitemcheckbox"]',
        ),
      ].find((item) => item.textContent?.includes('列表筛选'))!;
      listFilter.click();
    });
    assert.equal(
      container.querySelector('input[aria-label="搜索会话"]'),
      null,
      'choosing list filter closes the current search input',
    );
    assert.deepEqual(titles(), ['Active conversation']);
    await switchView('archived');
    assert.deepEqual(titles(), ['Kernel archive', 'Pi archive']);
    assert.equal(
      container.querySelector('.folder-add'),
      null,
      'archive folder groups do not offer creation controls',
    );
    assert.equal(
      mutations,
      0,
      'switching inventory does not restore or execute anything',
    );
    assert.deepEqual(observed, []);
    const pi = [
      ...container.querySelectorAll<HTMLButtonElement>('.thread'),
    ].find((e) => e.textContent?.includes('Pi archive'))!;
    await act(() => pi.click());
    assert.deepEqual(observed, [{ endpoint: 'pi', sessionId: 'same' }]);
    assert.equal(mutations, 0, 'opening archived history is observation only');
    state = {
      ...state,
      archivedInventories: new Map([
        ['kernel', [archived('Kernel archive')]],
        ['pi', []],
      ]),
      inventories: new Map([
        ...state.inventories,
        [
          'pi',
          [
            {
              sessionId: 'same',
              summary: { status: 'idle', title: 'Restored Pi' },
            },
          ],
        ],
      ]),
    };
    await render();
    assert.deepEqual(
      titles(),
      ['Kernel archive'],
      'authoritative restoration removes only the matching archived row',
    );
    await switchView('active');
    assert.deepEqual(
      new Set(titles()),
      new Set(['Active conversation', 'Restored Pi']),
    );
    assert.equal(mutations, 0);
  } finally {
    await act(() => root.unmount());
    setLocale(locale);
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('application archive Restore executes through the real DOM menu, preserves running drafts and reloads persisted organization on a new Web workspace', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'Element',
    'Node',
    'CustomEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const originals = keys.map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    ),
    locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: (time: number) => void) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  setLocale('zh-CN');
  const endpoint = {
    id: 'kernel',
    name: 'Kernel',
    kind: 'tekes',
    connection: 'ready',
    connectionEpoch: 7,
    capabilities: {
      methods: [
        'thread.actions',
        'thread.performAction',
        'session.uploadFile',
        'attachments.policy',
      ],
    },
  };
  let persistedArchive = true,
    revision = 1;
  const calls: Record<string, unknown>[] = [];
  const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const applicationRow = (): Session => ({
    sessionId: 'app-thread',
    summary: {
      title: 'Persistent app archive',
      cwd: '/work/project',
      status: 'idle',
      running: true,
    },
    organization: {
      archived: persistedArchive,
      applicationArchived: persistedArchive,
      harnessArchived: false,
      archiveOwner: persistedArchive ? 'agentkit' : null,
    },
  });
  const legacy: Session = {
    sessionId: 'legacy-thread',
    summary: { title: 'Legacy native archive', status: 'archived' },
    organization: {
      archived: true,
      applicationArchived: false,
      harnessArchived: true,
      archiveOwner: 'harness',
    },
  };
  const inventory = () => ({
    description: endpoint,
    sessions: persistedArchive ? [] : [applicationRow()],
    archivedSessions: [...(persistedArchive ? [applicationRow()] : []), legacy],
    applicationArchive: {
      revision,
      sessionIds: persistedArchive ? ['app-thread'] : [],
    },
  });
  const broadcast = () => {
    for (const controller of controllers)
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify({ value: inventory() }) + '\n'),
      );
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(request);
      const payload = (request.payload as Record<string, unknown>) || {};
      let value: unknown = {};
      if (request.op === 'endpoints') value = [endpoint];
      else if (request.op === 'host.info')
        value = { workspace: '/work/project' };
      else if (request.op === 'follow') {
        const state = request.target === 'state';
        const frame = state
          ? inventory()
          : {
              endpoint: 'kernel',
              sessionId: request.sessionId,
              run: {
                scope: {
                  endpointId: 'kernel',
                  threadId: request.sessionId,
                  sessionId: request.sessionId,
                },
                connectionEpoch: 7,
                canUpdateQueue: true,
                phase: 'running',
                canSubmit: true,
                canCancel: true,
                connection: { phase: 'connected' },
                jobs: [],
                queue: [],
                actionables: [],
              },
              transcript: {
                items: [],
                tools: [],
                hasMoreBefore: false,
                isStale: false,
              },
            };
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              if (state) controllers.add(controller);
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ value: frame }) + '\n',
                ),
              );
              init.signal?.addEventListener(
                'abort',
                () => {
                  controllers.delete(controller);
                  try {
                    controller.close();
                  } catch {}
                },
                { once: true },
              );
            },
          }),
        );
      } else if (
        ['models.list', 'session.models'].includes(String(request.method))
      )
        value = {
          groups: [{ id: 'configured', models: [{ id: 'model' }] }],
          current: { provider: 'configured', model: 'model' },
        };
      else if (request.method === 'attachments.policy')
        value = { inlineMediaTypes: [], maxAttachmentsPerMessage: 8 };
      else if (request.method === 'thread.actions')
        value = {
          endpoint: 'kernel',
          sessionId: payload.sessionId,
          label: 'Application organization',
          items: [
            {
              id: persistedArchive ? 'unarchive' : 'archive',
              label: persistedArchive
                ? 'Restore application chat'
                : 'Archive in application',
              icon: 'archive',
              interaction: 'execute',
              enabled: true,
            },
          ],
        };
      else if (request.method === 'thread.performAction') {
        persistedArchive = payload.actionId === 'archive';
        revision++;
        broadcast();
        value = { clearSelection: false };
      }
      return Response.json({ value });
    },
  );
  const { createRoot } = await import('react-dom/client');
  const { Sidebar } = await import('../src/components/Sidebar');
  const container = dom.window.document.getElementById('root')!,
    root = createRoot(container);
  let workspace = new Workspace();
  function Navigation({ value }: { value: Workspace }) {
    const state = useSyncExternalStore(
      value.subscribe,
      value.snapshot,
      value.snapshot,
    );
    return createElement(Sidebar, {
      workspace: value,
      state,
      health: 'ready',
      onNew() {},
      onSelect() {},
      onRename() {},
      onSettings() {},
      onHelp() {},
      onCollapse() {},
    });
  }
  const render = () =>
    act(async () =>
      root.render(createElement(Navigation, { value: workspace })),
    );
  const switchView = (view: string) =>
    act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="会话列表选项"]')!
        .dispatchEvent(
          new dom.window.MouseEvent('pointerdown', {
            button: 0,
            ctrlKey: false,
            bubbles: true,
          }),
        );
      await Promise.resolve();
      const submenu = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[aria-haspopup="menu"]',
        ),
      ].find((item) => item.textContent?.includes('会话视图'))!;
      submenu.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
        }),
      );
      await Promise.resolve();
      const option = [
        ...dom.window.document.querySelectorAll<HTMLElement>(
          '[role^="menuitem"]',
        ),
      ].find((item) =>
        item.textContent?.includes(
          view === 'archived' ? '已归档会话' : '活动会话',
        ),
      );
      assert.ok(
        option,
        'session view choices are available in the options menu',
      );
      option.click();
    });
  const openMenu = async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '.thread-menu-trigger',
    )!;
    assert.ok(trigger);
    await act(async () =>
      trigger.dispatchEvent(
        new dom.window.MouseEvent('pointerdown', {
          button: 0,
          ctrlKey: false,
          bubbles: true,
        }),
      ),
    );
  };
  const chooseAction = async (label: string) => {
    const action = [
      ...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.includes(label));
    assert.ok(action, `Missing menu action ${label}`);
    await act(async () => action.click());
  };
  try {
    await workspace.connect('token');
    await render();
    await switchView('archived');
    const legacyButton = [
      ...container.querySelectorAll<HTMLButtonElement>('.thread'),
    ].find((button) => button.textContent?.includes('Legacy native archive'))!;
    assert.equal(legacyButton.disabled, true);
    assert.equal(
      legacyButton
        .closest('.thread-row')!
        .querySelector('.thread-menu-trigger'),
      null,
    );
    await act(async () => {
      const row = [
        ...container.querySelectorAll<HTMLButtonElement>('.thread'),
      ].find((button) =>
        button.textContent?.includes('Persistent app archive'),
      )!;
      row.click();
    });
    await act(async () => {
      workspace.setDraft('running draft retained');
      workspace.addFiles([new File(['pending'], 'pending.txt')]);
    });
    assert.equal(workspace.snapshot().view?.run.phase, 'running');
    await openMenu();
    await chooseAction('Restore application chat');
    assert.equal(persistedArchive, false);
    assert.equal(workspace.snapshot().selected?.sessionId, 'app-thread');
    assert.equal(workspace.snapshot().draft, 'running draft retained');
    assert.equal(workspace.snapshot().attachments[0].file.name, 'pending.txt');
    assert.equal(workspace.snapshot().view?.run.phase, 'running');
    await switchView('active');
    assert.match(container.textContent!, /Persistent app archive/);
    await openMenu();
    await chooseAction('Archive in application');
    assert.equal(persistedArchive, true);
    assert.equal(workspace.snapshot().draft, 'running draft retained');
    assert.equal(workspace.snapshot().selected?.sessionId, 'app-thread');
    assert.equal(
      calls.some((call) =>
        ['session.archive', 'session.unarchive', 'session.cancel'].includes(
          String(call.method),
        ),
      ),
      false,
    );
    const beforeLegacy = calls.length;
    await act(async () =>
      workspace.select({ endpoint: 'kernel', sessionId: 'legacy-thread' }),
    );
    assert.match(workspace.snapshot().error, /原 Harness/);
    assert.equal(
      calls.slice(beforeLegacy).some((call) => call.op === 'follow'),
      false,
    );
    workspace.dispose();
    workspace = new Workspace();
    await workspace.connect('token');
    await render();
    await switchView('archived');
    assert.equal(
      workspace
        .snapshot()
        .archivedInventories.get('kernel')
        ?.find((row) => row.sessionId === 'app-thread')?.organization
        ?.applicationArchived,
      true,
    );
    assert.equal(workspace.snapshot().selected?.sessionId, 'app-thread');
    assert.equal(workspace.snapshot().draft, 'running draft retained');
    assert.match(container.textContent!, /Persistent app archive/);
    assert.equal(
      calls.filter((call) => call.method === 'thread.performAction').length,
      2,
    );
  } finally {
    workspace.dispose();
    await act(async () => root.unmount());
    setLocale(locale);
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
