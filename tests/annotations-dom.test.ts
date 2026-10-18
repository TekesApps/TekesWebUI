import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  AnnotationCapture,
  revealAnnotation,
} from '../src/components/Annotations';
import { textFingerprint, type Annotation } from '../src/annotations';

test('selection capture preserves Markdown-spanning UTF-16 offsets, rejects cross-message ranges, and refuses stale or foreign reveal', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const globals = [
    'window',
    'document',
    'NodeFilter',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const originals = globals.map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    NodeFilter: dom.window.NodeFilter,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({ matches: true }),
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    left: 40,
    top: 100,
    right: 80,
    bottom: 120,
    width: 40,
    height: 20,
    x: 40,
    y: 100,
    toJSON: () => ({}),
  });
  // React must detect input-event support after the browser fixture is installed.
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const address = { endpoint: 'kernel', sessionId: 's' };
  let saved: Annotation | undefined;
  try {
    await act(async () =>
      root.render(
        createElement(AnnotationCapture, {
          address,
          onAdd: (a) => {
            saved = a;
          },
          children: createElement(
            'article',
            {
              'data-message-id': 'reply',
              'data-turn-id': 't',
              'data-message-kind': 'assistant',
            },
            createElement(
              'div',
              { 'data-annotation-text': true },
              '重复 ',
              createElement('strong', null, '👩🏽‍💻重点'),
              ' 重复',
            ),
            createElement(
              'div',
              { 'data-annotation-text': true },
              'another message',
            ),
          ),
        }),
      ),
    );
    const texts = dom.window.document.querySelectorAll(
      '[data-annotation-text]',
    );
    const text = texts[0];
    const range = dom.window.document.createRange();
    range.setStart(text.firstChild!, 3);
    range.setEnd(text.lastChild!, 3);
    const selection = dom.window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () =>
      dom.window.document.dispatchEvent(
        new dom.window.Event('selectionchange'),
      ),
    );
    const add = dom.window.document.querySelector<HTMLButtonElement>(
      '.annotation-selection-button',
    )!;
    assert.ok(add);
    await act(async () => add.click());
    const buttons = [
      ...dom.window.document.querySelectorAll<HTMLButtonElement>(
        'dialog button',
      ),
    ];
    await act(async () =>
      buttons.find((b) => b.textContent === '添加到消息')!.click(),
    );
    assert.ok(saved);
    assert.equal(saved.excerpt, '👩🏽‍💻重点 重复');
    assert.equal(saved.sourceLocator!.start, 3);
    assert.equal(
      saved.sourceLocator!.fingerprint,
      textFingerprint(text.textContent!),
    );
    assert.equal(revealAnnotation(saved, address), '');
    assert.equal(selection.toString(), saved.excerpt);
    assert.match(
      revealAnnotation(saved, { endpoint: 'pi', sessionId: 's' }),
      /另一个会话/,
    );
    text.append('changed');
    assert.match(revealAnnotation(saved, address), /原文已变化/);
    range.setStart(text.firstChild!, 0);
    range.setEnd(texts[1].firstChild!, 3);
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () =>
      dom.window.document.dispatchEvent(
        new dom.window.Event('selectionchange'),
      ),
    );
    assert.equal(
      dom.window.document.querySelector('.annotation-selection-button'),
      null,
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
