import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  ContextDetails,
  type ContextDetailsProps,
} from '../src/components/ContextDetails';
import type { ContextSnapshot } from '../src/context-details';
import { getLocale, setLocale } from '../src/i18n';

function snapshot(sessionId = 'one'): ContextSnapshot {
  return {
    endpointId: 'native',
    sessionId,
    connectionEpoch: 4,
    usage: { usedTokens: null, contextWindow: 1000, basis: 'unknown' },
    details: null,
    usageSequence: 4,
    detailsSequence: null,
    notices: [],
    billing: {
      supported: true,
      summary: { inputTokens: 99999, outputTokens: 50 },
      cacheAttribution: [],
    },
  };
}
async function fixture(
  run: (
    render: (props: ContextDetailsProps) => Promise<void>,
    element: HTMLElement,
  ) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const old = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const locale = getLocale();
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await run(
      (props) =>
        act(async () => root.render(createElement(ContextDetails, props))),
      container,
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, value] of old) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    setLocale(locale);
    dom.window.close();
  }
}
test('context panel keeps unknown occupancy separate from reported billing and preserves independent rows', async () => {
  await fixture(async (render, element) => {
    const s = snapshot();
    s.details = {
      revision: 'legacy',
      coverage: 'partial',
      relation: 'independentEstimate',
      evidence: { scope: 'retainedSurface', sourceKey: 'contextBreakdown' },
      rows: [
        {
          id: 'messages',
          category: 'messages',
          title: 'Messages',
          role: 'occupied',
          tokens: { value: 42, basis: 'estimated' },
        },
      ],
    };
    await render({
      address: { endpoint: 'native', sessionId: 'one' },
      load: async () => s,
    });
    assert.match(element.textContent!, /当前占用未知/);
    assert.match(element.textContent!, /99,999/);
    assert.match(element.textContent!, /累计用量包含历史请求/);
    assert.match(element.textContent!, /不能相加当作总占用/);
    assert.match(element.textContent!, /42 tokens/);
    assert.doesNotMatch(element.textContent!, /当前占用：99,999/);
  });
});
test('late context reads cannot populate another session; mismatched snapshots report a visible error', async () => {
  await fixture(async (render, element) => {
    let resolve!: (value: ContextSnapshot) => void;
    const delayed = new Promise<ContextSnapshot>((done) => {
      resolve = done;
    });
    await render({
      address: { endpoint: 'native', sessionId: 'one' },
      load: () => delayed,
    });
    await render({
      address: { endpoint: 'native', sessionId: 'two' },
      load: async () => ({
        ...snapshot('two'),
        usage: { usedTokens: 123, contextWindow: 2000, basis: 'reported' },
      }),
    });
    await act(async () =>
      resolve({
        ...snapshot('one'),
        usage: { usedTokens: 777, contextWindow: 1000, basis: 'reported' },
      }),
    );
    assert.match(element.textContent!, /123 tokens/);
    assert.doesNotMatch(element.textContent!, /777 tokens/);
    await render({
      address: { endpoint: 'native', sessionId: 'three' },
      load: async () => snapshot('wrong'),
    });
    assert.match(
      element.querySelector('[role=alert]')?.textContent || '',
      /来源已变化/,
    );
  });
});
