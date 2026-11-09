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
