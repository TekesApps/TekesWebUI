import { spawn, type ChildProcess } from 'node:child_process';
import { open, mkdir, rm, realpath, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { Bridge, type Wire } from './bridge.js';
import { DirectoryAuthority } from './directory.js';
import { createHostServer } from './http.js';
import {
  cleanEnvironment,
  delay,
  alive,
  jsonFile,
  writePrivate,
  LIMIT,
  openPrivateAppend,
} from './private.js';
import { KERNEL_PIN } from './config.js';

export interface Options {
  runtimeDir: string;
  agentkitSource: string;
  agentkitBinary: string;
  webRoot: string;
  kernelBinaryDir: string;
  kernelDataRoot: string;
  workspace: string;
  settings: string;
  credentialEnv: string;
  port: number;
  piRegistry: string;
  piRuntime: string;
  dshURL: string;
  dshCookieEnv: string;
  inPlace?: boolean;
  kernelConfigurationMode?: 'auto' | 'provided' | 'existing';
}
export interface Frame {
  instance: string;
  browserToken: string;
  appToken: string;
  sessionURLScheme: string;
  kernelLaunch: Wire;
  kernelBootstrap: {
    endpointToken: string;
    credentials: Record<string, string>;
  };
  endpoints: Wire[];
}
export interface Endpoint {
  id: string;
  kind: string;
  name: string;
  connection: string;
  capabilities: unknown;
}
export interface Ready {
  url: string;
  instance: string;
  pid: number;
  kernelPid?: number;
  agentkitPid?: number;
  kernelVersion: string;
  hostVersion: string;
  runtimeDirectory: string;
  workspace: string;
}
export async function active(root: string): Promise<boolean> {
  const ready = await jsonFile<Ready>(join(root, 'ready.json')).catch(
    () => undefined,
  );
  if (ready && alive(ready.pid)) return true;
  const lock = await jsonFile<{ pid: number }>(
    join(root, 'host.lock.d/owner.json'),
  ).catch(() => undefined);
  return !!lock && alive(lock.pid);
}
async function acquire(root: string): Promise<() => Promise<void>> {
  const path = join(root, 'host.lock.d');
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await jsonFile<{ pid: number }>(
      join(path, 'owner.json'),
    ).catch(() => undefined);
    if (!owner || alive(owner.pid))
      throw new Error('Host is already starting or running');
    await rm(path, { recursive: true });
    await mkdir(path, { mode: 0o700 });
  }
  try {
    await writePrivate(
      join(path, 'owner.json'),
      JSON.stringify({ pid: process.pid }),
    );
  } catch (error) {
    await rm(path, { recursive: true });
    throw error;
  }
  return () => rm(path, { recursive: true });
}
async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  for (
    let i = 0;
    i < 75 && child.exitCode === null && child.signalCode === null;
    i++
  )
    await delay(200);
  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGTERM');
  for (
    let i = 0;
    i < 25 && child.exitCode === null && child.signalCode === null;
    i++
  )
    await delay(200);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}
