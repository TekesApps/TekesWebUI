import { JSDOM } from 'jsdom';
import { act } from 'react';
import { getLocale, setLocale } from '../src/i18n';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadSearch } from '../src/components/ThreadSearch';
import {
  readThreadSearchPage,
  ThreadSearchController,
  type ThreadSearchPage,
  type ThreadSearchQuery,
} from '../src/thread-search';

const digest = `sha256-${'a'.repeat(64)}`;
function page(
  query: string,
  ids: string[],
  extra: Partial<ThreadSearchPage> = {},
): ThreadSearchPage {
  return {
    endpointId: 'native',
    connectionEpoch: 3,
    query,
    visibility: 'all',
    items: ids.map((sessionId) => ({
      sessionId,
      title: query,
      updatedAt: '2026-11-09T00:00:00.000Z',
      archived: false,
      asOfSeq: 12,
      score: 3000,
      matchClass: 'exact',
    })),
    reachedEnd: true,
    catalogDigest: digest,
    ...extra,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

test('title page boundary rejects malformed completion, repeated identities and archive leakage', () => {
  assert.equal(
    readThreadSearchPage(page('设计', ['a'])).items[0].title,
    '设计',
  );
  const missing = { ...page('设计', []) } as Partial<ThreadSearchPage>;
  delete missing.reachedEnd;
  assert.throws(() => readThreadSearchPage(missing));
  assert.throws(() =>
    readThreadSearchPage(page('设计', ['a'], { reachedEnd: false })),
  );
  assert.throws(() => readThreadSearchPage(page('设计', ['a', 'a'])));
  assert.throws(() =>
    readThreadSearchPage(page('设计', ['a'], { visibility: 'archived' })),
  );
});

test('late title result cannot replace a new query or survive returning to the list filter', async () => {
  const old = deferred<ThreadSearchPage>();
  const current = deferred<ThreadSearchPage>();
  const controller = new ThreadSearchController((_endpoint, request) =>
    request.query === 'old' ? old.promise : current.promise,
  );
  const first = controller.search({
    endpointId: 'native',
    query: 'old',
    visibility: 'all',
  });
  const second = controller.search({
    endpointId: 'native',
    query: 'new',
    visibility: 'all',
  });
  current.resolve(page('new', ['new']));
  await second;
  old.resolve(page('old', ['old']));
  await first;
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.sessionId),
    ['new'],
  );
  controller.reset();
  assert.deepEqual(controller.snapshot().items, []);
  assert.equal(controller.snapshot().searched, false);
});

test('opaque cursor pages preserve order and one in-flight next page', async () => {
  const next = deferred<ThreadSearchPage>();
  const requests: [string, ThreadSearchQuery][] = [];
  const controller = new ThreadSearchController(async (endpoint, request) => {
    requests.push([endpoint, request]);
    return request.after
      ? next.promise
      : page('设计', ['rank-first'], {
          reachedEnd: false,
          nextCursor: 'opaque.cursor',
        });
  });
  await controller.search({
    endpointId: 'native',
    query: '设计',
    visibility: 'all',
  });
  const pending = controller.more();
  await controller.more();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], [
    'native',
    { query: '设计', visibility: 'all', limit: 25, after: 'opaque.cursor' },
  ]);
  next.resolve(page('设计', ['rank-second']));
  await pending;
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.sessionId),
    ['rank-first', 'rank-second'],
  );
  assert.equal(controller.snapshot().page?.reachedEnd, true);
});

test('stale cursor failure preserves results and needs an explicit fresh search', async () => {
  const requests: ThreadSearchQuery[] = [];
  const controller = new ThreadSearchController(async (_endpoint, request) => {
    requests.push(request);
    if (request.after) throw new Error('cursor-stale');
    return page('设计', ['a'], {
      reachedEnd: false,
      nextCursor: 'opaque.cursor',
    });
  });
  await controller.search({
    endpointId: 'native',
    query: '设计',
    visibility: 'all',
  });
  await controller.more();
  assert.match(controller.snapshot().error, /cursor-stale/);
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.sessionId),
    ['a'],
  );
  await controller.more();
  assert.equal(
    requests.length,
    2,
    'failed paging does not silently restart or retry',
  );
  await controller.search({
    endpointId: 'native',
    query: '设计',
    visibility: 'all',
  });
  assert.equal(requests[2].after, undefined);
  assert.equal(controller.snapshot().error, '');
});

