#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import {
  readFile,
  realpath,
  mkdir,
  copyFile,
  chmod,
  open,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  privateRoot,
  writePrivate,
  readPrivate,
  jsonFile,
  cleanEnvironment,
  delay,
  DEFAULT_ROOT,
  LIMIT,
  openPrivateAppend,
} from './private.js';
import {
  kernelProjection,
  verifyKernel,
  selected,
  sha256,
  exec,
  type Settings,
} from './config.js';
import {
  active,
  serve,
  type Options,
  type Frame,
  type Ready,
} from './runtime.js';

import { providerCredential } from './credentials.js';

const CLI = fileURLToPath(import.meta.url);
const PROJECT = resolve(dirname(CLI), '..');
const SUPPORT = join(homedir(), 'Library/Application Support/Tekes');
const version = (
  await jsonFile<{ version: string }>(join(PROJECT, 'package.json'))
).version;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'runtime-dir': { type: 'string', default: DEFAULT_ROOT },
    'agentkit-source': { type: 'string' },
    'agentkit-binary': { type: 'string' },
    'web-root': { type: 'string', default: join(PROJECT, 'dist') },
    'kernel-binary-dir': { type: 'string' },
    'kernel-data-root': {
      type: 'string',
      default: join(SUPPORT, 'BuiltIn/kernel-0.9'),
    },
    workspace: {
      type: 'string',
      default: join(homedir(), 'Documents/TekesKernel-Web-Workspace'),
    },
    settings: {
      type: 'string',
      default: join(SUPPORT, 'Settings/providers-and-routers.json'),
    },
    'credential-env': { type: 'string', default: 'DEEPSEEK_KEY' },
    port: { type: 'string', default: '0' },
    'pi-registry': {
      type: 'string',
      default: join(homedir(), '.agents/harness/pi-stdio-rpc/registry.json'),
    },
    'pi-runtime': {
      type: 'string',
      default: join(SUPPORT, 'Harnesses/pi-1.3.0-node-24.20.0'),
    },
    'dsh-url': { type: 'string', default: 'http://127.0.0.1:3181' },
    'dsh-cookie-env': { type: 'string', default: 'TEKES_DSH_COOKIE' },
    help: { type: 'boolean', short: 'h' },
  },
});
async function start(options: Options): Promise<void> {
  const root = options.runtimeDir;
  if (await active(root))
    throw new Error('Host is already running; use status or open');
  if (!options.agentkitBinary || !options.kernelBinaryDir)
    throw new Error(
      'Run npm run setup first, or supply --agentkit-binary and --kernel-binary-dir',
    );
  options.webRoot = await realpath(options.webRoot);
  await readFile(join(options.webRoot, 'index.html'));
  options.agentkitSource = await realpath(
    options.agentkitSource || dirname(options.agentkitBinary),
  );
  options.agentkitBinary = await realpath(options.agentkitBinary);
  options.kernelBinaryDir = await realpath(options.kernelBinaryDir);
  await verifyKernel(options.kernelBinaryDir);
  const digest = sha256(await readFile(options.agentkitBinary));
  const installed = join(
    await privateRoot(join(root, 'bin')),
    'agentkit-' + digest,
  );
  try {
    await copyFile(options.agentkitBinary, installed, constants.COPYFILE_EXCL);
    await chmod(installed, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (sha256(await readFile(installed)) !== digest)
    throw new Error('Frozen AgentKit binary hash mismatch');
  options.agentkitBinary = installed;
  await mkdir(options.workspace, { recursive: true });
  options.workspace = await realpath(options.workspace);
  const settings = await jsonFile<Settings>(options.settings);
  const { provider, launch } = kernelProjection(
    settings,
    options.kernelDataRoot,
    options.kernelBinaryDir,
  );
  const credential = await providerCredential(
    options.credentialEnv,
    provider.id,
  );
  const endpoints: Frame['endpoints'] = [];
  const registry = await readFile(options.piRegistry).then(
    () => true,
    (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    },
  );
  if (registry) {
    const node = join(options.piRuntime, 'node/bin/node');
    const cli = join(
      options.piRuntime,
      'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js',
    );
    await realpath(node);
    await realpath(cli);
    const enabled = selected(settings.agentSelections?.pi);
    if (enabled.size !== 1 || !enabled.has(provider.id))
      throw new Error(
        'Pi must select the same real DeepSeek connection as Kernel',
      );
    endpoints.push({
      id: 'pi:' + dirname(options.piRegistry),
      kind: 'pi',
      name: 'Pi',
      executable: node,
      arguments: [cli],
      dataRoot: dirname(options.piRegistry),
      sessionRoots: [join(dirname(options.piRegistry), 'sessions')],
      extensions: [join(dirname(CLI), 'pi-models.js')],
      environment: {
        TEKES_AGENT_WEB_PI_KEY: credential,
        TEKES_AGENT_WEB_PI_PROVIDERS: JSON.stringify([
          {
            id: provider.id,
            name: provider.name,
            vendor: provider.vendorID ?? provider.providerID,
            api: provider.api,
            baseURL: provider.baseURL,
            models: provider.models.filter((model) => model.enabled !== false),
          },
        ]),
      },
    });
  } else options.piRegistry = '';
  let cookie = process.env[options.dshCookieEnv];
  if (!cookie) {
    try {
      const saved = JSON.parse(
        await readPrivate(join(root, 'dsh-connection.json')),
      ) as { url: string; cookie: string };
      if (saved.url === options.dshURL) cookie = saved.cookie;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  endpoints.push({
    id: 'dsh-loopback-default',
    kind: 'dsh',
    name: 'DeepSeek Harness',
    url: options.dshURL,
    ...(cookie ? { cookie } : {}),
  });
  const frame: Frame = {
    instance: randomBytes(16).toString('hex'),
    sessionURLScheme: 'tekes',
    browserToken: randomBytes(32).toString('base64url'),
    appToken: randomBytes(32).toString('base64url'),
    kernelLaunch: launch,
    kernelBootstrap: {
      endpointToken: randomBytes(32).toString('hex'),
      credentials: { [provider.id]: credential },
    },
    endpoints,
  };
  const log = await openPrivateAppend(join(root, 'host.log'));
  const child = spawn(
    process.execPath,
    [CLI, '_serve', '--runtime-dir', root],
    {
      detached: true,
      env: cleanEnvironment(),
      stdio: ['pipe', log.fd, log.fd],
    },
  );
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  child.stdin!.on('error', () => {});
  child.stdin!.end(JSON.stringify({ options, frame }));
  child.unref();
  await log.close();
  const deadline = Date.now() + 95000;
  while (Date.now() < deadline) {
    if (failed || child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        'Background host failed; inspect private host.log/service.log',
      );
    const ready = await jsonFile<Ready>(join(root, 'ready.json')).catch(
      () => undefined,
    );
    if (ready?.instance === frame.instance) {
      await writePrivate(
        join(root, 'start-options.json'),
        JSON.stringify(options),
      );
      console.log(JSON.stringify(ready));
      return;
    }
    await delay(200);
  }
  child.kill('SIGTERM');
  throw new Error('Background host readiness timeout');
}
async function main(): Promise<void> {
  const command = positionals[0];
  if (values.help || !command) {
    console.log(
      'TekesWebUI: npm run setup; npm start; npm stop; npm run status; npm run open; npm run update\nDevelopment CLI: start --agentkit-binary PATH --kernel-binary-dir PATH [--port 65150]\nSee docs/local-service.md for configuration.',
    );
    return;
  }
  const root = await privateRoot(values['runtime-dir']);
  if (command === 'status') {
    console.log(
      JSON.stringify(
        (await active(root))
          ? await jsonFile(join(root, 'ready.json'))
          : { running: false },
      ),
    );
    return;
  }
  if (command === 'open') {
    if (!(await active(root))) throw new Error('Host is not ready; use start');
    if (process.platform !== 'darwin')
      throw new Error('Automatic browser opening currently requires macOS');
    await exec('/usr/bin/open', [join(root, 'open-browser.html')], {
      env: cleanEnvironment(),
    });
    return;
  }
  if (command === 'stop') {
    if (await active(root)) {
      await writePrivate(join(root, 'stop'), 'stop\n');
      const deadline = Date.now() + 45000;
      while ((await active(root)) && Date.now() < deadline) await delay(200);
      if (await active(root))
        throw new Error('Host stop timeout; inspect private logs');
    }
    console.log(JSON.stringify({ running: false }));
    return;
  }
  if (command === '_serve') {
    let content = Buffer.alloc(0);
    for await (const data of process.stdin) {
      content = Buffer.concat([content, Buffer.from(data)]);
      if (content.length > LIMIT)
        throw new Error('Private startup frame size limit');
    }
    const { options, frame } = JSON.parse(content.toString()) as {
      options: Options;
      frame: Frame;
    };
    if (resolve(options.runtimeDir) !== root)
      throw new Error('Startup runtime directory mismatch');
    await serve(options, frame, version);
    return;
  }
  if (command !== 'start')
    throw new Error('Unknown command; use start, status, open or stop');
  if (!values['agentkit-binary'] && !values['kernel-binary-dir']) {
    const saved = JSON.parse(
      await readPrivate(join(root, 'installation.json')),
    ) as { format: number; options: Options };
    if (saved.format !== 1)
      throw new Error('Run npm run setup to configure this installation');
    await start({ ...saved.options, runtimeDir: root });
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid loopback port');
  await start({
    runtimeDir: root,
    agentkitSource: values['agentkit-source'] ?? '',
    agentkitBinary: values['agentkit-binary'] ?? '',
    webRoot: values['web-root'],
    kernelBinaryDir: values['kernel-binary-dir'] ?? '',
    kernelDataRoot: resolve(values['kernel-data-root']),
    workspace: resolve(values.workspace),
    settings: resolve(values.settings),
    credentialEnv: values['credential-env'],
    port,
    piRegistry: resolve(values['pi-registry']),
    piRuntime: resolve(values['pi-runtime']),
    dshURL: values['dsh-url'],
    dshCookieEnv: values['dsh-cookie-env'],
  });
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local service failed',
  );
  process.exitCode = 1;
});