function readiness(
  child: ChildProcess,
): Promise<{ protocolVersion: number; url: string }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const finish = (error?: Error, line?: Buffer) => {
      clearTimeout(timer);
      child.stdout?.off('data', receive);
      child.off('exit', exit);
      child.off('error', failure);
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(line!.toString()));
        } catch {
          reject(new Error('Invalid Kernel readiness frame'));
        }
      }
    };
    const receive = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 65536) {
        finish(new Error('Kernel readiness frame too large'));
        return;
      }
      const end = buffer.indexOf(10);
      if (end >= 0) finish(undefined, buffer.subarray(0, end));
    };
    const exit = () => finish(new Error('Kernel exited before readiness'));
    const failure = () => finish(new Error('Unable to start Kernel'));
    const timer = setTimeout(
      () => finish(new Error('Kernel readiness timeout')),
      40000,
    );
    child.stdout!.on('data', receive);
    child.once('exit', exit);
    child.once('error', failure);
  });
}
export async function serve(
  options: Options,
  frame: Frame,
  hostVersion: string,
): Promise<void> {
  const root = options.runtimeDir;
  const release = await acquire(root);
  let kernel: ChildProcess | undefined, bridge: Bridge | undefined;
  let server: ReturnType<typeof createHostServer> | undefined;
  let directories: DirectoryAuthority | undefined;
  let stopping = false;
  let terminationReason = 'startup-failure';
  const stop = () => {
    stopping = true;
    terminationReason = 'host-signal';
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const log = await openPrivateAppend(join(root, 'service.log')).catch(
    async (error) => {
      await release();
      throw error;
    },
  );
  try {
    await rm(join(root, 'stop'), { force: true });
    await rm(join(root, 'ready.json'), { force: true });
    await writePrivate(
      join(root, 'kernel-launch.json'),
      JSON.stringify(frame.kernelLaunch),
    );
    kernel = spawn(
      join(options.kernelBinaryDir, 'tekes-supervisor'),
      ['--built-in', join(root, 'kernel-launch.json')],
      {
        env: cleanEnvironment(),
        stdio: ['pipe', 'pipe', log.fd],
      },
    );
    const readyPromise = readiness(kernel);
    kernel.stdin!.on('error', () => {});
    const bootstrap = Buffer.from(JSON.stringify(frame.kernelBootstrap));
    if (bootstrap.length > LIMIT) throw new Error('Bootstrap size limit');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bootstrap.length);
    kernel.stdin!.write(
      Buffer.concat([
        Buffer.from('TEKES-KERNEL-BOOTSTRAP/1\n'),
        length,
        bootstrap,
      ]),
    );
    const ready = await readyPromise;
    if (ready.protocolVersion !== 4)
      throw new Error('Expected published Kernel protocol 4');
    const endpoints: Wire[] = [
      {
        id: 'tekes-loopback-default',
        kind: 'tekes',
        name: 'TekesKernel',
        url: ready.url,
        bearer: Buffer.from(
          frame.kernelBootstrap.endpointToken,
          'hex',
        ).toString('base64url'),
      },
      ...frame.endpoints,
    ];
    bridge = new Bridge(
      options.agentkitBinary,
      {
        endpoints,
        sessionURLScheme: frame.sessionURLScheme,
        threadPreferences: {
          path: join(root, 'thread-preferences.json'),
          scope: options.workspace,
        },
      },
      log.fd,
    );
    const runtime = bridge;
    // Credentials are only in private pipes; never write the launch frame to disk.
    frame.kernelBootstrap.credentials = {};
    frame.endpoints = [];
    const deadline = Date.now() + 45000;
    const descriptions = async () =>
      (await runtime.request({ op: 'endpoints' }, 3000)) as Endpoint[];
    async function waitReady(id: string): Promise<Endpoint[]> {
      while (!stopping && Date.now() < deadline) {
        const rows = await descriptions();
        if (rows.some((e) => e.id === id && e.connection === 'ready'))
          return rows;
        await delay(200);
      }
      throw new Error('AgentKit endpoint connection readiness timeout');
    }
    const rows = await waitReady('tekes-loopback-default');
    const pi = rows.find((e) => e.kind === 'pi');
    if (pi && options.piRegistry) {
      await waitReady(pi.id);
      const registry = await jsonFile<{
        sessions: { id: string; cwd: string }[];
      }>(options.piRegistry);
      for (const row of registry.sessions) {
        if (!/^[a-zA-Z0-9_-]+$/.test(row.id))
          throw new Error('Invalid Pi registry session ID');
        const path = join(
          dirname(options.piRegistry),
          'sessions',
          row.id + '.jsonl',
        );
        try {
          await readFile(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        await runtime.request({
          op: 'call',
          endpoint: pi.id,
          method: 'session.adopt',
          rpcId: randomBytes(16).toString('hex'),
          payload: { sessionId: row.id, cwd: row.cwd, sessionFile: path },
        });
      }
    }
    const local = rows
      .filter(
        (e) =>
          ['tekes', 'pi'].includes(e.kind) ||
          (e.kind === 'dsh' &&
            ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
              new URL(options.dshURL).hostname,
            )),
      )
      .map((e) => e.id);
    directories = await DirectoryAuthority.create(
      process.platform === 'darwin' ? local : [],
      options.workspace,
    );
    const assets = await realpath(options.webRoot);
    server = createHostServer({
      assets,
      workspace: options.workspace,
      kernelVersion: KERNEL_PIN.version,
      hostVersion,
      browserToken: frame.browserToken,
      appToken: frame.appToken,
      dshURL: options.dshURL,
      directories,
      bridge: runtime,
      attachDSH: async (cookie) => {
        const value = await runtime.request({
          op: 'configureDSH',
          endpoint: 'dsh-loopback-default',
          url: options.dshURL,
          cookie,
        });
        await writePrivate(
          join(root, 'dsh-connection.json'),
          JSON.stringify({ url: options.dshURL, cookie }),
        );
        return value;
      },
    });
    server.listen(options.port, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Invalid HTTP address');
    const url = `http://127.0.0.1:${address.port}`;
    await writePrivate(
      join(root, 'app-connection.json'),
      JSON.stringify({
        format: 1,
        url,
        bearer: frame.appToken,
        workspace: options.workspace,
        endpoints: rows.map(({ id, kind, name, capabilities }) => ({
          id,
          kind,
          name,
          capabilities,
        })),
      }),
    );
    await writePrivate(
      join(root, 'open-browser.html'),
      '<!doctype html><meta name=referrer content=no-referrer><script>location.replace(' +
        JSON.stringify(`${url}/#${frame.browserToken}`) +
        ')</script>',
    );
    const descriptor: Ready = {
      url,
      instance: frame.instance,
      pid: process.pid,
      kernelPid: kernel.pid,
      agentkitPid: runtime.process.pid,
      kernelVersion: KERNEL_PIN.version,
      hostVersion,
      runtimeDirectory: root,
      workspace: options.workspace,
    };
    await writePrivate(
      join(root, 'ready.json'),
      JSON.stringify(descriptor, null, 2),
    );
    terminationReason = 'service-stopping';
    while (
      !stopping &&
      kernel.exitCode === null &&
      kernel.signalCode === null &&
      runtime.process.exitCode === null &&
      runtime.process.signalCode === null
    ) {
      if (
        await readFile(join(root, 'stop')).then(
          () => true,
          () => false,
        )
      ) {
        terminationReason = 'stop-file';
        break;
      }
      await delay(200);
    }
    if (terminationReason === 'service-stopping') {
      terminationReason =
        kernel.exitCode !== null || kernel.signalCode !== null
          ? 'kernel-exit'
          : 'agentkit-exit';
    }
  } catch (error) {
    terminationReason = 'startup-error';
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'unclassified';
    await log.write(
      `service-terminated reason=${terminationReason} category=${code}\n`,
    );
    throw error;
  } finally {
    await log.write(
      `service-terminated reason=${terminationReason} kernelCode=${kernel?.exitCode ?? 'null'} kernelSignal=${kernel?.signalCode ?? 'null'} agentkitCode=${bridge?.process.exitCode ?? 'null'} agentkitSignal=${bridge?.process.signalCode ?? 'null'}\n`,
    );
    directories?.close();
    server?.close();
    server?.closeAllConnections();
    for (const name of [
      'ready.json',
      'open-browser.html',
      'app-connection.json',
    ])
      await rm(join(root, name), { force: true });
    bridge?.close();
    await stopChild(bridge?.process);
    await stopChild(kernel);
    await log.close();
    await release();
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
