import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  RecoveryPanel,
  type RecoveryPanelProps,
} from '../src/components/RecoveryPanel';
import type { RecoveryRequest, RecoverySnapshot } from '../src/recovery';
import { getLocale, setLocale } from '../src/i18n';
function snapshot(id = 'one'): RecoverySnapshot {
  return {
    endpointId: 'native',
    sessionId: id,
    connectionEpoch: 8,
    canRecover: true,
    outcome: null,
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
  run: (
    render: (props: RecoveryPanelProps) => Promise<void>,
    element: HTMLElement,
  ) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const old = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const locale = getLocale();
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const element = dom.window.document.getElementById('root')!;
  const root = createRoot(element);
  try {
    await run(
      (props) =>
        act(async () => root.render(createElement(RecoveryPanel, props))),
      element,
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, value] of old) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    setLocale(locale);
    dom.window.close();
  }
}
function button(element: HTMLElement, label: string) {
  const b = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  assert.ok(b, `missing ${label}`);
  return b;
}
test('manual recovery sends only the selected identity once and does not promote an omitted receipt to success', async () => {
  await fixture(async (render, element) => {
    const calls: RecoveryRequest[] = [];
    const operation = deferred<void>();
    let reads = 0;
    await render({
      address: { endpoint: 'native', sessionId: 'one' },
      load: async () => {
        reads++;
        return reads === 1
          ? snapshot()
          : {
              ...snapshot(),
              outcome: {
                connectionEpoch: 8,
                requestedSessionIds: ['one'],
                recoveredSessionIds: [],
                unresolvedSessionIds: ['one'],
                notRetriedSessionIds: [],
                error: null,
              },
            };
      },
      run: async (request) => {
        calls.push(request);
        await operation.promise;
      },
    });
    assert.equal(calls.length, 0);
    await act(async () => {
      button(element, '恢复并继续执行').click();
      button(element, '恢复并继续执行').click();
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { sessionId: 'one', connectionEpoch: 8 });
    await act(async () => operation.resolve());
    assert.match(element.textContent!, /未被恢复回执列为已释放/);
    assert.doesNotMatch(element.textContent!, /已释放恢复准入/);
    assert.match(element.textContent!, /可能调用模型/);
  });
});
test('unknown recovery outcome requires readback and never resends during refresh', async () => {
  await fixture(async (render, element) => {
    let runs = 0,
      reads = 0;
    await render({
      address: { endpoint: 'native', sessionId: 'one' },
      load: async () => {
        reads++;
        return {
          ...snapshot(),
          ...(reads > 1
            ? {
                outcome: {
                  connectionEpoch: 8,
                  requestedSessionIds: ['one'],
                  recoveredSessionIds: [],
                  unresolvedSessionIds: ['one'],
                  notRetriedSessionIds: [],
                  error: 'Timeout',
                },
              }
            : {}),
        };
      },
      run: async () => {
        runs++;
        throw Error('Timeout');
      },
    });
    await act(async () => button(element, '恢复并继续执行').click());
    assert.equal(runs, 1);
    assert.equal(button(element, '恢复并继续执行').disabled, true);
    assert.match(element.textContent!, /不会自动重发/);
    await act(async () => button(element, '刷新恢复状态').click());
    assert.equal(runs, 1);
    assert.equal(reads, 2);
    assert.match(element.textContent!, /恢复结果未确认/);
  });
});
test('a delayed recovery completion cannot refresh or populate the next selected session', async () => {
  await fixture(async (render, element) => {
    const operation = deferred<void>();
    let firstReads = 0,
      secondReads = 0;
    await render({
      address: { endpoint: 'native', sessionId: 'one' },
      load: async () => {
        firstReads++;
        return snapshot('one');
      },
      run: () => operation.promise,
    });
    await act(async () => button(element, '恢复并继续执行').click());
    await render({
      address: { endpoint: 'native', sessionId: 'two' },
      load: async () => {
        secondReads++;
        return { ...snapshot('two'), canRecover: false };
      },
      run: async () => {
        throw Error('must not run');
      },
    });
    await act(async () => operation.resolve());
    assert.equal(firstReads, 1);
    assert.equal(secondReads, 1);
    assert.equal(button(element, '恢复并继续执行').disabled, true);
    assert.match(element.textContent!, /当前不能恢复执行/);
    assert.doesNotMatch(element.textContent!, /请求已返回/);
  });
});
