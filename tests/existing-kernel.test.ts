import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '../host/config.js';
import { readExistingKernelConfiguration } from '../host/existing-kernel.js';

const legacySettings: Settings = { providers: [], agentSelections: {} };

function provider(id: string, credentialKey = `${id}-credential`) {
  return {
    id,
    adapter: 'responses',
    dialect: id === 'glm' ? 'glm_chat_v1' : 'openai_responses_v1',
    endpoint: `https://${id}.example.test/v1`,
    endpoint_owner: id,
    gateway_translation: 'direct',
    evidence_revision: `${id}-fixture-v1`,
    credential_key: credentialKey,
    models: [
      {
        id: id === 'glm' ? 'glm-5.2' : `${id}-model`,
        profile: `${id}-profile`,
        enabled: true,
        context_window_tokens: 128000,
        compact_trigger_tokens: 100000,
      },
    ],
  };
}

function fixtureDocuments() {
  return {
    providers: {
      format: 1,
      revision: 12,
      providers: [
        provider('deepseek'),
        provider('glm'),
        provider('kimi'),
        provider('openai'),
        provider('anthropic'),
        provider('cloudflare'),
        provider('google'),
        provider('local'),
      ],
    },
    settings: {
      format: 1,
      revision: 7,
      default_provider: 'glm',
      default_model: 'glm-5.2',
      limits: { max_provider_leases: 3, max_workers: 6 },
    },
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-kernel-'));
  const config = join(root, 'config');
  await mkdir(config);
  const docs = fixtureDocuments();
  const providerBytes = JSON.stringify(docs.providers) + '\n';
  const settingsBytes = JSON.stringify(docs.settings) + '\n';
  await writeFile(join(config, 'providers.json'), providerBytes, {
    mode: 0o600,
  });
  await writeFile(join(config, 'settings.json'), settingsBytes, {
    mode: 0o600,
  });
  return { root, config, docs, providerBytes, settingsBytes };
}

test('loads eight canonical providers and GLM default read-only without provider projection', async () => {
  const fixture = await setup();
  try {
    const result = await readExistingKernelConfiguration(
      fixture.root,
      join(fixture.root, 'kernel-bin'),
      legacySettings,
      { 'glm-credential': 'TEKES_GLM_KEY' },
    );
    assert.equal(result.providers.revision, 12);
    assert.equal(result.settings.revision, 7);
    assert.equal(result.providers.providers.length, 8);
    assert.equal(result.defaultProvider, 'glm');
    assert.equal(result.defaultModel, 'glm-5.2');
    assert.deepEqual(result.defaultSelection, {
      provider: 'glm',
      model: 'glm-5.2',
    });
    assert.equal(Object.isFrozen(result.providers.providers[0]), true);
    assert.equal(Object.isFrozen(result.providers.providers[0].models), true);
    assert.deepEqual(result.credentialRefs, [
      'anthropic-credential',
      'cloudflare-credential',
      'deepseek-credential',
      'glm-credential',
      'google-credential',
      'kimi-credential',
      'local-credential',
      'openai-credential',
    ]);
    assert.deepEqual(result.launch, {
      format: 1,
      bootstrap_version: 1,
      root: fixture.root,
      worker: join(fixture.root, 'kernel-bin', 'tekes-worker'),
      listen: '127.0.0.1:0',
      configuration_mode: 'existing',
      credential_bindings: { 'glm-credential': 'TEKES_GLM_KEY' },
    });
    assert.equal(Object.hasOwn(result.launch, 'providers'), false);
    assert.equal(
      await readFile(join(fixture.config, 'providers.json'), 'utf8'),
      fixture.providerBytes,
    );
    assert.equal(
      await readFile(join(fixture.config, 'settings.json'), 'utf8'),
      fixture.settingsBytes,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects bindings for credentials absent from the canonical roster', async () => {
  const fixture = await setup();
  try {
    await assert.rejects(
      readExistingKernelConfiguration(
        fixture.root,
        fixture.root,
        legacySettings,
        {
          'old-webui-provider': 'OLD_KEY',
        },
      ),
      /Unknown credential binding reference/,
    );
    assert.equal(
      await readFile(join(fixture.config, 'providers.json'), 'utf8'),
      fixture.providerBytes,
    );
    assert.equal(
      await readFile(join(fixture.config, 'settings.json'), 'utf8'),
      fixture.settingsBytes,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects malformed and unsupported documents without rewriting either file', async () => {
  const fixture = await setup();
  try {
    await writeFile(join(fixture.config, 'providers.json'), '{not json');
    await assert.rejects(
      readExistingKernelConfiguration(
        fixture.root,
        fixture.root,
        legacySettings,
      ),
      /Malformed existing Kernel providers\.json JSON/,
    );
    assert.equal(
      await readFile(join(fixture.config, 'providers.json'), 'utf8'),
      '{not json',
    );
    assert.equal(
      await readFile(join(fixture.config, 'settings.json'), 'utf8'),
      fixture.settingsBytes,
    );

    await writeFile(
      join(fixture.config, 'providers.json'),
      JSON.stringify({ ...fixture.docs.providers, format: 2 }),
    );
    await assert.rejects(
      readExistingKernelConfiguration(
        fixture.root,
        fixture.root,
        legacySettings,
      ),
      /Invalid existing Kernel providers\.json document/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('missing canonical files fail without creating any files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-kernel-missing-'));
  try {
    await assert.rejects(
      readExistingKernelConfiguration(root, root, legacySettings),
      /Missing existing Kernel config directory/,
    );
    assert.deepEqual(await readdir(root), []);

    await mkdir(join(root, 'config'));
    await assert.rejects(
      readExistingKernelConfiguration(root, root, legacySettings),
      /Missing existing Kernel (?:providers|settings)\.json/,
    );
    assert.deepEqual(await readdir(join(root, 'config')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects duplicate canonical provider ids and invalid credential references', async () => {
  const fixture = await setup();
  try {
    const duplicate = {
      ...fixture.docs.providers,
      providers: [provider('dupe'), provider('dupe')],
    };
    await writeFile(
      join(fixture.config, 'providers.json'),
      JSON.stringify(duplicate),
    );
    await assert.rejects(
      readExistingKernelConfiguration(
        fixture.root,
        fixture.root,
        legacySettings,
      ),
      /Invalid or duplicate provider/,
    );
    const invalidRef = {
      ...fixture.docs.providers,
      providers: [{ ...provider('bad'), credential_key: 'bad\nref' }],
    };
    await writeFile(
      join(fixture.config, 'providers.json'),
      JSON.stringify(invalidRef),
    );
    await assert.rejects(
      readExistingKernelConfiguration(
        fixture.root,
        fixture.root,
        legacySettings,
      ),
      /Invalid credential reference/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
