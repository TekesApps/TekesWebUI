import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';

function queuedView(sessionId: string, canUpdateQueue = true): View {
  return {
    endpoint: 'kernel',
    sessionId,
    run: {
      scope: { endpointId: 'kernel', threadId: sessionId, sessionId },
      phase: 'running',
      connectionEpoch: 7,
      canUpdateQueue,
      canSubmit: true,
      canCancel: true,
      connection: {
        phase: 'connected',
        canSubmit: true,
        historyIsStale: false,
      },
      actionables: [],
      jobs: [],
      queue: [
        {
          id: 'input:9',
          message: {
            content: [
              { type: 'text', text: 'queued text' },
              {
                type: 'file',
                mediaType: 'text/plain',
                attachment: {
                  attachmentId: 'owned-file',
                  name: 'proof.txt',
                  bytes: 56,
                },
              },
            ],
          },
        },
      ],
    },
    transcript: { items: [], tools: [], hasMoreBefore: false, isStale: false },
  };
}

test('queue controls preserve authority and isolate in-flight state across destinations', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = keys.map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
  );
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
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const calls: unknown[][] = [];
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const remove = async (...args: unknown[]) => {
    calls.push(args);
    await pending;
  };
  const render = (view: View) =>
    root.render(createElement(Transcript, { view, onRemoveQueued: remove }));
  const button = () =>
    dom.window.document.querySelector<HTMLButtonElement>(
      'button.queued-remove',
    );
  try {
    await act(async () => render(queuedView('first')));
    assert.match(dom.window.document.body.textContent!, /proof.txt/);
    assert.match(dom.window.document.body.textContent!, /56 B/);
    await act(async () => {
      button()!.click();
    });
    assert.equal(button()!.disabled, true);
    assert.match(
      dom.window.document.body.textContent!,
      /queued text/,
      'a click must not optimistically remove the queue row',
    );
    assert.deepEqual(calls, [
      [{ endpoint: 'kernel', sessionId: 'first' }, 'input:9', 7],
    ]);
    await act(async () => render(queuedView('second')));
    assert.equal(
      button()!.disabled,
      false,
      'same input ID in another session is a different UI operation',
    );
    await act(async () => resolve());
    assert.match(
      dom.window.document.body.textContent!,
      /queued text/,
      'RPC completion alone is not authority to remove a row',
    );
    await act(async () => render(queuedView('second', false)));
    assert.equal(
      button(),
      null,
      'shared read-only/capability gate must hide queue mutations',
    );
    assert.match(dom.window.document.body.textContent!, /proof.txt/);
  } finally {
    resolve();
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
