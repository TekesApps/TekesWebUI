import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveKernelLaunch,
  setupKernelCredential,
  ownedProviderCredential,
} from '../host/launch-configuration.js';
import type { Options } from '../host/runtime.js';
import type { Settings } from '../host/config.js';

const settings: Settings = {
  providers: [
    {
      id: 'deepseek',
      providerID: 'deepseek',
      credentialReference: 'key-deepseek',
      connectionMode: 'direct',
      api: 'deepseek-responses',
      baseURL: 'https://configured.example/v1',
      models: [{ id: 'model', enabled: true }],
    },
  ],
  agentSelections: {
    tekes: { providerIDs: ['deepseek'] },
    pi: { providerIDs: ['deepseek'] },
  },
};
function options(root: string): Options {
  return {
    runtimeDir: root,
    agentkitSource: root,
    agentkitBinary: '/existing/agentkit',
    kernelBinaryDir: '/existing/kernel',
    kernelDataRoot: root,
    webRoot: '/existing/assets',
    workspace: root,
    settings: '/existing/settings',
    credentialEnv: 'HOST_SELECTED_KEY',
    piRegistry: '',
    piRuntime: '/existing/pi',
    dshURL: 'http://127.0.0.1:3181',
    dshCookieEnv: 'DSH_COOKIE',
    port: 65150,
  };
}
async function configured(root: string) {
  await mkdir(join(root, 'config'));
  const providers = {
    format: 1,
    revision: 7,
    providers: ['deepseek', 'glm'].map((id) => ({
      id,
      adapter: 'responses',
      dialect: 'deepseek_responses_v1',
      endpoint: 'https://configured.example/v1',
      credential_key: 'key-' + id,
      models: [
        {
          id: 'model',
          profile: 'test:model',
          enabled: true,
          context_window_tokens: 128000,
          compact_trigger_tokens: 100000,
        },
      ],
    })),
  };
  const selected = {
    format: 1,
    revision: 11,
    default_provider: 'glm',
    default_model: 'model',
  };
  await writeFile(
    join(root, 'config/providers.json'),
    JSON.stringify(providers),
  );
  await writeFile(join(root, 'config/settings.json'), JSON.stringify(selected));
  return Promise.all(
    ['providers.json', 'settings.json'].map((name) =>
      readFile(join(root, 'config', name)),
    ),
  );
}

