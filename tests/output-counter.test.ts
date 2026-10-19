import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { OutputTokenCounter } from '../src/components/ui/OutputTokenCounter';

test('token reports roll from x to y with both values retained and no invented intermediate values', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = dom.window.document.getElementById('root')!;
  const root = createRoot(host);
  const render = async (count: number) =>
    act(async () => root.render(createElement(OutputTokenCounter, { count })));
  try {
    await render(7);
    assert.equal(host.querySelector('.token-counter-previous'), null);
    await render(23);
    const counter = host.querySelector('.token-counter');
    assert.equal(
      host.querySelector('.token-counter-previous')?.textContent,
      '7',
    );
    assert.equal(
      host
        .querySelector('.token-counter-previous')
        ?.getAttribute('aria-hidden'),
      'true',
    );
    assert.equal(
      host.querySelector('.token-counter-current')?.textContent,
      '23',
    );
    assert.equal(host.querySelector('.token-counter')?.children.length, 2);
    await render(23); // repeated packets and unrelated rerenders must not restart the animation
    assert.equal(host.querySelector('.token-counter'), counter);
    await render(48);
    assert.equal(
      host.querySelector('.token-counter-previous')?.textContent,
      '23',
    );
    assert.equal(
      host.querySelector('.token-counter-current')?.textContent,
      '48',
    );
    await render(45); // authoritative corrections also have a visible transition
    assert.equal(
      host.querySelector('.token-counter')?.getAttribute('data-direction'),
      'down',
    );
    assert.equal(
      host.querySelector('.token-counter-previous')?.textContent,
      '48',
    );
    assert.equal(
      host.querySelector('.token-counter-current')?.textContent,
      '45',
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
