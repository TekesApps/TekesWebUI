import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../host/config.js';
import {
  runtimeIdentity,
  verifyRuntimeIdentity,
  type CandidateManifest,
} from '../host/runtime-identity.js';
import { configuration, saveConfiguration } from '../host/configuration.js';
import { writePrivate } from '../host/private.js';
import type { Options } from '../host/runtime.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tekes-candidate-'));
  const web = join(root, 'web'),
    kernel = join(root, 'kernel');
  for (const name of [
    'web',
    'web/dist',
    'web/dist-host',
    'kernel',
    'runtime',
    'data',
    'workspace',
  ])
    await mkdir(join(root, name));
  const identity = {
    format: 1,
    identifier: 'com.tekes.kernel.supervisor',
    version: '0.9.18',
    source_revision: 'a'.repeat(40),
  };
  const binaries: Record<string, string> = {};
  for (const name of [
    'tekes-supervisor',
    'tekes-worker',
    'tekes-helper',
    'tekes-workspace-service',
  ]) {
    const bytes =
      name === 'tekes-supervisor'
        ? `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(identity))});\n`
        : 'fixture\n';
    await writeFile(join(kernel, name), bytes, { mode: 0o700 });
    binaries[name] = sha256(Buffer.from(bytes));
  }
  const core = join(root, 'core');
  await writeFile(core, 'ACTUAL_CORE_FIXTURE_NOT_RELAY');
  const coreHash = sha256(await readFile(core));
  const ref = async (name: string, value: unknown) => {
    const path = join(root, name),
      bytes = JSON.stringify(value);
    await writeFile(path, bytes);
    return { path, sha256: sha256(Buffer.from(bytes)) };
  };
  const kernelReceipt = await ref('kernel-receipt.json', {
    sourceBefore: { head: identity.source_revision, tree: 'b'.repeat(40) },
    sourceRevision: identity.source_revision,
    describeBuild: identity,
  });
  const coreReceipt = await ref('core-receipt.json', {
    sourceRevision: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    programSha256: coreHash,
  });
  const dto = 'e'.repeat(40);
  const packageFiles = {
    'dist/index.html': '<p>candidate</p>',
    'dist-host/runtime-identity.js': 'compiled fixture',
    'package.json': JSON.stringify({
      dependencies: {
        '@tekesagentkit/client-contract': `https://codeload.github.com/TekesApps/TekesAgentKit/tar.gz/${dto}`,
      },
    }),
    'package-lock.json': '{"lockfileVersion":3}',
  };
  for (const [name, bytes] of Object.entries(packageFiles))
    await writeFile(join(web, name), bytes);
  const compiled = await ref('compiled.json', {
    sourceRevision: 'f'.repeat(40),
    sourceTree: '1'.repeat(40),
    files: Object.fromEntries(
      Object.entries(packageFiles).map(([n, v]) => [n, sha256(Buffer.from(v))]),
    ),
  });
  const manifest: CandidateManifest = {
    version: 1,
    label: 'LOCAL_CANDIDATE_NOT_PUBLIC018',
    scope: {
      root,
      runtimeDir: join(root, 'runtime'),
      kernelDataRoot: join(root, 'data'),
      workspace: join(root, 'workspace'),
      harnesses: ['native'],
    },
    kernel: {
      revision: identity.source_revision,
      tree: 'b'.repeat(40),
      build: 'fixture-build002',
      receipt: kernelReceipt,
      binaries,
      describeBuild: identity,
    },
    core: {
      revision: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      programSha256: coreHash,
      receipt: coreReceipt,
    },
    web: {
      revision: 'f'.repeat(40),
      tree: '1'.repeat(40),
      compiledManifest: compiled,
      dto: {
        revision: dto,
        lockSha256: sha256(Buffer.from(packageFiles['package-lock.json'])),
      },
    },
  };
  const options: Options = {
    runtimeDir: manifest.scope.runtimeDir,
    agentkitSource: '',
    agentkitBinary: core,
    kernelBinaryDir: kernel,
    webRoot: join(web, 'dist'),
    kernelDataRoot: manifest.scope.kernelDataRoot,
    workspace: manifest.scope.workspace,
    settings: join(root, 'settings.json'),
    credentialEnv: 'UNUSED_KEY',
    port: 0,
    piRegistry: '',
    piRuntime: '',
    dshURL: 'http://127.0.0.1:1',
    dshCookieEnv: '',
    harnesses: ['native'],
    kernelConfigurationMode: 'existing',
  };
  async function freeze() {
    const r = await ref('manifest.json', manifest);
    options.runtimeIdentity = {
      kind: 'local-candidate',
      manifestPath: r.path,
      manifestSha256: r.sha256,
    };
  }
  await freeze();
  return {
    root,
    web,
    kernel,
    identity,
    manifest,
    options,
    freeze,
    ref,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('explicit candidate verifies real configured bytes and returns actual version without public provenance', async () => {
  const f = await fixture();
  try {
    assert.equal(await verifyRuntimeIdentity(f.options, f.web), '0.9.18');
  } finally {
    await f.close();
  }
});

test('absent identity retains strict published verifier; candidate failure never falls back', async () => {
  const f = await fixture();
  try {
    const ordinary = { ...f.options };
    delete ordinary.runtimeIdentity;
    await assert.rejects(verifyRuntimeIdentity(ordinary, f.web), /ENOENT/);
    f.options.runtimeIdentity!.manifestSha256 = '0'.repeat(64);
    await assert.rejects(
      verifyRuntimeIdentity(f.options, f.web),
      /provenance hash/,
    );
  } finally {
    await f.close();
  }
});

for (const name of [
  'tekes-supervisor',
  'tekes-worker',
  'tekes-helper',
  'tekes-workspace-service',
]) {
  test(`candidate rejects changed ${name}`, async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.kernel, name), 'changed');
      await assert.rejects(
        verifyRuntimeIdentity(f.options, f.web),
        /hash mismatch/,
      );
    } finally {
      await f.close();
    }
  });
}

