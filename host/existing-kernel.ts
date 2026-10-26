import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Settings } from './config.js';

export interface CanonicalModel {
  readonly id: string;
  readonly profile: string;
  readonly enabled: boolean;
  readonly context_window_tokens: number;
  readonly compact_trigger_tokens: number;
  readonly [key: string]: unknown;
}

export interface CanonicalProvider {
  readonly id: string;
  readonly adapter: string;
  readonly dialect: string;
  readonly endpoint: string;
  readonly credential_key?: string;
  readonly models: readonly CanonicalModel[];
  readonly [key: string]: unknown;
}

export interface CanonicalProvidersDocument {
  readonly format: 1;
  readonly revision: number;
  readonly providers: readonly CanonicalProvider[];
  readonly [key: string]: unknown;
}

export interface CanonicalSettingsDocument {
  readonly format: 1;
  readonly revision: number;
  readonly default_provider?: string;
  readonly default_model?: string;
  readonly [key: string]: unknown;
}

export interface ExistingKernelLaunch {
  readonly format: 1;
  readonly bootstrap_version: 1;
  readonly root: string;
  readonly worker: string;
  readonly listen: '127.0.0.1:0';
  readonly configuration_mode: 'existing';
  readonly credential_bindings: Readonly<Record<string, string>>;
}

export interface ExistingKernelConfiguration {
  readonly providers: CanonicalProvidersDocument;
  readonly settings: CanonicalSettingsDocument;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly defaultSelection?: Readonly<{ provider: string; model: string }>;
  readonly credentialRefs: readonly string[];
  readonly launch: ExistingKernelLaunch;
}

const safeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !/[\u0000-\u001f\u007f]/u.test(value);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function safeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function validateProviders(value: unknown): CanonicalProvidersDocument {
  if (
    !object(value) ||
    value.format !== 1 ||
    !safeRevision(value.revision) ||
    !Array.isArray(value.providers)
  ) {
    throw new Error('Invalid existing Kernel providers.json document');
  }
  const providerIds = new Set<string>();
  for (const provider of value.providers) {
    if (
      !object(provider) ||
      !safeId(provider.id) ||
      providerIds.has(provider.id) ||
      !safeId(provider.adapter) ||
      !safeId(provider.dialect) ||
      !safeId(provider.endpoint) ||
      !Array.isArray(provider.models)
    ) {
      throw new Error(
        'Invalid or duplicate provider in existing Kernel configuration',
      );
    }
    providerIds.add(provider.id);
    if (
      provider.credential_key !== undefined &&
      !safeId(provider.credential_key)
    ) {
      throw new Error(
        `Invalid credential reference for provider ${provider.id}`,
      );
    }
    const modelIds = new Set<string>();
    for (const model of provider.models) {
      if (
        !object(model) ||
        !safeId(model.id) ||
        modelIds.has(model.id) ||
        !safeId(model.profile) ||
        typeof model.enabled !== 'boolean' ||
        !Number.isSafeInteger(model.context_window_tokens) ||
        (model.context_window_tokens as number) < 2 ||
        !Number.isSafeInteger(model.compact_trigger_tokens) ||
        (model.compact_trigger_tokens as number) < 1 ||
        (model.compact_trigger_tokens as number) >=
          (model.context_window_tokens as number)
      ) {
        throw new Error(
          `Invalid or duplicate model in provider ${provider.id}`,
        );
      }
      modelIds.add(model.id);
    }
  }
  return value as unknown as CanonicalProvidersDocument;
}

function validateSettings(
  value: unknown,
  providers: CanonicalProvidersDocument,
): CanonicalSettingsDocument {
  if (!object(value) || value.format !== 1 || !safeRevision(value.revision)) {
    throw new Error('Invalid existing Kernel settings.json document');
  }
  const providerId = value.default_provider;
  const modelId = value.default_model;
  if ((providerId === undefined) !== (modelId === undefined)) {
    throw new Error(
      'Incomplete default provider/model in existing Kernel settings.json',
    );
  }
  if (providerId !== undefined) {
    if (!safeId(providerId) || !safeId(modelId)) {
      throw new Error(
        'Invalid default provider/model in existing Kernel settings.json',
      );
    }
    const provider = providers.providers.find(
      (entry) => entry.id === providerId,
    );
    if (
      !provider ||
      !provider.models.some((model) => model.id === modelId && model.enabled)
    ) {
      throw new Error(
        'Default provider/model does not name an enabled configured model',
      );
    }
  }
  return value as unknown as CanonicalSettingsDocument;
}

