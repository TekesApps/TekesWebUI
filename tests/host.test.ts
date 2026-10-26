import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  mkdir,
  rm,
  writeFile,
  symlink,
  open,
  chmod,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DirectoryAuthority } from '../host/directory.js';
import { createHostServer, type HttpOptions } from '../host/http.js';
import { kernelProjection, type Settings } from '../host/config.js';
import { Bridge, type Wire } from '../host/bridge.js';
import { LIMIT } from '../host/private.js';
import {
  privateRoot,
  writePrivate,
  readPrivate,
  cleanEnvironment,
} from '../host/private.js';

async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tekes-web-host-')));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('native selection grants only the canonical chosen directory, without blocking existing authority', () =>
  temporary(async (root) => {
    const initial = join(root, 'initial'),
      chosen = join(root, 'chosen "folder"'),
      alias = join(root, 'alias');
    await mkdir(initial);
    await mkdir(chosen);
    await symlink(chosen, alias);
    let complete!: (value: string) => void;
    const authority = await DirectoryAuthority.create(
      ['kernel'],
      initial,
      async (path, prompt) => {
        assert.equal(path, initial);
        assert.equal(prompt, 'Choose a working directory');
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    );
    const template = { cwd: initial, network: false, allowed_tools: ['read'] };
    await assert.rejects(authority.execution('kernel', chosen, template));
    const selecting = authority.pick('kernel', initial, 'en');
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(authority.pick('kernel'), /already open/);
    assert.equal(
      (await authority.execution('kernel', initial, template)).cwd,
      initial,
    );
    // Wait for asynchronous realpath to reach the injected native picker.
    while (!complete) await new Promise((resolve) => setImmediate(resolve));
    complete(alias + '/');
    assert.equal(await selecting, chosen);
    assert.deepEqual(await authority.execution('kernel', alias, template), {
      ...template,
      cwd: chosen,
      read_roots: [chosen],
      writable_roots: [chosen],
    });
    assert.equal(template.cwd, initial);
    await assert.rejects(authority.execution('unknown', chosen, template));
  }));
test('cancel, picker failure and unknown endpoints never admit a directory', () =>
  temporary(async (root) => {
    let fail = false;
    const authority = await DirectoryAuthority.create(
      ['kernel'],
      root,
      async () => {
        if (fail) throw new Error('native failure');
        return '';
      },
    );
    assert.equal(await authority.pick('kernel'), null);
    fail = true;
    await assert.rejects(authority.pick('kernel'), /native failure/);
    fail = false;
    assert.equal(await authority.pick('kernel'), null);
    await assert.rejects(authority.pick('remote'), /unavailable/);
    const other = join(root, 'other');
    await mkdir(other);
    await assert.rejects(
      authority.execution('kernel', other, {}),
      /Choose this/,
    );
  }));