for (const target of [
  'Core',
  'Web',
  'Kernel receipt',
  'Core receipt',
  'compiled receipt',
  'manifest',
]) {
  test(`candidate rejects changed ${target} before startup`, async () => {
    const f = await fixture();
    try {
      const path =
        target === 'Core'
          ? f.options.agentkitBinary
          : target === 'Web'
            ? join(f.web, 'dist/index.html')
            : target === 'Kernel receipt'
              ? f.manifest.kernel.receipt.path
              : target === 'Core receipt'
                ? f.manifest.core.receipt.path
                : target === 'compiled receipt'
                  ? f.manifest.web.compiledManifest.path
                  : f.options.runtimeIdentity!.manifestPath;
      await writeFile(path, '{}');
      await assert.rejects(
        verifyRuntimeIdentity(f.options, f.web),
        /hash mismatch/,
      );
    } finally {
      await f.close();
    }
  });
}

test('candidate rejects actual describe identity even when the new binary hash is explicitly bound', async () => {
  const f = await fixture();
  try {
    const bytes = `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ ...f.identity, source_revision: '0'.repeat(40) }))});\n`;
    await writeFile(join(f.kernel, 'tekes-supervisor'), bytes);
    f.manifest.kernel.binaries['tekes-supervisor'] = sha256(Buffer.from(bytes));
    await f.freeze();
    await assert.rejects(
      verifyRuntimeIdentity(f.options, f.web),
      /actual Kernel identity/,
    );
  } finally {
    await f.close();
  }
});

test('manifest rejects unknown version/label and mismatched source or DTO provenance', async () => {
  const f = await fixture();
  try {
    const changes = [
      () => {
        f.manifest.version = 2 as 1;
      },
      () => {
        f.manifest.label = 'public018' as typeof f.manifest.label;
      },
      () => {
        f.manifest.kernel.tree = '0'.repeat(40);
      },
      () => {
        f.manifest.core.revision = '0'.repeat(40);
      },
      () => {
        f.manifest.web.tree = '0'.repeat(40);
      },
      () => {
        f.manifest.web.dto.revision = '0'.repeat(40);
      },
      () => {
        f.manifest.web.dto.lockSha256 = '0'.repeat(64);
      },
    ];
    const original = JSON.stringify(f.manifest);
    for (const change of changes) {
      Object.assign(f.manifest, JSON.parse(original));
      change();
      await f.freeze();
      await assert.rejects(
        verifyRuntimeIdentity(f.options, f.web),
        /candidate|Candidate/,
      );
    }
  } finally {
    await f.close();
  }
});