async function readRegularJson(path: string, label: string): Promise<unknown> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Missing existing Kernel ${label}: ${path}`);
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Existing Kernel ${label} must be a regular file`);
  }
  let bytes: string;
  try {
    bytes = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Unable to read existing Kernel ${label}`);
  }
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`Malformed existing Kernel ${label} JSON`);
  }
}

function validateBindings(
  bindings: Readonly<Record<string, string>>,
  credentialRefs: readonly string[],
): Readonly<Record<string, string>> {
  if (!object(bindings)) throw new Error('Invalid caller credential bindings');
  const refs = new Set(credentialRefs);
  const envNames = new Set<string>();
  const result: Record<string, string> = {};
  for (const [ref, envName] of Object.entries(bindings)) {
    if (!refs.has(ref))
      throw new Error(`Unknown credential binding reference: ${ref}`);
    if (
      typeof envName !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(envName)
    ) {
      throw new Error(`Invalid environment reference for credential ${ref}`);
    }
    if (envNames.has(envName))
      throw new Error('Duplicate environment credential binding');
    envNames.add(envName);
    result[ref] = envName;
  }
  return Object.freeze(result);
}

/**
 * Reads the user's canonical Kernel configuration without modifying it. The
 * legacy WebUI settings argument is deliberately not projected into Kernel;
 * it remains available to the caller for existing credential/roster policy.
 */
export async function readExistingKernelConfiguration(
  canonicalRoot: string,
  binaryDir: string,
  _legacySettings: Settings,
  suppliedCredentialBindings: Readonly<Record<string, string>> = {},
): Promise<ExistingKernelConfiguration> {
  if (!isAbsolute(canonicalRoot) || !isAbsolute(binaryDir)) {
    throw new Error(
      'Existing Kernel root and binary directory must be absolute paths',
    );
  }
  let rootInfo;
  try {
    rootInfo = await lstat(canonicalRoot);
  } catch {
    throw new Error(`Missing existing Kernel root: ${canonicalRoot}`);
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Existing Kernel root must be an existing directory');
  }
  const configDir = join(canonicalRoot, 'config');
  let configInfo;
  try {
    configInfo = await lstat(configDir);
  } catch {
    throw new Error(`Missing existing Kernel config directory: ${configDir}`);
  }
  if (!configInfo.isDirectory() || configInfo.isSymbolicLink()) {
    throw new Error('Existing Kernel config path must be a directory');
  }
  const [providerData, settingsData] = await Promise.all([
    readRegularJson(join(configDir, 'providers.json'), 'providers.json'),
    readRegularJson(join(configDir, 'settings.json'), 'settings.json'),
  ]);
  const providers = validateProviders(providerData);
  const settings = validateSettings(settingsData, providers);
  const credentialRefs = Object.freeze(
    [
      ...new Set(
        providers.providers.flatMap((provider) =>
          provider.credential_key === undefined
            ? []
            : [provider.credential_key],
        ),
      ),
    ].sort(),
  );
  const credentialBindings = validateBindings(
    suppliedCredentialBindings,
    credentialRefs,
  );
  const defaultSelection =
    settings.default_provider && settings.default_model
      ? Object.freeze({
          provider: settings.default_provider,
          model: settings.default_model,
        })
      : undefined;
  return Object.freeze({
    providers: deepFreeze(providers),
    settings: deepFreeze(settings),
    ...(defaultSelection
      ? {
          defaultProvider: defaultSelection.provider,
          defaultModel: defaultSelection.model,
        }
      : {}),
    ...(defaultSelection ? { defaultSelection } : {}),
    credentialRefs,
    launch: Object.freeze({
      format: 1,
      bootstrap_version: 1,
      root: canonicalRoot,
      worker: join(binaryDir, 'tekes-worker'),
      listen: '127.0.0.1:0',
      configuration_mode: 'existing',
      credential_bindings: credentialBindings,
    }),
  });
}
