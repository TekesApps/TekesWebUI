import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { DEFAULT_ROOT, privateRoot, jsonFile } from './private.js';
import { active } from './runtime.js';
import { kernelProjection, verifyKernel, type Settings } from './config.js';
import { readCredential, saveCredential } from './credentials.js';
import { secretQuestion } from './prompts.js';
import { configuration, saveConfiguration } from './configuration.js';

const CLI = fileURLToPath(import.meta.url);
const PROJECT = resolve(dirname(CLI), '..');
async function runCLI(root: string, command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(PROJECT, 'dist-host/cli.js'), command, '--runtime-dir', root],
      { stdio: 'inherit', env: process.env },
    );
    child.on('error', () =>
      reject(new Error('Unable to run the local service')),
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Service ${command} failed`)),
    );
  });
}
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'runtime-dir': { type: 'string', default: DEFAULT_ROOT },
      'no-open': { type: 'boolean', default: false },
    },
  });
  const command = positionals[0] ?? 'start';
  if (!['setup', 'start', 'stop', 'status', 'open'].includes(command))
    throw new Error('Use setup, start, stop, status or open');
  const root = await privateRoot(values['runtime-dir']);
  if (command === 'setup') {
    const options = await configuration(root);
    await verifyKernel(options.kernelBinaryDir);
    await access(options.agentkitBinary);
    await access(join(options.webRoot, 'index.html'));
    const settings = await jsonFile<Settings>(options.settings);
    const { provider } = kernelProjection(
      settings,
      options.kernelDataRoot,
      options.kernelBinaryDir,
    );
    const saved = await readCredential(provider.id);
    const secret =
      process.env[options.credentialEnv]?.trim() ||
      saved ||
      (await secretQuestion(
        'Provider API key (hidden; saved in macOS Keychain): ',
      ));
    if (!secret) throw new Error('Provider API key is required');
    if (secret !== saved) await saveCredential(provider.id, secret);
    await saveConfiguration(root, options);
    console.log(
      'Existing runtime configuration saved. No runtime files were downloaded or copied. Run npm start.',
    );
    return;
  }
  if (command === 'start') {
    if (!(await active(root))) {
      const options = await configuration(root);
      await saveConfiguration(root, options);
      await runCLI(root, 'start');
    }
    if (!values['no-open']) await runCLI(root, 'open');
    return;
  }
  await runCLI(root, command);
}
if (resolve(process.argv[1] ?? '') === CLI)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Local service command failed',
    );
    process.exitCode = 1;
  });
