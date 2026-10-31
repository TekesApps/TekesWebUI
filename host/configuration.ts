import { join, isAbsolute } from 'node:path';
import { rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readPrivate, writePrivate } from './private.js';
import type { Options } from './runtime.js';
import { parseHarnesses } from './harnesses.js';

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
