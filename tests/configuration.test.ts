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
