import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DirectoryAuthority } from '../host/directory';
import { prepareNativePresetExecution } from '../host/preset-execution';

test('preset preview and create reuse the same host execution grant without identity sugar', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'preset-host-')));
  const directories = await DirectoryAuthority.create(
    ['tekes-loopback-default'],
    root,
    async () => '',
  );
  try {
    const preset = {
      layers: [{ kind: 'inline', id: 'review', version: '1', duty: 'Review' }],
      tools: ['read'],
      defaults: { provider: 'configured', model: 'flash' },
    };
    const source = {
      connectionEpoch: 7,
      cwd: root,
      preset,
      execution: {
        cwd: '/',
        network: true,
        allowed_tools: ['untrusted'],
        mcp: [{ name: 'rogue' }],
      },
    };
    const preview = await prepareNativePresetExecution(
      {
        endpoint: 'tekes-loopback-default',
        method: 'agent.preset.preview',
        payload: source,
      },
      root,
      directories,
    );
    const create = await prepareNativePresetExecution(
      {
        endpoint: 'tekes-loopback-default',
        method: 'session.create',
        payload: { cwd: root, preset, execution: source.execution },
      },
      root,
      directories,
    );
    assert.deepEqual(preview.execution, create.execution);
    assert.deepEqual(preview.preset, preset);
    assert.deepEqual(create.preset, preset);
    assert.equal('identityProfile' in create, false);
    assert.equal('cwd' in create, false);
    assert.equal((preview.execution as Record<string, unknown>).network, false);
    assert.equal(
      'mcp' in (preview.execution as Record<string, unknown>),
      false,
    );
    assert.deepEqual(Object.keys(preview).sort(), [
      'connectionEpoch',
      'execution',
      'preset',
    ]);
    const raw = await prepareNativePresetExecution(
      {
        endpoint: 'tekes-loopback-default',
        method: 'session.presets.resolve',
        payload: source,
      },
      root,
      directories,
    );
    assert.deepEqual(Object.keys(raw).sort(), ['execution', 'preset']);
    assert.equal(
      source.execution.network,
      true,
      'browser input must not be mutated into apparent host authority',
    );
    const basic = await prepareNativePresetExecution(
      {
        endpoint: 'tekes-loopback-default',
        method: 'session.create',
        payload: { cwd: root },
      },
      root,
      directories,
    );
    assert.equal(basic.identityProfile, 'general');
  } finally {
    directories.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('preset preview refuses unchosen directories and mixed identity before any Kernel request', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'preset-host-')));
  const other = join(root, 'unchosen');
  await mkdir(other);
  const directories = await DirectoryAuthority.create(
    ['tekes-loopback-default'],
    root,
    async () => '',
  );
  try {
    await assert.rejects(
      prepareNativePresetExecution(
        {
          endpoint: 'tekes-loopback-default',
          method: 'agent.preset.preview',
          payload: { cwd: other, connectionEpoch: 1, preset: {} },
        },
        root,
        directories,
      ),
      /Choose this/,
    );
    await assert.rejects(
      prepareNativePresetExecution(
        {
          endpoint: 'tekes-loopback-default',
          method: 'session.create',
          payload: { cwd: root, identityProfile: 'general', preset: {} },
        },
        root,
        directories,
      ),
      /exclusive/,
    );
    await assert.rejects(
      prepareNativePresetExecution(
        {
          endpoint: 'tekes-loopback-default',
          method: 'session.create',
          payload: { cwd: root, agentPreset: 'coding', preset: {} },
        },
        root,
        directories,
      ),
      /exclusive/,
    );
  } finally {
    directories.close();
    await rm(root, { recursive: true, force: true });
  }
});
