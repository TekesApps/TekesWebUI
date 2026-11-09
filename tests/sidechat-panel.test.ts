import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  SideChatPanel,
  type SideChatPanelProps,
} from '../src/components/SideChatPanel';
import type { SideChat, SideChatState } from '../src/sidechat';
import { getLocale, setLocale } from '../src/i18n';

const parent = { endpoint: 'native', sessionId: 'parent' };
function chat(): SideChat {
  return {
    handle: 'owned-pointer',
    parent: {
      endpointId: parent.endpoint,
      threadId: 'parent',
      sessionId: 'parent',
    },
    scope: {
      endpointId: parent.endpoint,
      threadId: 'scratch',
      sessionId: 'scratch',
    },
    connectionEpoch: 4,
    title: 'SideChat · Parent',
    phase: 'ready',
    error: null,
  };
}
function state(chats = [chat()]): SideChatState {
  return {
    endpointId: parent.endpoint,
    parentSessionId: parent.sessionId,
    connectionEpoch: 4,
    supported: true,
    creating: false,
    unknownCreation: null,
    chats,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: SideChatPanelProps) => Promise<void>;
    click: (label: string) => Promise<void>;
    unmount: () => Promise<void>;
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
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  let mounted = true;
  const unmount = async () => {
    if (mounted) {
      await act(async () => root.unmount());
      mounted = false;
    }
  };
  try {
    await check({
      container,
      render: (props) =>
        act(async () => root.render(createElement(SideChatPanel, props))),
      click: async (label) => {
        const button = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) => button.textContent === label);
        assert.ok(button, `Missing ${label}`);
        assert.equal(button.disabled, false, `Disabled ${label}`);
        await act(async () => button.click());
      },
      unmount,
    });
  } finally {
    await unmount();
    setLocale(locale);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}
function props(
  overrides: Partial<SideChatPanelProps> = {},
): SideChatPanelProps {
  return {
    address: parent,
    operations: {
      load: async () => state(),
      create: async () => state(),
      close: async () => ({ ...state([]), removedHandles: ['owned-pointer'] }),
      reconcile: async () => state(),
    },
    onOpen: async () => {},
    onClosed: async () => {},
    ...overrides,
  };
}

test('SideChat opens the real scoped run and does not implement a reduced text composer', async () => {
  await fixture(async ({ container, render, click }) => {
    const opened: SideChat[] = [];
    await render(
      props({
        onOpen: async (value) => {
          opened.push(value);
        },
      }),
    );
    assert.equal(container.querySelector('textarea'), null);
    await click('打开临时分支');
    assert.deepEqual(opened, [chat()]);
  });
});

test('late creation retains original owner without navigating the next parent or discarding work', async () => {
  await fixture(async ({ render, click }) => {
    const pending = deferred<SideChatState>();
    let opened = 0,
      closed = 0,
      creates = 0;
    const first = props({
      operations: {
        load: async () => state([]),
        create: async () => {
          creates++;
          return pending.promise;
        },
        close: async () => {
          closed++;
          return state([]);
        },
        reconcile: async () => state([]),
      },
      onOpen: async () => {
        opened++;
      },
    });
    await render(first);
    await click('新建临时分支');
    const nextAddress = { endpoint: 'native', sessionId: 'other-parent' };
    await render(
      props({
        address: nextAddress,
        operations: {
          ...first.operations,
          load: async () => ({
            ...state([]),
            parentSessionId: nextAddress.sessionId,
          }),
        },
      }),
    );
    await act(async () => pending.resolve(state()));
    assert.equal(creates, 1);
    assert.equal(opened, 0);
    assert.equal(closed, 0);
  });
});

test('failed discard preserves pointer and draft; refresh and unmount do not retry close', async () => {
  await fixture(async ({ container, render, click, unmount }) => {
    let closes = 0,
      forgotten = 0;
    const value = props({
      onClosed: async () => {
        forgotten++;
      },
    });
    value.operations.close = async () => {
      closes++;
      throw new Error('discard timeout; reconcile');
    };
    await render(value);
    await click('关闭并丢弃临时分支');
    assert.match(container.textContent!, /请求未能确认完成/);
    assert.match(container.textContent!, /SideChat · Parent/);
    await click('刷新临时分支');
    await unmount();
    assert.equal(closes, 1);
    assert.equal(forgotten, 0);
  });
});

test('confirmed close cleans only the captured pointer even after parent navigation', async () => {
  await fixture(async ({ render, click }) => {
    const pending = deferred<SideChatState>();
    const forgotten: SideChat[] = [];
    const first = props({
      onClosed: async (value) => {
        forgotten.push(value);
      },
    });
    first.operations.close = async () => pending.promise;
    await render(first);
    await click('关闭并丢弃临时分支');
    const other = { endpoint: 'pi', sessionId: 'other' };
    await render(
      props({
        address: other,
        operations: {
          ...first.operations,
          load: async () => ({
            ...state([]),
            endpointId: 'pi',
            parentSessionId: 'other',
          }),
        },
        onClosed: async () => {
          throw new Error('wrong cleanup owner');
        },
      }),
    );
    await act(async () =>
      pending.resolve({ ...state([]), removedHandles: [chat().handle] }),
    );
    assert.deepEqual(forgotten, [chat()]);
  });
});

test('empty reads do not clear drafts; only confirmed reconciliation absence does', async () => {
  await fixture(async ({ render, click }) => {
    const forgotten: SideChat[] = [];
    const value = props({
      onClosed: async (value) => {
        forgotten.push(value);
      },
    });
    value.operations.reconcile = async () => ({
      ...state([]),
      removedHandles: [chat().handle],
    });
    await render(value);
    await click('核对临时分支');
    assert.deepEqual(forgotten, [chat()]);
    value.operations.load = async () => state([]);
    await click('刷新临时分支');
    assert.equal(forgotten.length, 1);
  });
});

test('unsupported Harness and stale or unknown pointers never expose a usable open or discard action', async () => {
  await fixture(async ({ container, render }) => {
    const value = props();
    value.operations.load = async () => ({
      ...state(),
      supported: false,
      chats: [{ ...chat(), phase: 'unknown', error: 'outcome unknown' }],
    });
    await render(value);
    assert.match(container.textContent!, /此 Harness 当前不支持临时分支/);
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      'button',
    ))
      if (
        ['新建临时分支', '打开临时分支', '关闭并丢弃临时分支'].includes(
          button.textContent || '',
        )
      )
        assert.equal(button.disabled, true);
  });
});
