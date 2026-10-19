import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarDivider } from '../src/components/SidebarDivider';

test('sidebar divider drags with capture, remembers width and bounds keyboard and viewport resizing', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost',
  });
  const originals = [
    'window',
    'document',
    'localStorage',
    'IS_REACT_ACT_ENVIRONMENT',
  ].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  let captured: number | null = null;
  const render = () => act(() => root.render(createElement(SidebarDivider)));
  const value = () =>
    Number(container.firstElementChild!.getAttribute('aria-valuenow'));
  const key = async (key: string) => {
    await act(() => {
      container.firstElementChild!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true }),
      );
    });
  };
  const pointer = async (type: string, clientX: number, pointerId = 1) => {
    const event = new dom.window.MouseEvent(type, {
      clientX,
      button: 0,
      bubbles: true,
    });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      isPrimary: { value: true },
    });
    await act(() => {
      container.firstElementChild!.dispatchEvent(event);
    });
  };
  try {
    await render();
    const node = container.firstElementChild as HTMLDivElement;
    node.setPointerCapture = (id) => {
      captured = id;
    };
    node.releasePointerCapture = () => {
      captured = null;
    };
    assert.equal(value(), 266);
    await pointer('pointerdown', 266);
    assert.equal(captured, 1);
    await pointer('pointermove', 340, 2);
    assert.equal(value(), 266, 'ignore other pointers');
    await pointer('pointermove', 340);
    assert.equal(value(), 340);
    assert.equal(container.style.getPropertyValue('--sidebar-width'), '340px');
    await pointer('pointerup', 340);
    assert.equal(captured, null);
    assert.equal(
      dom.window.localStorage.getItem('tekes.web.sidebarWidth'),
      '340',
    );
    await act(() => root.render(null));
    assert.equal(container.style.getPropertyValue('--sidebar-width'), '');
    await render();
    assert.equal(value(), 340, 'restore saved width');
    await key('ArrowLeft');
    assert.equal(value(), 330);
    await key('End');
    assert.equal(value(), 480);
    await key('ArrowRight');
    assert.equal(value(), 480);
    Object.defineProperty(dom.window, 'innerWidth', {
      value: 750,
      configurable: true,
    });
    await act(() => {
      dom.window.dispatchEvent(new dom.window.Event('resize'));
    });
    assert.equal(value(), 350, 'leave 400px for content');
    Object.defineProperty(dom.window, 'innerWidth', {
      value: 1200,
      configurable: true,
    });
    await act(() => {
      dom.window.dispatchEvent(new dom.window.Event('resize'));
    });
    assert.equal(value(), 480, 'restore preferred width when room returns');
    await key('Home');
    await key('ArrowLeft');
    assert.equal(value(), 220);
    assert.equal(
      dom.window.localStorage.getItem('tekes.web.sidebarWidth'),
      '220',
    );
  } finally {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
