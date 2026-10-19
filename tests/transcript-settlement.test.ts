import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { Transcript } from '../src/components/Transcript';
import { elapsedText, turnElapsedSeconds, liveTurnID } from '../src/transcript';
import type { View, Item } from '../src/types';
import { setLocale } from '../src/i18n';

const start = Date.parse('2026-10-19T10:00:00+08:00');
function fixture(): View {
  return {
    endpoint: 'e',
    sessionId: 's',
    run: {
      phase: 'running',
      canSubmit: true,
      canCancel: true,
      connection: { phase: 'connected' },
      actionables: [],
      queue: [],
    },
    transcript: {
      turns: [
        { id: 't', status: 'running', input: 'request', startedAt: start },
      ],
      items: [
        {
          id: 'u',
          turnId: 't',
          kind: 'user',
          text: 'request',
          time: start,
          isVisible: true,
          isFinal: true,
          isProvisional: false,
        },
      ],
      tools: [
        {
          id: 'tool',
          turnId: 't',
          name: 'read',
          phase: 'doing',
          arguments: { path: 'README.md' },
        },
      ],
      hasMoreBefore: false,
      isStale: false,
    },
  };
}

test('settlement collapses tools immediately and promotes the same response once without replaying its entrance', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = [
    'window',
    'document',
    'navigator',
    'IS_REACT_ACT_ENVIRONMENT',
  ].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let copied = '';
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  });
  const actions: unknown[] = [];
  const onTurnAction = async (address: unknown, id: string) => {
    actions.push([address, id]);
  };
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  dom.window.requestAnimationFrame = (callback) => {
    frames.set(++frame, callback);
    return frame;
  };
  dom.window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = dom.window.document.getElementById('root')!,
    root = createRoot(host);
  const model = fixture();
  const answer: Item = {
    id: 'same-response',
    turnId: 't',
    kind: 'assistant',
    text: 'FINAL_RESPONSE_ONCE',
    isVisible: true,
    isFinal: false,
    isProvisional: true,
  };
  const render = async () =>
    act(async () =>
      root.render(
        createElement(Transcript, { view: { ...model }, onTurnAction }),
      ),
    );
  try {
    await render();
    const inputFooter = host.querySelector('.message.user > .input-time')!;
    assert.ok(inputFooter.querySelector('time'));
    await act(async () =>
      inputFooter.querySelector<HTMLButtonElement>('.copy-button')!.click(),
    );
    assert.equal(copied, 'request');
    assert.equal(
      host.querySelector('details.work-summary')?.hasAttribute('open'),
      true,
    );
    model.transcript!.tools[0].phase = 'done';
    model.transcript!.items.push(answer);
    await render();
    assert.equal(
      host.querySelectorAll('[data-message-id="same-response"]').length,
      1,
    );
    assert.ok(
      host.querySelector('.work-summary [data-message-id="same-response"]'),
    );
    answer.isFinal = true;
    answer.isProvisional = false;
    model.transcript!.turns![0].status = 'completed';
    model.transcript!.turns![0].endedAt = start + 62_000;
    model.transcript!.turns![0].footnoteActions = [
      {
        id: 'forkTurn:t',
        label: '从此回合分叉',
        icon: 'fork',
        interaction: 'execute',
        enabled: true,
      },
    ];
    // Keep control running deliberately: journal settlement must win before control catches up.
    await render();
    assert.equal(liveTurnID(model), undefined);
    const details = host.querySelector<HTMLDetailsElement>(
      'details.work-summary',
    )!;
    assert.equal(details.open, false);
    assert.match(
      details.querySelector('summary')!.textContent!,
      /已工作 1m 2s/,
    );
    assert.ok(
      !details.querySelector('summary')!.textContent!.includes('项操作'),
    );
    assert.equal(
      host.querySelectorAll('[data-message-id="same-response"]').length,
      1,
    );
    assert.equal(
      details.querySelector('[data-message-id="same-response"]'),
      null,
    );
    const final = host.querySelector('[data-message-id="same-response"]')!;
    assert.equal(final.classList.contains('message-enter'), false);
    assert.equal(final.querySelector('.markdown')!.textContent, answer.text);
    assert.equal(frames.size, 0);
    assert.equal(details.querySelectorAll('.tool').length, 1);
    assert.equal(host.querySelectorAll('.turn > .tool').length, 0);
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new dom.window.Event('toggle'));
    });
    assert.equal(details.open, true);
    assert.equal(
      details.querySelector('[data-message-id="same-response"]'),
      null,
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="从此回合分叉"]')!
        .click(),
    );
    assert.equal(actions.length, 1);
    assert.equal((actions[0] as [View, string])[0].sessionId, 's');
    assert.equal((actions[0] as [View, string])[0].endpoint, 'e');
    assert.equal((actions[0] as [View, string])[1], 'forkTurn:t');
    model.transcript!.isStale = true;
    await render();
    assert.equal(host.querySelector('[aria-label="从此回合分叉"]'), null);
    model.transcript!.isStale = false;
    model.run.phase = 'idle';
    await render();
    assert.equal(
      host.querySelectorAll('[data-message-id="same-response"]').length,
      1,
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

test('worked duration uses authoritative times, compact ClientKit units, localized verbs and collapsed history', () => {
  assert.equal(elapsedText(0), '0s');
  assert.equal(elapsedText(90061), '1d 1h 1m 1s');
  const model = fixture();
  model.run.phase = 'idle';
  model.transcript!.tools[0].phase = 'done';
  const turn = model.transcript!.turns![0];
  turn.status = 'completed';
  turn.endedAt = start + 62000;
  assert.equal(turnElapsedSeconds(model, 't'), 62);
  turn.startedAt = start / 1000;
  turn.endedAt /= 1000;
  assert.equal(turnElapsedSeconds(model, 't'), 62);
  try {
    setLocale('en');
    for (const [status, label] of [
      ['completed', 'Worked for 1m 2s'],
      ['failed', 'Failed after 1m 2s'],
      ['cancelled', 'Stopped after 1m 2s'],
    ]) {
      turn.status = status;
      const document = new JSDOM(
        renderToStaticMarkup(createElement(Transcript, { view: model })),
      ).window.document;
      assert.equal(
        document.querySelector('details.work-summary')!.hasAttribute('open'),
        false,
      );
      assert.ok(
        document
          .querySelector('details.work-summary summary')!
          .textContent!.includes(label),
      );
    }
    turn.endedAt = undefined;
    assert.equal(turnElapsedSeconds(model, 't'), undefined);
    turn.startedAt = 0;
    turn.endedAt = start;
    assert.equal(turnElapsedSeconds(model, 't'), undefined);
  } finally {
    setLocale('zh-CN');
  }
});

test('a settled turn without output still renders only the footnote actions supplied by AgentKit', () => {
  const model = fixture();
  model.run.phase = 'idle';
  const turn = model.transcript!.turns![0];
  turn.status = 'completed';
  turn.footnoteActions = [
    {
      id: 'forkTurn:t',
      label: '从此回合分叉',
      icon: 'fork',
      interaction: 'execute',
      enabled: false,
      disabledReason: '当前不可用',
    },
  ];
  const render = () =>
    new JSDOM(
      renderToStaticMarkup(
        createElement(Transcript, {
          view: model,
          onTurnAction: async () => {},
        }),
      ),
    ).window.document;
  const document = render();
  const fork = document.querySelector<HTMLButtonElement>(
    '[aria-label="从此回合分叉"]',
  )!;
  assert.ok(fork);
  assert.equal(fork.disabled, true);
  assert.equal(fork.closest('.message.user'), null);
  assert.equal(fork.closest('.work-summary'), null);
  turn.footnoteActions = undefined;
  assert.equal(render().querySelector('[aria-label="从此回合分叉"]'), null);
});
