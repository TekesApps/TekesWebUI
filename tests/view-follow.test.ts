import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { followView } from '../host/view-follow.js';
import type { BridgeMessage } from '../host/bridge.js';
import { DirectoryAuthority } from '../host/directory.js';

class SlowResponse extends Writable {
  readonly chunks: string[] = [];
  private callbacks: Array<() => void> = [];
  constructor() {
    super({ highWaterMark: 1 });
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void) {
    this.chunks.push(chunk.toString());
    this.callbacks.push(done);
  }
  release() {
    assert.ok(this.callbacks.length, 'a write must be pending');
    this.callbacks.shift()!();
  }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function controlled() {
  const response = new SlowResponse();
  let deliver!: (message: BridgeMessage) => void;
  let cancellations = 0;
  followView(response as unknown as ServerResponse, (receive) => {
    deliver = receive;
    return () => cancellations++;
  });
  return { response, deliver, cancellations: () => cancellations };
}

test('view backpressure keeps one latest snapshot and skips blocked heartbeats', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { response, deliver, cancellations } = controlled();
  t.after(() => response.destroy());
  deliver({ value: { revision: 1 } });
  deliver({ value: { revision: 2 } });
  deliver({ value: { revision: 3 } });
  t.mock.timers.tick(15000);
  assert.deepEqual(
    response.chunks.map((s) => JSON.parse(s)),
    [{ value: { revision: 1 } }],
  );
  assert.equal(response.listenerCount('drain'), 1);
  response.release();
  await turn();
  assert.deepEqual(
    response.chunks.map((s) => JSON.parse(s)),
    [{ value: { revision: 1 } }, { value: { revision: 3 } }],
  );
  deliver({ done: true });
  const finished = once(response, 'finish');
  response.release();
  await finished;
  assert.equal(cancellations(), 1);
  assert.equal(response.listenerCount('drain'), 0);
  t.mock.timers.tick(15000);
  assert.equal(response.chunks.length, 2);
});

test('view terminal error follows the pending latest snapshot and is never replaced', async (t) => {
  const { response, deliver, cancellations } = controlled();
  t.after(() => response.destroy());
  deliver({ value: { revision: 1 } });
  deliver({ value: { revision: 2 } });
  deliver({ id: 'private', error: 'source failed', done: true });
  deliver({ value: { revision: 3 } });
  response.release();
  await turn();
  response.release();
  await turn();
  assert.deepEqual(
    response.chunks.map((s) => JSON.parse(s)),
    [
      { value: { revision: 1 } },
      { value: { revision: 2 } },
      { error: 'source failed', done: true },
    ],
  );
  const finished = once(response, 'finish');
  response.release();
  await finished;
  assert.equal(cancellations(), 1);
  assert.equal(response.listenerCount('drain'), 0);
});

test('closing a blocked view cancels once and clears its pending drain', async () => {
  const { response, deliver, cancellations } = controlled();
  deliver({ value: { revision: 1 } });
  deliver({ value: { revision: 2 } });
  const closed = once(response, 'close');
  response.destroy();
  await closed;
  response.emit('drain');
  deliver({ value: { revision: 3 } });
  assert.equal(cancellations(), 1);
  assert.equal(response.chunks.length, 1);
  assert.equal(response.listenerCount('drain'), 0);
});

test('synchronous view completion cancels after observe returns and ignores later frames', async () => {
  const response = new SlowResponse();
  let cancellations = 0;
  const finished = once(response, 'finish');
  followView(response as unknown as ServerResponse, (deliver) => {
    deliver({ done: true });
    deliver({ value: 'too late' });
    return () => cancellations++;
  });
  await finished;
  assert.equal(cancellations, 1);
  assert.deepEqual(response.chunks, []);
});

// The source override runs this exact socket regression against the unchanged
// ecaa HTTP handler as the red case, without changing its frozen checkout.
async function slowReader(target: string, count: number) {
  const { createHostServer } = await import(
    process.env.TEKES_TEST_HTTP_SOURCE ?? '../host/http.js'
  );
  const root = await mkdtemp(join(tmpdir(), 'tekes-view-backpressure-'));
  let deliver!: (message: BridgeMessage) => void;
  let cancellations = 0;
  let requests = 0;
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets/index.html'), '<p>fixture</p>');
  const server = createHostServer({
    assets: join(root, 'assets'),
    workspace: root,
    kernelVersion: 'fixture',
    hostVersion: 'fixture',
    browserToken: 'fixture',
    appToken: 'app',
    dshURL: '',
    directories: await DirectoryAuthority.create([], root, async () => ''),
    bridge: {
      request: async () => {
        requests++;
        return ['still responsive'];
      },
      observe: (
        _request: unknown,
        receive: (message: BridgeMessage) => void,
      ) => {
        deliver = receive;
        receive({ value: { revision: 0 } });
        return () => cancellations++;
      },
    },
    attachDSH: async () => ({}),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api`;
  const payload = JSON.stringify({ op: 'follow', target });
  const incoming = new Promise<import('node:http').IncomingMessage>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer fixture',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        resolve,
      );
      req.once('error', reject);
      req.end(payload);
    },
  );
  let response: import('node:http').IncomingMessage | undefined;
  try {
    response = await incoming;
    response.pause();
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise<void>((resolve, reject) => {
      response!.once('end', resolve);
      response!.once('error', reject);
      response!.once('aborted', () =>
        reject(new Error('slow view was destroyed')),
      );
    }).then(
      () => undefined,
      (error: Error) => error,
    );
    // The view burst exceeds the old 1MiB queued-output cap with a paused client.
    for (let revision = 1; revision <= count; revision++)
      deliver({ value: { revision, text: 'x'.repeat(128 * 1024) } });
    deliver({ error: 'fixture terminal', done: true });
    const unary = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fixture',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ op: 'endpoints' }),
    });
    assert.deepEqual(await unary.json(), { value: ['still responsive'] });
    assert.equal(requests, 1);
    response.resume();
    const failure = await ended;
    if (failure) throw failure;
    const frames = Buffer.concat(chunks)
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(frames[0].value.revision, 0);
    assert.equal(frames.at(-2).value.revision, count);
    assert.deepEqual(frames.at(-1), { error: 'fixture terminal', done: true });
    if (target === 'view')
      assert.ok(
        frames.length < count + 2,
        'intermediate complete snapshots are coalesced',
      );
    else
      assert.deepEqual(
        frames.slice(0, -1).map((frame) => frame.value.revision),
        Array.from({ length: count + 1 }, (_, revision) => revision),
      );
    assert.equal(cancellations, 1);
  } finally {
    response?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
test(
  'slow view HTTP reader receives latest snapshot and terminal while other requests continue',
  { timeout: 10000 },
  () => slowReader('view', 96),
);
test(
  'non-view HTTP business frames retain every event under backpressure',
  { timeout: 10000 },
  () => slowReader('events', 4),
);
