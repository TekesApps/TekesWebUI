import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  FeedbackControls,
  type FeedbackControlsProps,
} from '../src/components/FeedbackControls';
import type { FeedbackAction, FeedbackSnapshot } from '../src/feedback';
import { getLocale, setLocale } from '../src/i18n';

function snapshot(sessionId = 'one'): FeedbackSnapshot {
  return {
    endpointId: 'pi',
    sessionId,
    connectionEpoch: 7,
    target: {
      itemId: 'item',
      turnId: 'turn',
      messageId: `native-${sessionId}`,
      responseRevision: 'sha256:response',
    },
    feedback: {
      messageId: `native-${sessionId}`,
      rating: 'positive',
      version: 'v1',
      note: 'old note',
    },
    canPut: true,
    canDelete: true,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: FeedbackControlsProps) => Promise<void>;
    button: (label: string) => HTMLButtonElement;
    enter: (text: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = keys.map(
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
        act(async () => root.render(createElement(FeedbackControls, props))),
      button: (label) => {
        const button = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) => button.textContent === label);
        assert.ok(button, `Missing ${label}`);
        return button;
      },
      enter: (text) =>
        act(async () => {
          const area = container.querySelector('textarea')!;
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLTextAreaElement.prototype,
            'value',
          )!.set!.call(area, text);
          area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    setLocale(locale);
    for (const [key, value] of originals)
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
  }
}

test('feedback loads on demand and sends the public target and observed CAS once', async () => {
  await fixture(async ({ render, button, enter, container }) => {
    let reads = 0;
    const actions: FeedbackAction[] = [];
    const pending = deferred<unknown>();
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      itemId: 'item',
      load: async () => {
        reads++;
        return snapshot();
      },
      act: async (action) => {
        actions.push(action);
        await pending.promise;
      },
    });
    assert.equal(reads, 0);
    await act(async () => button('评价回复').click());
    assert.equal(reads, 1);
    await enter('new note');
    await act(async () => {
      button('保存评价备注').click();
      button('保存评价备注').click();
    });
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], {
      sessionId: 'one',
      connectionEpoch: 7,
      itemId: 'item',
      messageId: 'native-one',
      responseRevision: 'sha256:response',
      ifVersion: 'v1',
      change: { kind: 'setNote', note: 'new note' },
    });
    assert.equal(button('保存评价备注').disabled, true);
    await act(async () => pending.resolve({ acknowledged: true }));
    assert.equal(reads, 2);
    assert.equal(actions.length, 1);
    assert.match(container.textContent!, /评价已更新/);
  });
});

test('a failed feedback action retains the note and requires an explicit read before another mutation', async () => {
  await fixture(async ({ render, button, enter, container }) => {
    let reads = 0,
      writes = 0;
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      itemId: 'item',
      load: async () => {
        reads++;
        return snapshot();
      },
      act: async () => {
        writes++;
        throw Error('version-conflict');
      },
    });
    await act(async () => button('评价回复').click());
    await enter('keep my edited note');
    await act(async () => button('保存评价备注').click());
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.equal(
      container.querySelector('textarea')!.value,
      'keep my edited note',
    );
    assert.equal(button('保存评价备注').disabled, true);
    assert.match(container.textContent!, /version-conflict/);
    await act(async () => button('刷新评价').click());
    assert.equal(reads, 2);
    assert.equal(writes, 1);
    assert.equal(
      container.querySelector('textarea')!.value,
      'keep my edited note',
    );
  });
});

test('an acknowledged feedback mutation with failed refresh is not resent', async () => {
  await fixture(async ({ render, button, enter, container }) => {
    let reads = 0,
      writes = 0;
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      itemId: 'item',
      load: async () => {
        if (++reads > 1) throw Error('read failed');
        return snapshot();
      },
      act: async () => {
        writes++;
        return { acknowledged: true };
      },
    });
    await act(async () => button('评价回复').click());
    await enter('preserve me');
    await act(async () => button('保存评价备注').click());
    assert.equal(writes, 1);
    assert.equal(reads, 2);
    assert.equal(container.querySelector('textarea')!.value, 'preserve me');
    assert.match(container.textContent!, /操作不会重发/);
    assert.equal(button('删除评价').disabled, true);
    await act(async () => button('刷新评价').click());
    assert.equal(writes, 1);
    assert.equal(reads, 3);
  });
});

test('late reads and action acknowledgements cannot target a different session or message', async () => {
  await fixture(async ({ render, button, container }) => {
    const firstRead = deferred<FeedbackSnapshot>();
    const oldAction = deferred<unknown>();
    const actions: FeedbackAction[] = [];
    await render({
      address: { endpoint: 'pi', sessionId: 'one' },
      itemId: 'item',
      load: () => firstRead.promise,
      act: async (action) => {
        actions.push(action);
        await oldAction.promise;
      },
    });
    await act(async () => button('评价回复').click());
    await render({
      address: { endpoint: 'pi', sessionId: 'two' },
      itemId: 'item',
      load: async () => snapshot('two'),
      act: async (action) => {
        actions.push(action);
        await oldAction.promise;
      },
    });
    await act(async () => firstRead.resolve(snapshot('one')));
    assert.equal(container.querySelector('textarea'), null);
    await act(async () => button('评价回复').click());
    await act(async () => button('没有帮助').click());
    assert.equal(actions[0].sessionId, 'two');
    assert.equal(actions[0].messageId, 'native-two');
    await render({
      address: { endpoint: 'pi', sessionId: 'three' },
      itemId: 'other',
      load: async () => ({
        ...snapshot('three'),
        target: null,
        feedback: null,
      }),
      act: async () => {
        throw Error('should not mutate');
      },
    });
    await act(async () => oldAction.resolve({ acknowledged: true }));
    assert.equal(container.querySelector('textarea'), null);
    assert.doesNotMatch(container.textContent!, /评价已更新/);
    await act(async () => button('评价回复').click());
    assert.equal(container.textContent, '');
  });
});
