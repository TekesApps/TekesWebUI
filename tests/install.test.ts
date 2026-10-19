import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import {
  installBundle,
  verifyRelease,
  installation,
  saveInstallation,
  safePath,
  AGENTKIT_PIN,
  type BundleManifest,
  type Installation,
} from '../host/install.js';
import { KERNEL_PIN, sha256 } from '../host/config.js';
import { activate, assertIdle } from '../host/manage.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writePrivate } from '../host/private.js';

async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tekes-install-')));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function bundle(root: string, link = false) {
  const content = join(root, 'content');
  await mkdir(content, { recursive: true });
  const fixture = `#!/usr/bin/env node\nconsole.log(JSON.stringify({version:${JSON.stringify(KERNEL_PIN.version)},source_revision:${JSON.stringify(KERNEL_PIN.revision)}}));\n`;
  const binaries: Record<string, { sha256: string }> = {};
  const data: Record<string, string> = {
    'package.json': JSON.stringify({ version: '0.1.20', type: 'module' }),
    'dist/index.html': '<p>release</p>',
    'dist-host/cli.js': 'console.log("fixture help")',
    'dist-host/manage.cjs': '// fixture manager',
    'runtime/agentkit/tekes-agent-web': 'fixture',
  };
  for (const name of [
    'tekes-supervisor',
    'tekes-worker',
    'tekes-helper',
    'tekes-workspace-service',
  ]) {
    data['runtime/kernel/' + name] = fixture;
    binaries[name] = { sha256: sha256(Buffer.from(fixture)) };
  }
  data['runtime/kernel/BuildProvenance.json'] = JSON.stringify({
    kernel: KERNEL_PIN,
    binaries,
  });
  const files: BundleManifest['files'] = {};
  for (const [path, text] of Object.entries(data)) {
    await mkdir(join(content, path, '..'), { recursive: true });
    await writeFile(join(content, path), text);
    files[path] = {
      sha256: sha256(Buffer.from(text)),
      executable: path.startsWith('runtime/kernel/tekes-'),
    };
  }
  const paths = Object.keys(files);
  if (link) {
    await symlink('/etc/passwd', join(content, 'link'));
    paths.push('link');
  }
  const archivePath = join(root, 'bundle.tgz');
  await create({ cwd: content, file: archivePath, gzip: true }, paths);
  const archive = await readFile(archivePath);
  const manifest: BundleManifest = {
    format: 1,
    version: '0.1.20',
    platform: `${process.platform}-${process.arch}`,
    archive: 'bundle.tgz',
    sha256: sha256(archive),
    sourceRevision: 'a'.repeat(40),
    kernel: KERNEL_PIN,
    agentkit: AGENTKIT_PIN,
    files,
  };
  return { manifest, archive };
}
test('installer verifies bundle, exact runtime pins and installed file hashes; repeated installation is idempotent', () =>
  temporary(async (root) => {
    const { manifest, archive } = await bundle(root);
    const runtime = join(root, 'runtime');
    await mkdir(runtime, { mode: 0o700 });
    const first = await installBundle(runtime, manifest, archive);
    await verifyRelease(first);
    assert.deepEqual(await installBundle(runtime, manifest, archive), first);
    await writeFile(join(first.directory, 'dist/index.html'), 'tampered');
    await assert.rejects(verifyRelease(first), /hash mismatch/);
  }));
test('corrupt downloads, foreign platform and unsafe archive links never replace saved installation', () =>
  temporary(async (root) => {
    const { manifest, archive } = await bundle(root, true);
    const runtime = join(root, 'runtime');
    await mkdir(runtime, { mode: 0o700 });
    const existing = {
      format: 1,
      current: {
        directory: '/previous',
        version: '0.1.19',
        platform: manifest.platform,
        manifestHash: 'old',
      },
      options: {},
    } as Installation;
    await saveInstallation(runtime, existing);
    await assert.rejects(
      installBundle(runtime, manifest, Buffer.from('bad')),
      /hash mismatch/,
    );
    await assert.rejects(
      installBundle(runtime, { ...manifest, platform: 'foreign' }, archive),
      /mismatch/,
    );
    await assert.rejects(
      installBundle(runtime, manifest, archive),
      /Unsafe archive/,
    );
    assert.deepEqual(await installation(runtime), existing);
  }));
test('archive paths reject traversal, absolute paths and ambiguous separators', () => {
  for (const path of ['../x', '/x', 'a/../../x', 'a\\x', 'a//x', './x', ''])
    assert.equal(safePath(path), false, path);
  assert.equal(safePath('runtime/kernel/tekes-worker'), true);
});
test('failed update activation restores the prior configuration and restarts its release', () =>
  temporary(async (root) => {
    const current = {
      format: 1,
      current: {
        directory: '/old',
        version: '0.1.19',
        platform: 'darwin-arm64',
        manifestHash: 'old',
      },
      options: {},
    } as Installation;
    const next = {
      ...current,
      current: { ...current.current, directory: '/new', version: '0.1.20' },
    };
    await saveInstallation(root, current);
    const calls: string[] = [];
    await assert.rejects(
      activate(root, next, current, true, async (state, command) => {
        calls.push(state.current.directory + ':' + command);
        if (state.current.directory === '/new' && command === 'start')
          throw new Error('startup failed');
      }),
      /startup failed/,
    );
    assert.deepEqual(await installation(root), current);
    assert.deepEqual(calls, [
      '/old:stop',
      '/new:start',
      '/new:stop',
      '/old:start',
    ]);
  }));
test('update refuses to stop running work or proceed without authoritative readiness', () =>
  temporary(async (root) => {
    let running = true,
      ready = true;
    const server = createServer(async (req, res) => {
      let text = '';
      for await (const part of req) text += part;
      const request = JSON.parse(text);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          value:
            request.op === 'endpoints'
              ? [{ id: 'e', connection: 'ready' }]
              : {
                  control_ready: ready,
                  inventory_ready: ready,
                  sessions: { s: { run_open: running, queue: [] } },
                },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await writePrivate(
      join(root, 'ready.json'),
      JSON.stringify({ url: `http://127.0.0.1:${address.port}` }),
    );
    await writePrivate(
      join(root, 'app-connection.json'),
      JSON.stringify({ bearer: 'test' }),
    );
    try {
      await assert.rejects(assertIdle(root), /Running or queued/);
      running = false;
      ready = false;
      await assert.rejects(assertIdle(root), /Running or queued/);
      ready = true;
      await assertIdle(root);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  }));