test('scope, epoch, digest and overlapping-page changes cannot merge ranked snapshots', async () => {
  for (const change of [
    { endpointId: 'other' },
    { query: 'other' },
    { visibility: 'active' as const },
    { connectionEpoch: 4 },
    { catalogDigest: `sha256-${'b'.repeat(64)}` },
    { items: page('设计', ['a']).items },
  ]) {
    const controller = new ThreadSearchController(async (_endpoint, request) =>
      request.after
        ? page('设计', ['b'], change)
        : page('设计', ['a'], {
            reachedEnd: false,
            nextCursor: 'opaque.cursor',
          }),
    );
    await controller.search({
      endpointId: 'native',
      query: '设计',
      visibility: 'all',
    });
    await controller.more();
    assert.ok(controller.snapshot().error, JSON.stringify(change));
    assert.deepEqual(
      controller.snapshot().items.map((item) => item.sessionId),
      ['a'],
    );
  }
});

test('changing the search mode scope invalidates a pending continuation', async () => {
  const pending = deferred<ThreadSearchPage>();
  const controller = new ThreadSearchController(async (_endpoint, request) =>
    request.after
      ? pending.promise
      : page(request.query, ['first'], {
          visibility: request.visibility,
          reachedEnd: false,
          nextCursor: 'opaque.cursor',
        }),
  );
  await controller.search({
    endpointId: 'native',
    query: '设计',
    visibility: 'all',
  });
  const more = controller.more();
  controller.reset();
  pending.resolve(page('设计', ['late']));
  await more;
  assert.deepEqual(controller.snapshot().items, []);
  assert.equal(controller.snapshot().loading, false);
});

test('title search UI labels its separate authority and only offers advertised Harnesses', () => {
  const html = renderToStaticMarkup(
    createElement(ThreadSearch, {
      endpoints: [
        {
          id: 'native',
          name: 'Kernel',
          kind: 'tekes',
          connection: 'ready',
          capabilities: { methods: ['agent.threadSearch'] },
        },
        { id: 'pi', name: 'Unsupported Pi', kind: 'pi', connection: 'ready' },
      ],
      load: async (_endpoint, request) => page(request.query, []),
      onSelect: () => {},
    }),
  );
  assert.match(html, /名称检索/);
  assert.match(html, /不搜索消息正文/);
  assert.match(html, /Kernel/);
  assert.doesNotMatch(html, /Unsupported Pi/);
  assert.match(html, /value="active"/);
  assert.match(html, /value="archived"/);
  assert.match(html, /value="all"/);
});

test('application archive filtering can expose empty cursor pages without ending a search', async () => {
  const cursors: (string | undefined)[] = [];
  const controller = new ThreadSearchController(async (_endpoint, request) => {
    cursors.push(request.after);
    return request.after === 'filtered-two'
      ? page(request.query, ['visible'], {
          visibility: request.visibility,
          archiveRevision: 3,
        })
      : page(request.query, [], {
          visibility: request.visibility,
          archiveRevision: 3,
          reachedEnd: false,
          nextCursor: request.after ? 'filtered-two' : 'filtered-one',
        });
  });
  await controller.search({
    endpointId: 'native',
    query: 'visible',
    visibility: 'active',
  });
  assert.deepEqual(controller.snapshot().items, []);
  assert.equal(controller.snapshot().page?.reachedEnd, false);
  assert.equal(controller.snapshot().error, '');
  await controller.more();
  assert.deepEqual(controller.snapshot().items, []);
  assert.equal(controller.snapshot().page?.nextCursor, 'filtered-two');
  await controller.more();
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.sessionId),
    ['visible'],
  );
  assert.deepEqual(cursors, [undefined, 'filtered-one', 'filtered-two']);
});

