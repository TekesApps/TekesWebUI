import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../src/components/Sidebar';
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
    summary: { status: 'archived', title, cwd: '/work/project' },
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
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('zh-CN');
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
    await act(() => {
      const select = container.querySelector<HTMLSelectElement>(
        'select[aria-label="会话视图"]',
      )!;
      select.value = value;
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  };
  const titles = () =>
    [...container.querySelectorAll('.thread-label')].map((e) => e.textContent);
  try {
    await render();
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
