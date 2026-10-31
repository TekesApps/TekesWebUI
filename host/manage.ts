import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { DEFAULT_ROOT, privateRoot, jsonFile } from './private.js';
import { active } from './runtime.js';
import { verifyKernel, type Settings } from './config.js';
import { setupKernelCredential } from './launch-configuration.js';
import { readCredential, saveCredential } from './credentials.js';
import { secretQuestion } from './prompts.js';
import { configuration, saveConfiguration } from './configuration.js';
import { parseHarnesses } from './harnesses.js';

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
      harnesses: { type: 'string' },
    },
  });
  const command = positionals[0] ?? 'start';
  if (!['setup', 'start', 'stop', 'status', 'open'].includes(command))
    throw new Error('Use setup, start, stop, status or open');
  if (
    values.harnesses !== undefined &&
    command !== 'start' &&
    command !== 'setup'
  )
    throw new Error('--harnesses is only valid for setup or start');
  const harnesses =
    values.harnesses === undefined
      ? undefined
      : parseHarnesses(values.harnesses);
  const root = await privateRoot(values['runtime-dir']);
  if (command === 'setup') {
    const options = {
      ...(await configuration(root)),
      ...(harnesses ? { harnesses } : {}),
    };
    await verifyKernel(options.kernelBinaryDir);
    await access(options.agentkitBinary);
    await access(join(options.webRoot, 'index.html'));
    const settings = await jsonFile<Settings>(options.settings);
    await setupKernelCredential(options, settings, {
      read: readCredential,
      save: saveCredential,
      prompt: secretQuestion,
    });
    await saveConfiguration(root, options);
    console.log(
      'Existing runtime configuration saved. No runtime files were downloaded or copied. Run npm start.',
    );
    return;
  }
  if (command === 'start') {
    if (await active(root)) {
      if (harnesses) {
        const options = await configuration(root);
        if (
          JSON.stringify(parseHarnesses(options.harnesses)) !==
          JSON.stringify(harnesses)
        )
          throw new Error('Stop the service before changing --harnesses');
      }
    } else {
      const options = {
        ...(await configuration(root)),
        ...(harnesses ? { harnesses } : {}),
      };
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
