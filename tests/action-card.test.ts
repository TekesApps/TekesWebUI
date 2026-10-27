import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionCard } from '../src/components/ActionCard';
import { setLocale } from '../src/i18n';
import type { Actionable } from '../src/types';
import type { Workspace } from '../src/workspace';

test('question cancellation consumes only the supplied outcome, prevents duplicate responses and recovers from errors', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('en');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const action: Actionable = {
    id: 'question-action',
    revision: 17,
    sessionId: 'child-session',
    kind: 'question',
    payload: {
      questions: [
        { id: 'question-call', question: 'Choose', options: [{ label: 'A' }] },
      ],
    },
  };
  const calls: unknown[][] = [];
  let rejectPending!: (error: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectPending = reject;
  });
  const workspace = {
    respond: async (...args: unknown[]) => {
      calls.push(args);
      if (calls.length === 1) await pending;
    },
  } as unknown as Workspace;
  const cancelButton = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel question',
    );
  try {
    await act(async () =>
      root.render(createElement(ActionCard, { action, workspace })),
    );
    assert.equal(
      cancelButton(),
      undefined,
      'missing shared capability exposes no cancel action',
    );
    action.cancelOutcome = { sessionId: 'child-session', cancelQuestion: true };
    await act(async () =>
      root.render(createElement(ActionCard, { action, workspace })),
    );
    const button = cancelButton()!;
    assert.equal(
      button.type,
      'button',
      'cancel must not submit an empty answer',
    );
    await act(async () => button.click());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), [action.id, action.revision]);
    assert.equal(
      calls[0][2],
      action.cancelOutcome,
      'forward the supplied exact outcome object',
    );
    assert.equal(container.querySelector('fieldset')!.disabled, true);
    assert.equal(button.disabled, true);
    await act(async () => button.click());
    assert.equal(
      calls.length,
      1,
      'a pending cancel cannot send a duplicate response',
    );
    await act(async () => rejectPending(new Error('cancel failed')));
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /cancel failed/,
    );
    assert.equal(container.querySelector('fieldset')!.disabled, false);
    assert.equal(button.disabled, false);
    await act(async () => button.click());
    assert.equal(calls.length, 2);
    assert.equal(container.querySelector('[role="alert"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    setLocale('zh-CN');
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('child question cancellation uses its onRespond callback without responding on the parent workspace', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('en');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const action: Actionable = {
    id: 'child-question',
    revision: 23,
    sessionId: 'child',
    kind: 'question',
    cancelOutcome: { sessionId: 'child', cancelQuestion: true },
    payload: {
      questions: [
        { id: 'child-call', question: 'Choose', options: [{ label: 'A' }] },
      ],
    },
  };
  let parentCalls = 0;
  const workspace = {
    respond: async () => {
      parentCalls++;
    },
  } as unknown as Workspace;
  const responses: [Actionable, unknown][] = [];
  try {
    await act(async () =>
      root.render(
        createElement(ActionCard, {
          action,
          workspace,
          onRespond: async (receivedAction, outcome) => {
            responses.push([receivedAction, outcome]);
          },
        }),
      ),
    );
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Cancel question',
    )!;
    await act(async () => button.click());
    assert.equal(responses.length, 1);
    assert.equal(responses[0][0], action);
    assert.equal(responses[0][1], action.cancelOutcome);
    assert.equal(parentCalls, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    setLocale('zh-CN');
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