test('isolated scope rejects wrong directories, escaping symlinks, harnesses and provided mode', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'tekes-outside-'));
  try {
    await assert.rejects(
      verifyRuntimeIdentity({ ...f.options, workspace: outside }, f.web),
      /isolated scope/,
    );
    await symlink(outside, join(f.root, 'escape'));
    f.manifest.scope.workspace = join(f.root, 'escape');
    await f.freeze();
    await assert.rejects(
      verifyRuntimeIdentity(
        { ...f.options, workspace: join(f.root, 'escape') },
        f.web,
      ),
      /isolated scope/,
    );
    await assert.rejects(
      verifyRuntimeIdentity(
        { ...f.options, harnesses: ['native', 'pi'] },
        f.web,
      ),
      /isolated Native/,
    );
    await assert.rejects(
      verifyRuntimeIdentity(
        { ...f.options, kernelConfigurationMode: 'provided' },
        f.web,
      ),
      /isolated Native/,
    );
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});

test('compiled closure rejects missing/extra files and a separately selected asset tree', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.web, 'dist/extra.js'), 'extra');
    await assert.rejects(
      verifyRuntimeIdentity(f.options, f.web),
      /file set mismatch/,
    );
    await rm(join(f.web, 'dist/extra.js'));
    await assert.rejects(
      verifyRuntimeIdentity({ ...f.options, webRoot: f.root }, f.web),
      /running host/,
    );
    await rm(join(f.web, 'dist/index.html'));
    await assert.rejects(
      verifyRuntimeIdentity(f.options, f.web),
      /file set mismatch/,
    );
  } finally {
    await f.close();
  }
});

test('saved identity round trips through legacy import and restart references without secrets or unknown fields', async () => {
  const f = await fixture();
  try {
    const extra = {
      ...f.options,
      runtimeIdentity: { ...f.options.runtimeIdentity!, token: 'SENTINEL' },
      credentials: 'SENTINEL',
    };
    await writePrivate(
      join(f.options.runtimeDir, 'start-options.json'),
      JSON.stringify(extra),
    );
    const loaded = await configuration(f.options.runtimeDir);
    assert.deepEqual(loaded.runtimeIdentity, f.options.runtimeIdentity);
    await saveConfiguration(f.options.runtimeDir, loaded);
    assert.equal(
      (
        await readFile(
          join(f.options.runtimeDir, 'service-options.json'),
          'utf8',
        )
      ).includes('SENTINEL'),
      false,
    );
    assert.deepEqual(await configuration(f.options.runtimeDir), loaded);
    await verifyRuntimeIdentity(
      await configuration(f.options.runtimeDir),
      f.web,
    );
  } finally {
    await f.close();
  }
});

test('unknown or malformed identity is rejected on read/save instead of sanitized into public mode', async () => {
  const f = await fixture();
  try {
    for (const identity of [
      null,
      { kind: 'other' },
      {
        kind: 'local-candidate',
        manifestPath: 'relative',
        manifestSha256: '0'.repeat(64),
      },
      {
        kind: 'local-candidate',
        manifestPath: '/absolute',
        manifestSha256: '',
      },
    ]) {
      assert.throws(() => runtimeIdentity(identity));
      const bad = { ...f.options, runtimeIdentity: identity } as Options;
      await writePrivate(
        join(f.options.runtimeDir, 'start-options.json'),
        JSON.stringify(bad),
      );
      await assert.rejects(configuration(f.options.runtimeDir));
      await assert.rejects(saveConfiguration(f.options.runtimeDir, bad));
    }
  } finally {
    await f.close();
  }
});
