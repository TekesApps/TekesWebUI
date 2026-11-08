import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../src/components/Composer';
import { Workspace } from '../src/workspace';
import { setLocale } from '../src/i18n';
import type { View } from '../src/types';

test('composer exposes send and cancel independently using existing workspace gates', async () => {
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
  const workspace = new Workspace();
  const state = { ...workspace.snapshot() };
  let canSend = false,
    sends = 0,
    cancels = 0;
  workspace.canSend = () => canSend;
  workspace.cancel = async () => {
    cancels++;
  };
  const render = () =>
    act(async () =>
      root.render(
        createElement(Composer, {
          workspace,
          state,
          prompt: createRef<HTMLTextAreaElement>(),
          onSubmit: () => {
            sends++;
          },
        }),
      ),
    );
  const send = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
  const stop = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Stop run"]');
  try {
    await render();
    assert.equal(send().disabled, true);
    assert.equal(stop(), null);
    await act(async () => send().click());
    assert.equal(sends, 0);
    canSend = true;
    state.view = { run: { canCancel: true } } as View;
    await render();
    assert.equal(
      send().disabled,
      false,
      'running does not hide queue submission',
    );
    await act(async () => send().click());
    assert.equal(sends, 1);
    assert.equal(stop()!.type, 'button');
    await act(async () => stop()!.click());
    assert.equal(cancels, 1);
    assert.equal(sends, 1, 'cancel does not submit a draft');
    canSend = false;
    state.view.run.canCancel = false;
    await render();
    assert.equal(send().disabled, true);
    assert.equal(stop(), null, 'shared capability retirement removes cancel');
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
