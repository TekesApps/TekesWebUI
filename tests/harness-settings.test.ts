import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  HarnessSettings,
  type HarnessSettingsProps,
} from '../src/components/HarnessSettings';
import type {
  HarnessSettingsMutation,
  HarnessSettingsSnapshot,
} from '../src/harness-settings';
import { getLocale, setLocale } from '../src/i18n';

function snapshot(
  endpointId = 'kernel',
  revision = 4,
): HarnessSettingsSnapshot {
  return {
    endpointId,
    connectionEpoch: 7,
    namespaces: [
      {
        id: 'policy',
        title: 'Policy',
        applies: 'next-launch',
        revision,
        readOnlyReason: null,
        fields: [
          {
            path: ['allowed_tools'],
            label: 'Allowed tools',
            description: '',
            kind: 'stringList',
            value: ['read'],
            overridden: true,
            writable: true,
          },
        ],
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: HarnessSettingsProps) => Promise<void>;
    button: (label: string) => HTMLButtonElement;
    enter: (value: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = keys.map(
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
  try {
    await check({
      container,
      render: (props) =>
        act(async () => root.render(createElement(HarnessSettings, props))),
      button: (label) => {
        const button = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => b.textContent === label);
        assert.ok(button, `Missing button ${label}`);
        return button;
      },
      enter: (value) =>
        act(async () => {
          const input =
            container.querySelector<HTMLTextAreaElement>('textarea')!;
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLTextAreaElement.prototype,
            'value',
          )!.set!.call(input, value);
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
    });
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test('settings preserve original revision and drafts after unknown mutation; no automatic resend', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    const calls: HarnessSettingsMutation[] = [];
    const pending = deferred<unknown>();
    await render({
      endpointId: 'kernel',
      load: async () => snapshot(),
      mutate: async (request) => {
        calls.push(request);
        return pending.promise;
      },
    });
    assert.match(container.textContent!, /下次启动/);
    await enter('read\nwrite');
    await act(async () => {
      button('保存此设置').click();
      button('保存此设置').click();
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      connectionEpoch: 7,
      namespace: 'policy',
      expectedRevision: 4,
      changes: [{ path: ['allowed_tools'], value: ['read', 'write'] }],
    });
    await act(async () => pending.reject(new Error('outcome unknown')));
    assert.match(container.textContent!, /保存结果尚未确认/);
    assert.equal(button('保存此设置').disabled, true);
    assert.equal(container.querySelector('textarea')!.value, 'read\nwrite');
    assert.equal(calls.length, 1);
  });
});

test('acknowledged settings save followed by read failure only enables a read, never another write', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    let reads = 0,
      writes = 0;
    await render({
      endpointId: 'kernel',
      load: async () => {
        reads++;
        if (reads === 2) throw new Error('read offline');
        const result = snapshot('kernel', reads === 1 ? 4 : 5);
        if (reads > 2) result.namespaces[0].fields[0].value = ['read', 'write'];
        return result;
      },
      mutate: async () => {
        writes++;
        return { acknowledged: true };
      },
    });
    await enter('read\nwrite');
    await act(async () => button('保存此设置').click());
    assert.equal(writes, 1);
    assert.match(container.textContent!, /保存已确认/);
    assert.equal(button('保存此设置').disabled, true);
    await act(async () => button('刷新设置').click());
    assert.equal(reads, 3);
    assert.equal(writes, 1);
    assert.equal(button('保存此设置').disabled, true);
    assert.equal(container.querySelector('textarea')!.value, 'read\nwrite');
  });
});

test('late settings and acknowledgements stay with their endpoint; Pi remains read-only', async () => {
  await fixture(async ({ container, render }) => {
    const old = deferred<HarnessSettingsSnapshot>();
    const mutate = async () => ({});
    await render({ endpointId: 'kernel', load: () => old.promise, mutate });
    const pi = snapshot('pi');
    pi.namespaces[0].title = 'Pi';
    pi.namespaces[0].revision = null;
    pi.namespaces[0].readOnlyReason = 'No revisioned write contract';
    pi.namespaces[0].fields[0].writable = false;
    await render({
      endpointId: 'pi',
      sessionId: 'pi-session',
      load: async () => pi,
      mutate,
    });
    await act(async () => old.resolve(snapshot('kernel')));
    assert.match(container.textContent!, /Pi/);
    assert.doesNotMatch(container.textContent!, /Policy/);
    assert.equal(container.querySelector('textarea')!.disabled, true);
    assert.equal(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === '保存此设置',
      ),
      false,
    );
  });
});
