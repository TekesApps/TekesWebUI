import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import {
  OutputTokenCounter,
  compactTokenCount,
} from '../src/components/ui/OutputTokenCounter';

test('token counts follow ClientKit count-through, retarget from the displayed value, and stop on reduced motion or hiding', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Set<() => void>();
  let now = 1000,
    nextFrame = 0,
    reduced = false;
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window.document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: reduced,
      addEventListener: (_: string, callback: () => void) =>
        listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) =>
        listeners.delete(callback),
    }),
  });
  dom.window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  dom.window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = dom.window.document.getElementById('root')!;
  const root = createRoot(host);
  const render = async (count: number) =>
    act(async () => root.render(createElement(OutputTokenCounter, { count })));
  const value = () =>
    Number(host.querySelector('.token-counter-current')?.textContent);
  const advance = async (milliseconds: number) => {
    now += milliseconds;
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(now)));
  };
  try {
    await render(300);
    assert.equal(value(), 300);
    await render(500);
    assert.equal(value(), 300);
    assert.equal(
      host
        .querySelector('.working-tokens')
        ?.getAttribute('data-reported-count'),
      '500',
    );
    await advance(0.5);
    assert.equal(value(), 301);
    await advance(119.5);
    assert.equal(value(), 475);
    const scheduled = [...frames.keys()];
    await render(500);
    assert.deepEqual([...frames.keys()], scheduled); // unchanged packets never re-arm the animation
    await render(600);
    assert.equal(value(), 475); // retarget from the current presentation, never jump to the old target
    await advance(240);
    assert.equal(value(), 600);
    assert.equal(frames.size, 0);
    await render(550);
    assert.equal(value(), 550); // ClientKit applies corrections directly
    assert.equal(frames.size, 0);
    await render(700);
    await act(async () => {
      reduced = true;
      listeners.forEach((listener) => listener());
    });
    assert.equal(value(), 700);
    assert.equal(frames.size, 0);
    await act(async () => {
      reduced = false;
      listeners.forEach((listener) => listener());
    });
    await render(800);
    await act(async () => {
      Object.defineProperty(dom.window.document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      dom.window.document.dispatchEvent(
        new dom.window.Event('visibilitychange'),
      );
    });
    assert.equal(value(), 800);
    assert.equal(frames.size, 0);
  } finally {
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});

test('compact token formatting matches ClientKit thousand units with a stable decimal digit', () => {
  for (const [count, label] of [
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [1200, '1.2k'],
    [12400, '12.4k'],
    [1000000, '1000.0k'],
  ] as const) {
    assert.equal(compactTokenCount(count), label);
  }
});