test('provider projection preserves Responses, enabled models and credential isolation', () => {
  const settings: Settings = {
    providers: [
      {
        id: 'selected',
        providerID: 'deepseek',
        api: 'deepseek-responses',
        connectionMode: 'direct',
        baseURL: 'https://api.deepseek.com/',
        models: [{ id: 'deepseek-flash' }, { id: 'disabled', enabled: false }],
      },
    ],
    agentSelections: { tekes: { providerIDs: ['selected'] } },
  };
  const { launch } = kernelProjection(
    settings,
    '/host/kernel',
    '/published/bin',
  );
  assert.equal(launch.root, '/host/kernel');
  assert.equal(launch.providers.providers[0].adapter, 'responses');
  assert.deepEqual(
    launch.providers.providers[0].models.map((m) => m.id),
    ['deepseek-flash'],
  );
  assert.equal('web_listen' in launch, false);
  assert.equal('credentials' in launch, false);
  settings.agentSelections!.tekes.disabledProviderIDs = ['selected'];
  assert.throws(() =>
    kernelProjection(settings, '/host/kernel', '/published/bin'),
  );
});
async function httpFixture(root: string) {
  const assets = join(root, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), '<p>UI</p>');
  const calls: Wire[] = [];
  let observerCancelled = 0,
    mutations = 0;
  const options: HttpOptions = {
    assets,
    workspace: root,
    kernelVersion: '0.9.0',
    hostVersion: 'test',
    browserToken: 'browser-secret',
    appToken: 'app-secret',
    dshURL: 'http://127.0.0.1:3181',
    directories: await DirectoryAuthority.create(
      ['tekes-loopback-default'],
      root,
      async () => '',
    ),
    bridge: {
      request: async (request) => {
        calls.push(request);
        if (request.op === 'call') mutations++;
        return [];
      },
      observe: (_request, deliver) => {
        deliver({ value: { baseline: true } });
        return () => {
          observerCancelled++;
        };
      },
    },
    attachDSH: async () => ({ connected: true }),
  };
  const server = createHostServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const api = (
    request: Wire,
    token = options.browserToken,
    extra: Record<string, string> = {},
  ) =>
    fetch(url + '/api', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(request),
    });
  return {
    server,
    api,
    url,
    calls,
    get observerCancelled() {
      return observerCancelled;
    },
    get mutations() {
      return mutations;
    },
  };
}
test('HTTP enforces browser/app authentication, origin, asset containment and operation boundaries', () =>
  temporary(async (root) => {
    const fixture = await httpFixture(root);
    try {
      assert.equal((await fetch(fixture.url + '/')).status, 200);
      assert.equal(
        (await fixture.api({ op: 'endpoints' }, 'wrong')).status,
        401,
      );
      assert.equal(
        (
          await fixture.api({ op: 'endpoints' }, undefined, {
            Origin: 'https://evil.example',
          })
        ).status,
        403,
      );
      assert.equal(
        (await fixture.api({ op: 'host.attachDSH', cookie: 'cookie' })).status,
        403,
      );
      assert.equal(
        (
          await fixture.api(
            { op: 'host.attachDSH', cookie: 'cookie' },
            'app-secret',
          )
        ).status,
        200,
      );
      assert.equal(
        (await fixture.api({ op: 'host.listDirectories' })).status,
        400,
      );
      await writeFile(join(root, 'secret.js'), 'private');
      await symlink(join(root, 'secret.js'), join(root, 'assets/link.js'));
      assert.equal((await fetch(fixture.url + '/link.js')).status, 404);
      assert.equal(
        (await fetch(fixture.url + '/%2e%2e%2fsecret.js')).status,
        404,
      );
      const other = join(root, 'not-chosen');
      await mkdir(other);
      const denied = await (
        await fixture.api({
          op: 'call',
          endpoint: 'tekes-loopback-default',
          method: 'session.create',
          payload: { cwd: other },
        })
      ).json();
      assert.match(denied.error, /Choose this/);
      assert.equal(fixture.calls.length, 0);
      await fixture.api({
        op: 'call',
        endpoint: 'tekes-loopback-default',
        method: 'session.create',
        payload: {
          cwd: root,
          execution: {
            cwd: other,
            read_roots: ['/'],
            writable_roots: ['/'],
            toolchain_roots: ['/'],
            network: true,
            allowed_tools: ['untrusted-browser-tool'],
            mcp: [{ name: 'untrusted-browser-server' }],
          },
        },
      });
      const payload = fixture.calls[0].payload as Wire;
      assert.equal('cwd' in payload, false);
      assert.deepEqual(payload.execution, {
        cwd: root,
        read_roots: [root],
        writable_roots: [root],
        toolchain_roots: ['/bin', '/usr/bin'],
        network: false,
        allowed_tools: ['read', 'write', 'edit', 'shell', 'ask_user_questions'],
      });
      assert.deepEqual(
        await (
          await fixture.api({
            op: 'host.pickDirectory',
            endpoint: 'tekes-loopback-default',
          })
        ).json(),
        { value: { path: null } },
      );
    } finally {
      fixture.server.close();
      fixture.server.closeAllConnections();
    }
  }));
