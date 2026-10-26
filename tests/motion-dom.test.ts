import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';

test('streamed Markdown types a paced prefix, preserves semantic nodes, and flushes on reduced motion', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const listeners = new Set<() => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let frameID = 0,
    now = 1000;
  const originalNow = Date.now;
  Date.now = () => now;
  Object.defineProperty(dom.window.document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
  dom.window.requestAnimationFrame = (callback) => {
    frames.set(++frameID, callback);
    return frameID;
  };
  dom.window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  async function frame() {
    now += 16;
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => {
      callbacks.forEach((callback) => callback(now));
    });
  }
  let reduced = false;
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: reduced,
      addEventListener: (_event: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_event: string, fn: () => void) =>
        listeners.delete(fn),
    }),
  });
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const view: View = {
    endpoint: 'live',
    sessionId: 'session',
    run: {
      scope: { endpointId: 'live', threadId: 'session', sessionId: 'session' },
      jobs: [],
      phase: 'running',
      canSubmit: true,
      canCancel: true,
      connection: {
        phase: 'connected',
        canSubmit: true,
        historyIsStale: false,
      },
      actionables: [],
      queue: [],
    },
    transcript: {
      items: [
        {
          id: 'answer',
          turnId: 'turn',
          kind: 'assistant',
          text: '历史 **重点**。',
          isVisible: true,
          isFinal: false,
          isProvisional: true,
        },
      ],
      tools: [],
      hasMoreBefore: false,
      isStale: false,
    },
  };
  const render = async () => {
    await act(async () =>
      root.render(
        createElement(Transcript, {
          view: {
            ...view,
            transcript: {
              ...view.transcript!,
              items: [{ ...view.transcript!.items[0]! }],
            },
          },
        }),
      ),
    );
  };
  try {
    await render();
    assert.equal(frames.size, 0);
    const strong = container.querySelector('strong');
    view.transcript!.items[0]!.text += ' 新增中文👩‍💻';
    await render();
    assert.equal(container.querySelector('strong'), strong);
    assert.equal(
      container.querySelector('.markdown')!.textContent,
      '历史 重点。',
    );
    await frame();
    await frame(); // The first admitted glyph is a trailing space, which Markdown trims.
    const partial = container.querySelector('.markdown')!.textContent!;
    assert.ok(partial.length > '历史 重点。'.length);
    assert.ok(partial.length < '历史 重点。 新增中文👩‍💻'.length);
    for (let i = 0; i < 35; i++) await frame();
    assert.equal(
      container.querySelector('.markdown')!.textContent,
      '历史 重点。 新增中文👩‍💻',
    );
    assert.equal(container.querySelector('strong'), strong);
    assert.equal(frames.size, 0);
    view.transcript!.items[0]!.text += ' 继续显示中的内容';
    await render();
    assert.ok(frames.size > 0);
    await act(async () => {
      reduced = true;
      listeners.forEach((fn) => fn());
    });
    view.transcript!.items[0]!.text +=
      '\n\n[链接](https://example.com) 和 `代码`';
    await render();
    assert.equal(frames.size, 0);
    assert.equal(
      container.querySelector('a')!.getAttribute('href'),
      'https://example.com/',
    );
    assert.equal(container.querySelector('code')!.textContent, '代码');
    await act(async () => {
      reduced = false;
      listeners.forEach((fn) => fn());
    });
    view.transcript!.items[0]!.text += ' 背景窗口直接显示完整文本';
    await render();
    assert.ok(frames.size > 0);
    await act(async () => {
      Object.defineProperty(dom.window.document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      dom.window.document.dispatchEvent(
        new dom.window.Event('visibilitychange'),
      );
    });
    assert.equal(frames.size, 0);
    assert.ok(
      container
        .querySelector('.markdown')!
        .textContent!.endsWith('背景窗口直接显示完整文本'),
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    Date.now = originalNow;
    assert.equal(frames.size, 0);
    dom.window.close();
  }
});
