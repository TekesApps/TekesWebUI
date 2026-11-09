import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration, saveConfiguration } from '../host/configuration.js';
import { writePrivate } from '../host/private.js';
import type { Options } from '../host/runtime.js';
function options(root: string): Options {
  return {
    runtimeDir: root,
    agentkitSource: root,
    agentkitBinary: join(root, 'existing-binary'),
    kernelBinaryDir: join(root, 'existing-kernel'),
    webRoot: join(root, 'existing-assets'),
    settings: join(root, 'settings.json'),
    kernelDataRoot: join(root, 'data'),
    workspace: root,
    credentialEnv: 'EXISTING_KEY',
    piRegistry: '',
    piRuntime: join(root, 'pi'),
    dshURL: 'http://127.0.0.1:3181',
    dshCookieEnv: 'DSH_COOKIE',
    port: 65150,
  };
}
test('existing configuration is reused as references and unknown credential values are never persisted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-options-'));
  try {
    const source = options(root);
    await writePrivate(
      join(root, 'start-options.json'),
      JSON.stringify({ ...source, credentials: 'PRIVATE_SENTINEL' }),
    );
    const saved = await configuration(root);
    assert.deepEqual(saved, source);
    await saveConfiguration(root, saved);
    assert.equal(
      (await readFile(join(root, 'service-options.json'), 'utf8')).includes(
        'PRIVATE_SENTINEL',
      ),
      false,
    );
    assert.deepEqual(await configuration(root), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('invalid saved paths fail without silently overriding the chosen configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-options-'));
  try {
    await writePrivate(
      join(root, 'start-options.json'),
      JSON.stringify(options(root)),
    );
    await writePrivate(
      join(root, 'service-options.json'),
      JSON.stringify({ ...options(root), kernelBinaryDir: 'relative' }),
    );
    await assert.rejects(configuration(root), /Invalid saved service path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicit Native selection survives saved configuration without changing disabled runtime references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-options-'));
  try {
    const source: Options = {
      ...options(root),
      harnesses: ['native'],
      piRegistry: join(root, 'existing-registry'),
    };
    await saveConfiguration(root, source);
    assert.deepEqual(await configuration(root), source);
    await writePrivate(
      join(root, 'service-options.json'),
      JSON.stringify({ ...source, harnesses: ['native', 'pi', 'pi'] }),
    );
    await assert.rejects(configuration(root), /Invalid harnesses/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('private workspace grants survive save/load without adding mutation authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-workspace-options-'));
  try {
    const source: Options = {
      ...options(root),
      workspaceService: {
        workspaces: [
          {
            id: 'registered-read',
            title: 'Project',
            root,
            allowRead: true,
            allowFileWrites: false,
          },
          {
            id: 'registered-edit',
            root: join(root, 'editable'),
            allowRead: true,
            allowFileWrites: true,
            git: {
              operations: ['commit', 'branch.create'],
              repositories: ['.', 'nested/repository'],
            },
          },
        ],
      },
    };
    await saveConfiguration(root, source);
    assert.deepEqual(await configuration(root), source);
    const disk = JSON.parse(
      await readFile(join(root, 'service-options.json'), 'utf8'),
    );
    assert.deepEqual(disk.workspaceService, source.workspaceService);
    assert.equal('helper' in disk.workspaceService, false);
    assert.equal('stateRoot' in disk.workspaceService, false);
    await saveConfiguration(root, options(root));
    assert.equal(
      (await configuration(root)).workspaceService,
      undefined,
      'old configuration does not acquire persisted mutation grants',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid private workspace registrations fail before replacing a valid saved configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-workspace-invalid-'));
  try {
    await saveConfiguration(root, options(root));
    const file = join(root, 'service-options.json');
    const before = await readFile(file, 'utf8');
    const invalid: unknown[] = [
      { workspaces: [{ id: 'read', root, allowFileWrites: 'true' }] },
      { workspaces: [{ id: 'read', root, allowRead: 1 }] },
      { workspaces: [{ id: 'read', root: 'relative' }] },
      {
        workspaces: [
          { id: 'same', root },
          { id: 'same', root },
        ],
      },
      { workspaces: [{ id: 'read', root, grants: true }] },
      {
        workspaces: [
          {
            id: 'read',
            root,
            git: { operations: ['push', 'push'], repositories: ['.'] },
          },
        ],
      },
      {
        workspaces: [
          {
            id: 'read',
            root,
            git: { operations: ['delete'], repositories: ['.'] },
          },
        ],
      },
      {
        workspaces: [
          {
            id: 'read',
            root,
            git: { operations: ['push'], repositories: ['../outside'] },
          },
        ],
      },
      {
        workspaces: [
          {
            id: 'read',
            root,
            git: { operations: ['push'], repositories: [root] },
          },
        ],
      },
      { workspaces: [], helper: '/browser-chosen-helper' },
    ];
    for (const workspaceService of invalid) {
      await assert.rejects(
        saveConfiguration(root, {
          ...options(root),
          workspaceService,
        } as Options),
        /Invalid saved workspace/,
      );
      assert.equal(await readFile(file, 'utf8'), before);
    }
    await writePrivate(
      file,
      JSON.stringify({ ...options(root), workspaceService: invalid[0] }),
    );
    await assert.rejects(
      configuration(root),
      /Invalid saved workspace/,
      'invalid chosen configuration must not fall back to start-options.json',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