test('disconnecting an observation cancels only the observer and leaves runtime/mutations available', () =>
  temporary(async (root) => {
    const fixture = await httpFixture(root);
    try {
      const response = await fixture.api({
        op: 'follow',
        endpoint: 'tekes-loopback-default',
      });
      const reader = response.body!.getReader();
      assert.ok((await reader.read()).value?.length);
      await reader.cancel();
      for (let n = 0; n < 50 && !fixture.observerCancelled; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(fixture.observerCancelled, 1);
      assert.equal(fixture.mutations, 0);
      assert.equal(
        (await fixture.api({ op: 'call', method: 'session.list' })).status,
        200,
      );
      assert.equal(fixture.mutations, 1);
      assert.equal(
        fixture.calls.some(
          (call) => call.op === 'cancel' || call.method === 'run.cancel',
        ),
        false,
      );
    } finally {
      fixture.server.close();
      fixture.server.closeAllConnections();
    }
  }));
test('private files reject symlinks and environment projection excludes model credentials', () =>
  temporary(async (root) => {
    await privateRoot(root);
    await writePrivate(join(root, 'private'), 'data');
    assert.equal(await readPrivate(join(root, 'private')), 'data');
    await symlink(join(root, 'private'), join(root, 'link'));
    await assert.rejects(writePrivate(join(root, 'link'), 'overwritten'));
    assert.equal(await readPrivate(join(root, 'private')), 'data');
    process.env.TEKES_TEST_PRIVATE_KEY = 'private';
    assert.equal(cleanEnvironment().TEKES_TEST_PRIVATE_KEY, undefined);
    delete process.env.TEKES_TEST_PRIVATE_KEY;
  }));
test(
  'real AgentKit private pipe supports repeated requests and observation cancellation',
  { skip: !process.env.TEKES_AGENTKIT_BINARY },
  () =>
    temporary(async (root) => {
      const log = await open(join(root, 'service.log'), 'a', 0o600);
      const bridge = new Bridge(
        process.env.TEKES_AGENTKIT_BINARY!,
        { endpoints: [] },
        log.fd,
      );
      try {
        for (let n = 0; n < 25; n++)
          assert.deepEqual(await bridge.request({ op: 'endpoints' }), []);
      } finally {
        bridge.close();
        if (bridge.process.exitCode === null)
          await once(bridge.process, 'exit');
        await log.close();
      }
    }),
);

test('stopping the service aborts an open native chooser without granting access', () =>
  temporary(async (root) => {
    let started!: () => void;
    const opening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const authority = await DirectoryAuthority.create(
      ['kernel'],
      root,
      async (_path, _prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
          started();
        }),
    );
    const pending = authority.pick('kernel');
    await opening;
    authority.close();
    await assert.rejects(pending, /aborted/);
    assert.equal((await authority.execution('kernel', root, {})).cwd, root);
  }));

test('bridge failures log bounded metadata without protocol content', async () =>
  temporary(async (root) => {
    const logPath = join(root, 'bridge.log');
    const log = await open(logPath, 'a', 0o600);
    const cases = [
      {
        name: 'invalid-json',
        source: `#!/usr/bin/env node\nprocess.stdin.resume(); setTimeout(() => process.stdout.write('{"secret":"SENSITIVE_SENTINEL"\\n'), 20);`,
        reason: 'stdout-invalid-json',
      },
      {
        name: 'oversized-frame',
        source: `#!/usr/bin/env node\nprocess.stdin.resume(); setTimeout(() => process.stdout.write('x'.repeat(${LIMIT + 1})), 20);`,
        reason: 'stdout-frame-too-large',
      },
      {
        name: 'child-exit',
        source: '#!/usr/bin/env node\nprocess.exit(17);',
        reason: 'child-exit',
      },
    ];
    try {
      for (const item of cases) {
        const binary = join(root, item.name);
        await writeFile(binary, item.source, { mode: 0o700 });
        await chmod(binary, 0o700);
        const bridge = new Bridge(
          binary,
          { credential: 'SENSITIVE_SENTINEL' },
          log.fd,
        );
        const exited = once(bridge.process, 'exit');
        await assert.rejects(
          bridge.request({ op: 'diagnostic' }),
          /disconnected/,
        );
        await exited;
      }
    } finally {
      await log.close();
    }
    const contents = await readFile(logPath, 'utf8');
    assert.match(contents, /reason=stdout-invalid-json category=parse-failed/);
    assert.match(
      contents,
      /reason=stdout-frame-too-large category=limit-exceeded/,
    );
    assert.match(contents, /event=child-exit code=17 signal=null/);
    assert.doesNotMatch(contents, /SENSITIVE_SENTINEL/);
    assert.doesNotMatch(contents, /"secret"/);
  }));
