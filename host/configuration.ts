import { join, isAbsolute } from 'node:path';
import type { WorkspaceRegistration } from './workspace-service.js';
import { rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readPrivate, writePrivate } from './private.js';
import type { Options } from './runtime.js';
import { parseHarnesses } from './harnesses.js';
import { runtimeIdentity } from './runtime-identity.js';

const STRING_KEYS = [
  'agentkitSource',
  'agentkitBinary',
  'kernelBinaryDir',
  'webRoot',
  'settings',
  'kernelDataRoot',
  'workspace',
  'credentialEnv',
  'piRegistry',
  'piRuntime',
  'dshURL',
  'dshCookieEnv',
] as const;
/** Private host grants are loaded only from saved service configuration. */
function workspaceConfiguration(value: unknown): Options['workspaceService'] {
  if (value === undefined) return undefined;
  const record = (
    input: unknown,
    keys: readonly string[],
  ): Record<string, unknown> => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !keys.includes(key))
    )
      throw new Error('Invalid saved workspace service configuration');
    return input as Record<string, unknown>;
  };
  const config = record(value, ['workspaces']);
  if (!Array.isArray(config.workspaces))
    throw new Error('Invalid saved workspace registrations');
  const seen = new Set<string>();
  const workspaces = config.workspaces.map((input): WorkspaceRegistration => {
    const row = record(input, [
      'id',
      'title',
      'root',
      'allowRead',
      'allowFileWrites',
      'git',
    ]);
    if (
      typeof row.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(row.id) ||
      seen.has(row.id) ||
      typeof row.root !== 'string' ||
      !isAbsolute(row.root) ||
      (row.title !== undefined &&
        (typeof row.title !== 'string' || !row.title.trim())) ||
      ['allowRead', 'allowFileWrites'].some(
        (key) => row[key] !== undefined && typeof row[key] !== 'boolean',
      )
    )
      throw new Error('Invalid saved workspace registration');
    seen.add(row.id);
    let git: WorkspaceRegistration['git'];
    if (row.git !== undefined) {
      const grant = record(row.git, ['operations', 'repositories']);
      const operations = ['commit', 'push', 'branch.create', 'branch.switch'];
      if (
        !Array.isArray(grant.operations) ||
        !Array.isArray(grant.repositories) ||
        grant.operations.some(
          (op) => typeof op !== 'string' || !operations.includes(op),
        ) ||
        new Set(grant.operations).size !== grant.operations.length ||
        grant.repositories.some(
          (path) =>
            typeof path !== 'string' ||
            !path ||
            isAbsolute(path) ||
            path.split('/').includes('..'),
        ) ||
        new Set(grant.repositories).size !== grant.repositories.length
      )
        throw new Error('Invalid saved workspace Git grants');
      git = {
        operations: [...grant.operations] as NonNullable<
          WorkspaceRegistration['git']
        >['operations'],
        repositories: [...grant.repositories] as string[],
      };
    }
    return {
      id: row.id,
      root: row.root,
      ...(row.title !== undefined ? { title: row.title as string } : {}),
      ...(row.allowRead !== undefined
        ? { allowRead: row.allowRead as boolean }
        : {}),
      ...(row.allowFileWrites !== undefined
        ? { allowFileWrites: row.allowFileWrites as boolean }
        : {}),
      ...(git !== undefined ? { git } : {}),
    };
  });
  return { workspaces };
}
function sanitized(root: string, options: Options): Options {
  const values = Object.fromEntries(
    STRING_KEYS.map((key) => {
      const value =
        key === 'agentkitSource' ? (options[key] ?? '') : options[key];
      if (typeof value !== 'string')
        throw new Error('Invalid saved service option: ' + key);
      return [key, value];
    }),
  );
  return {
    ...values,
    port: options.port,
    ...(options.workspaceService !== undefined
      ? { workspaceService: workspaceConfiguration(options.workspaceService) }
      : {}),
    ...(options.runtimeIdentity !== undefined
      ? { runtimeIdentity: runtimeIdentity(options.runtimeIdentity) }
      : {}),
    ...(options.harnesses !== undefined
      ? { harnesses: parseHarnesses(options.harnesses) }
      : {}),
    ...(options.inPlace === true ? { inPlace: true } : {}),
    ...(options.kernelConfigurationMode
      ? { kernelConfigurationMode: options.kernelConfigurationMode }
      : {}),
    runtimeDir: root,
  } as unknown as Options;
}

/** References existing runtime files; never downloads, installs or copies them. */
export async function configuration(root: string): Promise<Options> {
  for (const name of ['service-options.json', 'start-options.json']) {
    try {
      const options = JSON.parse(
        await readPrivate(join(root, name)),
      ) as Options;
      for (const key of [
        'agentkitBinary',
        'kernelBinaryDir',
        'webRoot',
        'settings',
        'kernelDataRoot',
        'workspace',
      ] as const) {
        if (typeof options[key] !== 'string' || !isAbsolute(options[key]))
          throw new Error('Invalid saved service path: ' + key);
      }
      if (
        !Number.isInteger(options.port) ||
        options.port < 0 ||
        options.port > 65535
      )
        throw new Error('Invalid saved service port');
      return sanitized(root, options);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(
    'No existing service configuration found. Configure the low-level host once; daily commands then reuse it automatically.',
  );
}
export async function saveConfiguration(
  root: string,
  options: Options,
): Promise<void> {
  const file = join(
    root,
    'service-options-' + randomBytes(6).toString('hex') + '.json',
  );
  await writePrivate(file, JSON.stringify(sanitized(root, options), null, 2));
  await rename(file, join(root, 'service-options.json'));
}