test('a changed application archive revision never merges a stale continuation', async () => {
  let revision = 3;
  const controller = new ThreadSearchController(async (_endpoint, request) =>
    page(request.query, [request.after ? 'later' : 'first'], {
      visibility: request.visibility,
      archiveRevision: revision,
      ...(!request.after
        ? { reachedEnd: false, nextCursor: 'old-archive-cursor' }
        : {}),
    }),
  );
  await controller.search({
    endpointId: 'native',
    query: 'chat',
    visibility: 'all',
  });
  revision = 4;
  await controller.more();
  assert.match(controller.snapshot().error, /source changed/);
  assert.deepEqual(
    controller.snapshot().items.map((item) => item.sessionId),
    ['first'],
  );
  await controller.search({
    endpointId: 'native',
    query: 'chat',
    visibility: 'all',
  });
  assert.equal(controller.snapshot().error, '');
  assert.equal(controller.snapshot().page?.archiveRevision, 4);
});

test('archive search DOM continues an empty page and distinguishes readable application archives from legacy Harness archives', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const original = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    ),
    locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!,
    root = createRoot(container);
  const selected: unknown[] = [];
  const requests: ThreadSearchQuery[] = [];
  const loader = async (
    _endpoint: string,
    request: ThreadSearchQuery,
  ): Promise<ThreadSearchPage> => {
    requests.push(request);
    if (!request.after)
      return page(request.query, [], {
        visibility: request.visibility,
        archiveRevision: 3,
        reachedEnd: false,
        nextCursor: 'filtered-empty',
      });
    const result = page(request.query, ['app', 'legacy'], {
      visibility: request.visibility,
      archiveRevision: 3,
    });
    result.items[0] = {
      ...result.items[0],
      title: 'App archive',
      archived: true,
      organization: {
        archived: true,
        applicationArchived: true,
        harnessArchived: false,
        archiveOwner: 'agentkit',
      },
    };
    result.items[1] = {
      ...result.items[1],
      title: 'Legacy archive',
      archived: true,
      organization: {
        archived: true,
        // Both facts can coexist: the preferred owner must not hide the Harness restriction.
        applicationArchived: true,
        harnessArchived: true,
        archiveOwner: 'agentkit',
      },
    };
    return result;
  };
  try {
    await act(async () =>
      root.render(
        createElement(ThreadSearch, {
          endpoints: [
            {
              id: 'native',
              kind: 'tekes',
              name: 'Kernel',
              connection: 'ready',
              connectionEpoch: 3,
              capabilities: { methods: ['agent.threadSearch'] },
            },
          ],
          load: loader,
          onSelect: (address) => {
            selected.push(address);
          },
        }),
      ),
    );
    await act(async () => {
      const visibility = container.querySelector<HTMLSelectElement>(
        'select[aria-label="名称检索范围"]',
      )!;
      visibility.value = 'archived';
      visibility.dispatchEvent(
        new dom.window.Event('change', { bubbles: true }),
      );
      const input = container.querySelector<HTMLInputElement>('input')!;
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'archive');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    assert.match(container.textContent!, /当前页无可见会话/);
    assert.doesNotMatch(container.textContent!, /没有找到匹配/);
    const more = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === '加载更多')!;
    assert.ok(more);
    await act(async () => more.click());
    const app = [
        ...container.querySelectorAll<HTMLButtonElement>('.thread'),
      ].find((button) => button.textContent?.includes('App archive'))!,
      legacy = [
        ...container.querySelectorAll<HTMLButtonElement>('.thread'),
      ].find((button) => button.textContent?.includes('Legacy archive'))!;
    assert.equal(app.disabled, false);
    assert.equal(legacy.disabled, true);
    assert.match(container.textContent!, /原 Harness 归档/);
    assert.equal(
      legacy.closest('li')!.querySelector('.thread-menu-trigger'),
      null,
    );
    await act(async () => {
      app.click();
      legacy.click();
    });
    assert.deepEqual(selected, [{ endpoint: 'native', sessionId: 'app' }]);
    assert.equal(requests[1].after, 'filtered-empty');
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    dom.window.close();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