test('existing mode binds only the owned reference and preserves the roster, bytes and default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-launch-'));
  try {
    const before = await configured(root);
    const result = await resolveKernelLaunch(
      options(root),
      settings,
      async () => undefined,
      { HOST_SELECTED_KEY: 'OWNED_TEST_SECRET' },
    );
    assert.equal(result.launch.configuration_mode, 'existing');
    assert.equal(Object.hasOwn(result.launch, 'providers'), false);
    assert.deepEqual(result.credentials, {
      'key-deepseek': 'OWNED_TEST_SECRET',
    });
    assert.deepEqual(Object.keys(result.launch.credential_bindings as object), [
      'key-deepseek',
    ]);
    const after = await Promise.all(
      ['providers.json', 'settings.json'].map((name) =>
        readFile(join(root, 'config', name)),
      ),
    );
    assert.deepEqual(after, before);
    assert.equal(JSON.parse(after[1].toString()).default_provider, 'glm');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unavailable secrets leave existing providers configured without placeholder credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-launch-'));
  try {
    const before = await configured(root);
    const result = await resolveKernelLaunch(
      options(root),
      settings,
      async () => undefined,
      {},
    );
    assert.deepEqual(result.credentials, {});
    assert.deepEqual(result.launch.credential_bindings, {});
    assert.deepEqual(
      await readFile(join(root, 'config/providers.json')),
      before[0],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a mismatched credential reference cannot reuse the selected environment secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-launch-'));
  try {
    await configured(root);
    const changed = {
      ...settings,
      providers: [
        { ...settings.providers[0], credentialReference: 'other-key' },
      ],
    };
    const result = await resolveKernelLaunch(
      options(root),
      changed,
      async () => undefined,
      { HOST_SELECTED_KEY: 'FOREIGN_TEST_SECRET' },
    );
    assert.deepEqual(result.credentials, {});
    await assert.rejects(
      ownedProviderCredential(
        options(root),
        settings,
        { ...settings.providers[0], id: 'other-provider' },
        async () => undefined,
        { HOST_SELECTED_KEY: 'FOREIGN_TEST_SECRET' },
      ),
      /Credential unavailable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('partial existing configuration fails instead of reverting to a publishing launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-existing-launch-'));
  try {
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config/settings.json'), '{}');
    await assert.rejects(
      resolveKernelLaunch(options(root), settings, async () => undefined, {}),
    );
    await assert.rejects(readFile(join(root, 'config/providers.json')), {
      code: 'ENOENT',
    });
    assert.equal(
      await readFile(join(root, 'config/settings.json'), 'utf8'),
      '{}',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a fresh explicit fixture keeps the legacy provided-mode contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-provided-launch-'));
  try {
    const result = await resolveKernelLaunch(
      options(root),
      settings,
      async () => undefined,
      { HOST_SELECTED_KEY: 'OWNED_TEST_SECRET' },
    );
    assert.equal(result.launch.configuration_mode, undefined);
    assert.equal(
      (result.launch.providers as { providers: unknown[] }).providers.length,
      1,
    );
    assert.deepEqual(result.credentials, { deepseek: 'OWNED_TEST_SECRET' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('setup configures the canonical GLM default without assigning a legacy DeepSeek key to it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-setup-glm-'));
  try {
    const before = await configured(root);
    const saved = new Map<string, string>();
    const prompts: string[] = [];
    await setupKernelCredential(
      options(root),
      settings,
      {
        read: async (account) => saved.get(account),
        save: async (account, secret) => {
          saved.set(account, secret);
        },
        prompt: async (message) => {
          prompts.push(message);
          return 'GLM_SETUP_SECRET';
        },
      },
      { HOST_SELECTED_KEY: 'DEEPSEEK_OWNER_SECRET' },
    );
    assert.deepEqual([...saved], [['key-glm', 'GLM_SETUP_SECRET']]);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /for glm /);
    const launch = await resolveKernelLaunch(
      options(root),
      settings,
      async (ref) => saved.get(ref),
      {},
    );
    assert.deepEqual(launch.credentials, { 'key-glm': 'GLM_SETUP_SECRET' });
    assert.deepEqual(
      await Promise.all(
        ['providers.json', 'settings.json'].map((name) =>
          readFile(join(root, 'config', name)),
        ),
      ),
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical setup reuses its saved credential without requiring a legacy provider selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-setup-saved-'));
  try {
    await configured(root);
    await setupKernelCredential(
      options(root),
      { providers: [] },
      {
        read: async (ref) =>
          ref === 'key-glm' ? 'SAVED_GLM_SECRET' : undefined,
        save: async () => {
          assert.fail('unchanged saved key must not be rewritten');
        },
        prompt: async () => {
          assert.fail('saved canonical key must not prompt');
        },
      },
      { HOST_SELECTED_KEY: 'UNRELATED_SECRET' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical setup accepts an environment key only for its matching provider reference and endpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-setup-owned-'));
  try {
    await configured(root);
    const owner: Settings = {
      providers: [
        { ...settings.providers[0], id: 'glm', credentialReference: 'key-glm' },
      ],
      agentSelections: { tekes: { providerIDs: ['glm'] } },
    };
    const saved: Array<[string, string]> = [];
    await setupKernelCredential(
      options(root),
      owner,
      {
        read: async () => undefined,
        save: async (account, secret) => {
          saved.push([account, secret]);
        },
        prompt: async () => {
          assert.fail('owned environment key must not prompt');
        },
      },
      { HOST_SELECTED_KEY: 'OWNED_GLM_SECRET' },
    );
    assert.deepEqual(saved, [['key-glm', 'OWNED_GLM_SECRET']]);
    owner.providers[0].baseURL = 'https://different.example';
    await setupKernelCredential(
      options(root),
      owner,
      {
        read: async () => undefined,
        save: async (account, secret) => {
          saved.push([account, secret]);
        },
        prompt: async () => 'EXPLICIT_GLM_SECRET',
      },
      { HOST_SELECTED_KEY: 'WRONG_ENDPOINT_SECRET' },
    );
    assert.deepEqual(saved[1], ['key-glm', 'EXPLICIT_GLM_SECRET']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical setup validates documents before reading or saving credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tekes-setup-invalid-'));
  try {
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config/settings.json'), '{}');
    await writeFile(join(root, 'config/providers.json'), '{broken');
    await assert.rejects(
      setupKernelCredential(options(root), settings, {
        read: async () => {
          assert.fail('invalid config must not read Keychain');
        },
        save: async () => {
          assert.fail('invalid config must not write Keychain');
        },
        prompt: async () => {
          assert.fail('invalid config must not prompt');
        },
      }),
      /providers.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
