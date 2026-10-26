import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  kernelProjection,
  selected,
  type Provider,
  type Settings,
} from './config.js';
import { readExistingKernelConfiguration } from './existing-kernel.js';
import type { Options } from './runtime.js';
import type { Wire } from './bridge.js';

type Lookup = (reference: string) => Promise<string | undefined>;

export function selectedHostProvider(
  settings: Settings,
  agent: string,
): Provider | undefined {
  const enabled = selected(settings.agentSelections?.[agent]);
  const rows = settings.providers.filter((provider) =>
    enabled.has(provider.id),
  );
  if (!rows.length) return undefined;
  if (rows.length !== 1)
    throw new Error(`Expected one configured ${agent} provider`);
  return rows[0];
}

export async function ownedProviderCredential(
  options: Options,
  settings: Settings,
  provider: Provider,
  lookup: Lookup,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  // The existing environment option belongs to the explicitly selected host
  // connection. It must never supply a different provider just by vendor name.
  const owner = selectedHostProvider(settings, 'tekes');
  const fromEnvironment =
    owner?.id === provider.id
      ? environment[options.credentialEnv]?.trim()
      : undefined;
  const secret =
    fromEnvironment ||
    (await lookup(provider.id)) ||
    (provider.credentialReference
      ? await lookup(provider.credentialReference)
      : undefined);
  if (!secret)
    throw new Error(
      `Credential unavailable for configured provider ${provider.id}`,
    );
  return secret;
}

export async function resolveKernelLaunch(
  options: Options,
  settings: Settings,
  lookup: Lookup,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ launch: Wire; credentials: Record<string, string> }> {
  let mode = options.kernelConfigurationMode ?? 'auto';
  if (mode === 'auto') {
    const files = await Promise.all(
      ['providers.json', 'settings.json'].map(async (name) => {
        try {
          await lstat(join(options.kernelDataRoot, 'config', name));
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        }
      }),
    );
    mode =
      files.some(Boolean) ||
      resolve(options.kernelDataRoot) === join(homedir(), '.agents')
        ? 'existing'
        : 'provided';
  }
  if (mode === 'provided') {
    if (resolve(options.kernelDataRoot) === join(homedir(), '.agents'))
      throw new Error(
        'The current .agents directory requires existing configuration mode',
      );
    const { provider, launch } = kernelProjection(
      settings,
      options.kernelDataRoot,
      options.kernelBinaryDir,
    );
    const secret = await ownedProviderCredential(
      options,
      settings,
      provider,
      lookup,
      environment,
    );
    return { launch, credentials: { [provider.id]: secret } };
  }
  if (mode !== 'existing') throw new Error('Invalid Kernel configuration mode');
  const current = await readExistingKernelConfiguration(
    options.kernelDataRoot,
    options.kernelBinaryDir,
    settings,
  );
  const owner = selectedHostProvider(settings, 'tekes');
  const credentials: Record<string, string> = {},
    bindings: Record<string, string> = {};
  for (const ref of current.credentialRefs) {
    const providers = current.providers.providers.filter(
      (provider) => provider.credential_key === ref,
    );
    let secret = await lookup(ref);
    for (const provider of providers) {
      if (!secret) secret = await lookup(provider.id);
      if (
        !secret &&
        owner?.id === provider.id &&
        owner.credentialReference === ref &&
        owner.baseURL.replace(/\/+$/, '') ===
          provider.endpoint.replace(/\/+$/, '')
      )
        secret = environment[options.credentialEnv]?.trim();
    }
    if (secret) {
      credentials[ref] = secret;
      bindings[ref] =
        `TEKES_HOST_PRIVATE_CREDENTIAL_${Object.keys(bindings).length}`;
    }
  }
  const resolved = await readExistingKernelConfiguration(
    options.kernelDataRoot,
    options.kernelBinaryDir,
    settings,
    bindings,
  );
  return { launch: { ...resolved.launch }, credentials };
}
