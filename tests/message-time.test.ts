import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMessageTime, formatTimestamp } from '../src/state';
import { setLocale } from '../src/i18n';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';

test('input captions use calendar days, weekdays through one week, then month and day in both languages', () => {
  const now = Date.parse('2026-10-19T12:00:00+08:00');
  try {
    setLocale('zh-CN');
    for (const [date, expected] of [
      ['2026-10-19', '今天 09:05'],
      ['2026-10-18', '昨天 09:05'],
      ['2026-10-16', '星期五 09:05'],
      ['2026-10-12', '星期一 09:05'],
      ['2026-10-11', '10月11日 09:05'],
    ])
      assert.equal(
        formatMessageTime(date + 'T09:05:00+08:00', now, 'Asia/Shanghai'),
        expected,
      );
    setLocale('en');
    assert.equal(
      formatMessageTime('2026-10-19T09:05:00+08:00', now, 'Asia/Shanghai'),
      'Today 09:05',
    );
    assert.equal(
      formatMessageTime('2026-10-18T09:05:00+08:00', now, 'Asia/Shanghai'),
      'Yesterday 09:05',
    );
    assert.equal(
      formatMessageTime('2026-10-16T09:05:00+08:00', now, 'Asia/Shanghai'),
      'Friday 09:05',
    );
    assert.equal(
      formatMessageTime('2026-10-11T09:05:00+08:00', now, 'Asia/Shanghai'),
      'Oct 11 09:05',
    );
    const stamp = Date.parse('2026-10-19T09:05:00+08:00');
    assert.equal(
      formatMessageTime(stamp / 1000, now, 'Asia/Shanghai'),
      formatMessageTime(stamp, now, 'Asia/Shanghai'),
    );
    const afterDST = Date.parse('2026-03-09T00:10:00-04:00');
    assert.equal(
      formatMessageTime(
        '2026-03-08T00:30:00-05:00',
        afterDST,
        'America/New_York',
      ),
      'Yesterday 00:30',
    );
    assert.equal(
      formatMessageTime('2026-10-18T16:30:00Z', now, 'Asia/Shanghai'),
      'Today 00:30',
    );
    for (const invalid of [
      undefined,
      'invalid',
      Number.POSITIVE_INFINITY,
      1e17,
    ]) {
      assert.equal(formatMessageTime(invalid, now), '');
      assert.equal(formatTimestamp(invalid), '');
    }
  } finally {
    setLocale('zh-CN');
  }
});
const stamp = Date.parse('2026-10-19T09:05:06+08:00');
const view: View = {
  endpoint: 'e',
  sessionId: 's',
  run: {
    phase: 'idle',
    canSubmit: true,
    canCancel: false,
    connection: { phase: 'connected' },
    actionables: [],
    queue: [],
  },
  transcript: {
    items: [
      {
        id: 'a',
        turnId: 't',
        kind: 'assistant',
        text: '生成的回复',
        time: stamp,
        isVisible: true,
        isFinal: true,
        isProvisional: false,
      },
      {
        id: 'u',
        turnId: 't2',
        kind: 'user',
        text: '输入的消息',
        time: stamp,
        isVisible: true,
        isFinal: true,
        isProvisional: false,
      },
    ],
    tools: [],
    hasMoreBefore: false,
    isStale: false,
  },
};

test('output time follows Copy in the footer and exposes an exact timestamp on hover or focus', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById('root')!,
    root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Transcript, { view })));
    const article = container.querySelector('[data-message-id="a"]')!;
    assert.equal(article.hasAttribute('title'), false);
    assert.equal(article.querySelector('.message-author'), null);
    const footer = article.querySelector('.message-actions')!;
    assert.ok(
      footer.firstElementChild?.querySelector('button') ||
        footer.firstElementChild?.matches('button'),
    );
    const time = footer.querySelector('time')!;
    assert.equal(time.textContent, formatMessageTime(stamp));
    assert.equal(time.getAttribute('aria-label'), formatTimestamp(stamp));
    await act(async () => {
      time.dispatchEvent(
        new dom.window.MouseEvent('mouseover', {
          bubbles: true,
          relatedTarget: null,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 480));
    });
    assert.equal(
      dom.window.document.querySelector('[role="tooltip"]')?.textContent,
      formatTimestamp(stamp),
    );
    await act(async () =>
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape' }),
      ),
    );
    assert.equal(dom.window.document.querySelector('[role="tooltip"]'), null);
    await act(async () => time.focus());
    assert.equal(
      dom.window.document.querySelector('[role="tooltip"]')?.textContent,
      formatTimestamp(stamp),
    );
    const inputTime = container.querySelector('[data-message-id="u"] time')!;
    assert.equal(inputTime.textContent, formatMessageTime(stamp));
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('missing message time never fabricates a timestamp', () => {
  const missing = {
    ...view,
    transcript: {
      ...view.transcript!,
      items: [{ ...view.transcript!.items[0], time: undefined }],
    },
  };
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(Transcript, { view: missing })),
    /<time/,
  );
});

test('output footnotes prefer the turn end time and do not claim unfinished output has finished', () => {
  const endedAt = stamp + 90_000;
  const completed: View = {
    ...view,
    transcript: {
      ...view.transcript!,
      turns: [{ id: 't', status: 'completed', input: '', endedAt }],
    },
  };
  const html = renderToStaticMarkup(
    createElement(Transcript, { view: completed }),
  );
  const document = new JSDOM(html).window.document;
  assert.equal(
    document
      .querySelector('[data-message-id="a"] .message-actions time')
      ?.getAttribute('datetime'),
    new Date(endedAt).toISOString(),
  );
  const unfinished: View = {
    ...completed,
    transcript: {
      ...completed.transcript!,
      turns: [{ id: 't', status: 'running', input: '' }],
      items: [{ ...view.transcript!.items[0], isFinal: false }],
    },
  };
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(Transcript, { view: unfinished })),
    /<time/,
  );
});
