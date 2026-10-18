import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';
import { revealDuration, revealStagger } from '../src/motion';

test('streamed Markdown preserves history, semantic markup and full text; animations settle and reduced motion disables new spans', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const listeners = new Set<() => void>();
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
      phase: 'running',
      canSubmit: true,
      canCancel: true,
      connection: { phase: 'connected' },
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
    assert.equal(container.querySelectorAll('.text-reveal').length, 0);
    const strong = container.querySelector('strong');
    view.transcript!.items[0]!.text += ' 新增中文👩‍💻';
    await render();
    assert.ok(container.querySelectorAll('.text-reveal').length > 0);
    assert.equal(container.querySelector('strong'), strong);
    assert.equal(
      container.querySelector('.markdown')!.textContent,
      '历史 重点。 新增中文👩‍💻',
    );
    assert.equal(
      container.querySelector('.text-reveal')!.textContent?.includes('历史'),
      false,
    );
    await act(
      async () =>
        new Promise((resolve) =>
          setTimeout(resolve, revealDuration + revealStagger + 30),
        ),
    );
    assert.equal(container.querySelectorAll('.text-reveal').length, 0);
    await act(async () => {
      reduced = true;
      listeners.forEach((fn) => fn());
    });
    view.transcript!.items[0]!.text +=
      '\n\n[链接](https://example.com) 和 `代码`';
    await render();
    assert.equal(container.querySelectorAll('.text-reveal').length, 0);
    assert.equal(
      container.querySelector('a')!.getAttribute('href'),
      'https://example.com/',
    );
    assert.equal(container.querySelector('code')!.textContent, '代码');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
