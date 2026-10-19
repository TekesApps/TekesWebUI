import { parseArgs } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  DEFAULT_ROOT,
  privateRoot,
  jsonFile,
  readPrivate,
  writePrivate,
} from './private.js';
import { active, type Options, type Ready } from './runtime.js';
import { kernelProjection, exec, type Settings } from './config.js';
import { readCredential, saveCredential } from './credentials.js';
import { question, secretQuestion } from './prompts.js';
import {
  installation,
  installBundle,
  publishedBundle,
  latestVersion,
  saveInstallation,
  releaseOptions,
  verifyRelease,
  type Installation,
} from './install.js';

const PROJECT = resolve(dirname(process.argv[1]), '..');
const SUPPORT = join(homedir(), 'Library/Application Support/Tekes');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'runtime-dir': { type: 'string', default: DEFAULT_ROOT },
    'no-open': { type: 'boolean', default: false },
  },
});
async function runCLI(
  state: Installation,
  root: string,
  command: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(state.current.directory, 'dist-host/cli.js'),
        command,
        '--runtime-dir',
        root,
      ],
      { stdio: 'inherit', env: process.env },
    );
    child.on('error', () =>
      reject(new Error('Unable to run the installed service')),
    );
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Service ${command} failed; prior release remains available`,
            ),
          ),
    );
  });
}
export async function assertIdle(root: string): Promise<void> {
  const ready = await jsonFile<Ready>(join(root, 'ready.json'));
  const descriptor = JSON.parse(
    await readPrivate(join(root, 'app-connection.json')),
  ) as { bearer: string };
  const api = async (request: Record<string, unknown>) => {
    const response = await fetch(ready.url + '/api', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + descriptor.bearer,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as { error?: string; value: unknown };
    if (!response.ok || body.error)
      throw new Error(
        'Unable to confirm that the service is idle; update deferred',
      );
    return body.value;
  };
  const endpoints = (await api({ op: 'endpoints' })) as {
    id: string;
    connection: string;
  }[];
  for (const endpoint of endpoints) {
    if (endpoint.connection !== 'ready')
      throw new Error(
        'A Harness is disconnected; update deferred until its state can be checked',
      );
    const snapshot = (await api({ op: 'snapshot', endpoint: endpoint.id })) as {
      control_ready: boolean;
      inventory_ready: boolean;
      sessions: Record<string, { run_open: boolean; queue: unknown[] }>;
    };
    if (
      !snapshot.control_ready ||
      !snapshot.inventory_ready ||
      Object.values(snapshot.sessions).some((s) => s.run_open || s.queue.length)
    )
      throw new Error(
        'Running or queued work exists; update installed but activation deferred. Finish work, then rerun npm run update.',
      );
  }
}
export async function activate(
  root: string,
  next: Installation,
  previous: Installation | undefined,
  running: boolean,
  runner: (state: Installation, command: string) => Promise<void>,
  save = saveInstallation,
): Promise<void> {
  if (running && previous) await runner(previous, 'stop');
  try {
    await save(root, next);
    if (running) await runner(next, 'start');
  } catch (error) {
    if (running) await runner(next, 'stop').catch(() => {});
    if (previous) {
      await save(root, previous);
      if (running) await runner(previous, 'start');
    }
    throw error;
  }
}
async function configuration(
  root: string,
  previous?: Installation,
): Promise<Options> {
  const legacy = await jsonFile<Partial<Options>>(
    join(root, 'start-options.json'),
  ).catch(() => ({}));
  const defaults: Options = {
    runtimeDir: root,
    agentkitSource: '',
    agentkitBinary: '',
    kernelBinaryDir: '',
    webRoot: '',
    kernelDataRoot: join(SUPPORT, 'BuiltIn/kernel-0.9'),
    workspace: join(homedir(), 'Documents/TekesKernel-Web-Workspace'),
    settings: join(SUPPORT, 'Settings/providers-and-routers.json'),
    credentialEnv: 'DEEPSEEK_KEY',
    port: 65150,
    piRegistry: join(homedir(), '.agents/harness/pi-stdio-rpc/registry.json'),
    piRuntime: join(SUPPORT, 'Harnesses/pi-1.3.0-node-24.20.0'),
    dshURL: 'http://127.0.0.1:3181',
    dshCookieEnv: 'TEKES_DSH_COOKIE',
  };
  const source: Partial<Options> = previous?.options ?? legacy;
  for (const key of [
    'kernelDataRoot',
    'workspace',
    'settings',
    'credentialEnv',
    'piRegistry',
    'piRuntime',
    'dshURL',
    'dshCookieEnv',
  ] as const) {
    if (typeof source[key] === 'string') defaults[key] = source[key];
  }
  if (
    Number.isInteger(source.port) &&
    source.port! >= 0 &&
    source.port! <= 65535
  )
    defaults.port = source.port!;
  let settings: Settings;
  try {
    settings = await jsonFile<Settings>(defaults.settings);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const baseURL = await question('DeepSeek Responses endpoint URL: ');
    const url = new URL(baseURL);
    if (url.protocol !== 'https:')
      throw new Error('Use an HTTPS provider endpoint');
    const models = (await question('Configured model IDs (comma-separated): '))
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!models.length) throw new Error('At least one model is required');
    settings = {
      providers: [
        {
          id: 'web-deepseek',
          name: 'DeepSeek',
          providerID: 'deepseek',
          connectionMode: 'direct',
          api: 'deepseek-responses',
          baseURL,
          models: models.map((id) => ({ id })),
        },
      ],
      agentSelections: {
        tekes: { providerIDs: ['web-deepseek'] },
        pi: { providerIDs: ['web-deepseek'] },
      },
    };
    defaults.settings = join(root, 'providers.json');
    await writePrivate(defaults.settings, JSON.stringify(settings));
  }
  const { provider } = kernelProjection(
    settings,
    defaults.kernelDataRoot,
    '/installed/kernel',
  );
  let secret =
    process.env[defaults.credentialEnv]?.trim() ||
    (await readCredential(provider.id));
  if (!secret)
    secret = await secretQuestion(
      'Provider API key (hidden; saved in macOS Keychain): ',
    );
  if (!secret) throw new Error('Provider API key is required');
  await saveCredential(provider.id, secret);
  // Pi is optional. Its runtime is not downloaded or installed by this project.
  if (
    !(await access(join(defaults.piRuntime, 'node/bin/node')).then(
      () => true,
      () => false,
    ))
  ) {
    defaults.piRegistry = '';
    console.log(
      'Pi runtime is not installed; Kernel remains available. DSH connects to an existing service.',
    );
  }
  return defaults;
}
async function main(): Promise<void> {
  const command = positionals[0] ?? 'start';
  if (!['setup', 'start', 'stop', 'status', 'open', 'update'].includes(command))
    throw new Error('Use setup, start, stop, status, open or update');
  const root = await privateRoot(values['runtime-dir']);
  let state = await installation(root);
  if (['setup', 'update'].includes(command)) {
    const version =
      command === 'update'
        ? await latestVersion()
        : (await jsonFile<{ version: string }>(join(PROJECT, 'package.json')))
            .version;
    let release =
      state?.current.version === version ? state.current : undefined;
    if (release) await verifyRelease(release);
    else {
      console.log(`Downloading and verifying TekesWebUI v${version}…`);
      const { manifest, archive } = await publishedBundle(
        version,
        `${process.platform}-${process.arch}`,
      );
      release = await installBundle(root, manifest, archive);
    }
    if (
      command === 'update' &&
      state?.current.version === release.version &&
      state.current.manifestHash === release.manifestHash
    ) {
      console.log(`Already on TekesWebUI v${release.version}.`);
      return;
    }
    const options =
      command === 'setup' || !state
        ? await configuration(root, state)
        : state.options;
    const next: Installation = {
      format: 1,
      current: release,
      previous: state?.current,
      options: releaseOptions(root, release, options),
    };
    const running = await active(root);
    if (command === 'update' && running && state) await assertIdle(root);
    await activate(
      root,
      next,
      state,
      command === 'update' && running && !!state,
      (s, c) => runCLI(s, root, c),
    );
    console.log(`TekesWebUI v${release.version} installed. Run npm start.`);
    return;
  }
  if (!state) {
    if (['status', 'stop', 'open'].includes(command)) {
      // Existing pre-setup service remains controllable during migration.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [join(PROJECT, 'dist-host/cli.js'), command, '--runtime-dir', root],
          { stdio: 'inherit' },
        );
        child.on('error', reject);
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error('Service command failed')),
        );
      });
      return;
    }
    throw new Error('First run: npm run setup');
  }
  if (command === 'start' && !(await active(root))) {
    await verifyRelease(state.current);
    await runCLI(state, root, 'start');
  } else if (command !== 'start') {
    await runCLI(state, root, command);
    return;
  }
  if (!values['no-open']) await runCLI(state, root, 'open');
}
if (process.argv[1]?.endsWith('manage.cjs'))
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Local service command failed',
    );
    process.exitCode = 1;
  });
