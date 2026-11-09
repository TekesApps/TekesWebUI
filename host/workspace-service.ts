import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as C } from 'node:fs';
import {
  access,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import type {
  WorkspaceCallRequest,
  WorkspaceCapabilities,
  WorkspaceMethod,
  WorkspaceInventory,
  WorkspaceResult,
} from '@tekesagentkit/client-contract/workspace';
import { cleanEnvironment, privateRoot, readPrivate } from './private.js';

export type GitWorkspaceOperation =
  'commit' | 'push' | 'branch.create' | 'branch.switch';
/** Private host configuration. This structure is never accepted from a browser. */
export interface WorkspaceRegistration {
  id: string;
  title?: string;
  root: string;
  allowRead?: boolean;
  allowFileWrites?: boolean;
  git?: { operations: GitWorkspaceOperation[]; repositories: string[] };
}
export interface WorkspaceServiceOptions {
  helper: { path: string; sha256: string };
  stateRoot: string;
  connectionId?: string;
  workspaces: WorkspaceRegistration[];
  timeoutMs?: number;
}
type Wire = Record<string, unknown>;
type Reply = WorkspaceResult<unknown>;
interface RegisteredWorkspace {
  id: string;
  title: string;
  root: string;
  methods: WorkspaceMethod[];
  gitOperations: GitWorkspaceOperation[];
  authorityFile: string;
}
const reads: WorkspaceMethod[] = [
  'filesList',
  'filesSearch',
  'filesRead',
  'gitRepository',
  'gitChangesNavigator',
  'gitStatus',
  'gitBranches',
  'gitDiff',
  'gitLog',
];
const mutations = new Set([
  'filesWrite',
  'gitCommit',
  'gitPush',
  'gitChangeBranch',
]);
const gitOperations = new Set([
  'commit',
  'push',
  'branch.create',
  'branch.switch',
]);
const fields: Record<string, string[]> = {
  capabilities: [],
  filesList: ['path', 'limit'],
  filesSearch: ['query', 'limit'],
  filesRead: ['path', 'maxBytes'],
  filesWrite: ['path', 'content', 'expectedRevision'],
  gitRepository: ['repositoryPath'],
  gitChangesNavigator: ['includeClean'],
  gitStatus: ['repositoryPath'],
  gitBranches: ['repositoryPath'],
  gitDiff: ['repositoryPath', 'scope', 'revision', 'paths'],
  gitLog: ['repositoryPath', 'limit', 'offset', 'head'],
  gitCommit: ['repositoryPath', 'message', 'paths'],
  gitPush: ['repositoryPath', 'remote'],
  gitChangeBranch: ['repositoryPath', 'operation', 'name'],
};
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Wire =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function opaque(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  );
}
function scopedPath(value: unknown, empty = true): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      (empty || value.length > 0) &&
      !value.includes('\0') &&
      !isAbsolute(value) &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    'Expected a workspace-relative path',
  );
}
function within(root: string, path: string) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) &&
      pathFromRoot !== '..' &&
      !pathFromRoot.startsWith('..' + sep))
  );
}
function canonical(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
function failure(code: string, message: string): Reply {
  return { error: { code, message } };
}
async function syncDirectory(path: string) {
  const file = await open(path, 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function exclusivePrivate(path: string, content: string) {
  const file = await open(
    path,
    C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}
function errorCode(error: unknown) {
  return object(error) && typeof error.code === 'string' ? error.code : '';
}

/** The host invokes its verified helper. No root authority travels over the public call. */
export class WorkspaceService {
  private readonly workspaces = new Map<string, RegisteredWorkspace>();
  private readonly children = new Set<ChildProcess>();
  private readonly inFlight = new Set<Promise<Reply>>();
  private closed = false;
  private constructor(
    private readonly options: WorkspaceServiceOptions,
    private readonly root: string,
    readonly connectionId: string,
  ) {}

  static async create(
    options: WorkspaceServiceOptions,
  ): Promise<WorkspaceService> {
    requireValue(
      isAbsolute(options.helper.path) &&
        basename(options.helper.path) === 'tekes-workspace-service',
      'Expected the verified workspace helper',
    );
    requireValue(
      /^[a-f0-9]{64}$/.test(options.helper.sha256),
      'Expected workspace helper SHA256',
    );
    const helperStat = await lstat(options.helper.path);
    requireValue(
      helperStat.isFile() && !helperStat.isSymbolicLink(),
      'Workspace helper must be a regular file',
    );
    await access(options.helper.path, C.X_OK);
    requireValue(
      sha(await readFile(options.helper.path)) === options.helper.sha256,
      'Workspace helper hash mismatch',
    );
    requireValue(
      isAbsolute(options.stateRoot),
      'Expected absolute private workspace state root',
    );
    const root = await privateRoot(options.stateRoot);
    const connectionId = options.connectionId ?? 'local-workspace';
    requireValue(opaque(connectionId), 'Invalid workspace connection identity');
    requireValue(
      options.timeoutMs === undefined ||
        (Number.isSafeInteger(options.timeoutMs) &&
          options.timeoutMs > 0 &&
          options.timeoutMs <= 120000),
      'Invalid workspace deadline',
    );
    const service = new WorkspaceService(
      { ...options, helper: { ...options.helper } },
      root,
      connectionId,
    );
    await privateRoot(join(root, 'replay'));
    await privateRoot(join(root, 'authority'));
    // The helper keys locks by canonical file/repository path. All registrations
    // in this host must share its lock namespace, including overlapping roots.
    const helperStateRoot = await privateRoot(join(root, 'helper-state'));
    for (const registration of options.workspaces) {
      requireValue(
        opaque(registration.id) && !service.workspaces.has(registration.id),
        'Invalid or duplicate workspace identity',
      );
      requireValue(
        isAbsolute(registration.root),
        'Expected a private absolute workspace root',
      );
      const workspaceRoot = await realpath(registration.root);
      requireValue(
        (await stat(workspaceRoot)).isDirectory(),
        'Registered workspace must be a directory',
      );
      requireValue(
        registration.allowRead === undefined ||
          typeof registration.allowRead === 'boolean',
        'Invalid workspace read grant',
      );
      requireValue(
        registration.allowFileWrites === undefined ||
          typeof registration.allowFileWrites === 'boolean',
        'Invalid workspace write grant',
      );
      const operations = [...(registration.git?.operations ?? [])];
      requireValue(
        operations.every((operation) => gitOperations.has(operation)) &&
          new Set(operations).size === operations.length,
        'Invalid Git grants',
      );
      const repositories = [];
      for (const repository of registration.git?.repositories ?? []) {
        scopedPath(repository);
        const resolved = await realpath(join(workspaceRoot, repository));
        requireValue(
          within(workspaceRoot, resolved) &&
            (await stat(resolved)).isDirectory(),
          'Repository grant escapes workspace',
        );
        repositories.push(resolved);
      }
      const authorityDirectory = await privateRoot(
        join(root, 'authority', sha(registration.id)),
      );
      const authority = {
        stateRoot: helperStateRoot,
        allowFileWrites: registration.allowFileWrites === true,
        workspaceRoots: [workspaceRoot],
        allowedOperations: operations,
        allowedRepositoryRoots: [...new Set(repositories)],
      };
      const content = JSON.stringify(authority);
      const authorityFile = join(authorityDirectory, sha(content) + '.json');
      try {
        await exclusivePrivate(authorityFile, content);
        await syncDirectory(authorityDirectory);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        requireValue(
          (await readPrivate(authorityFile)) === content,
          'Workspace authority file mismatch',
        );
      }
      const methods: WorkspaceMethod[] = [
        'capabilities',
        ...(registration.allowRead === true ? reads : []),
      ];
      if (registration.allowFileWrites === true) methods.push('filesWrite');
      if (repositories.length && operations.includes('commit'))
        methods.push('gitCommit');
      if (repositories.length && operations.includes('push'))
        methods.push('gitPush');
      if (
        repositories.length &&
        operations.some((operation) => operation.startsWith('branch.'))
      )
        methods.push('gitChangeBranch');
      service.workspaces.set(registration.id, {
        id: registration.id,
        title: registration.title || registration.id,
        root: workspaceRoot,
        methods,
        gitOperations: operations,
        authorityFile,
      });
    }
    return service;
  }
  list(): WorkspaceInventory {
    return {
      workspaces: [...this.workspaces.values()].map((workspace) => ({
        connectionId: this.connectionId,
        workspaceId: workspace.id,
        title: workspace.title,
        capabilities: this.capabilities(workspace),
      })),
    };
  }
  private capabilities(workspace: RegisteredWorkspace): WorkspaceCapabilities {
    return {
      version: 1,
      methods: [...workspace.methods],
      mutations: workspace.methods.some((method) => mutations.has(method)),
      allowedGitOperations: [...workspace.gitOperations],
      turnChanges: false,
    };
  }
  async call(input: WorkspaceCallRequest): Promise<Reply> {
    if (this.closed)
      return failure('unavailable', 'Workspace service is closed');
    let workspace: RegisteredWorkspace, method: WorkspaceMethod, request: Wire;
    try {
      requireValue(
        object(input) &&
          Object.keys(input).every((key) =>
            [
              'op',
              'connectionId',
              'workspaceId',
              'method',
              'request',
              'rpcId',
            ].includes(key),
          ),
        'Invalid workspace call',
      );
      requireValue(
        input.op === 'workspace.call' &&
          input.connectionId === this.connectionId,
        'Unknown workspace connection',
      );
      requireValue(
        typeof input.workspaceId === 'string' &&
          this.workspaces.has(input.workspaceId),
        'Unknown registered workspace',
      );
      workspace = this.workspaces.get(input.workspaceId)!;
      requireValue(
        typeof input.method === 'string' && Object.hasOwn(fields, input.method),
        'Unsupported workspace method',
      );
      method = input.method;
      requireValue(object(input.request), 'Expected workspace request object');
      requireValue(
        Object.keys(input.request).every((key) => fields[method].includes(key)),
        'Unexpected workspace request field',
      );
      requireValue(
        typeof input.rpcId === 'string' &&
          input.rpcId.length > 0 &&
          input.rpcId.length <= 200,
        'Expected bounded workspace RPC identity',
      );
      request = { ...input.request, workspaceId: workspace.id };
      this.validateFields(method, input.request);
    } catch (error) {
      return failure(
        'invalid-request',
        error instanceof Error ? error.message : 'Invalid workspace call',
      );
    }
    if (!workspace.methods.includes(method))
      return failure(
        'permission-denied',
        'Workspace operation is not authorized',
      );
    if (method === 'capabilities')
      return { result: this.capabilities(workspace) };
    const task = this.execute(workspace, method, request, input.rpcId);
    this.inFlight.add(task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(task);
    }
  }
  private validateFields(method: string, request: Wire) {
    for (const [key, value] of Object.entries(request)) {
      if (['path', 'repositoryPath'].includes(key))
        scopedPath(
          value,
          key === 'repositoryPath' ||
            method === 'filesList' ||
            method === 'filesSearch',
        );
      else if (key === 'paths') {
        requireValue(Array.isArray(value), 'Expected selected paths');
        for (const path of value) scopedPath(path, false);
      } else if (['limit', 'offset', 'maxBytes'].includes(key))
        requireValue(
          Number.isSafeInteger(value) && Number(value) >= 0,
          'Expected unsigned result bound',
        );
      else if (key === 'includeClean')
        requireValue(
          typeof value === 'boolean',
          'Expected includeClean boolean',
        );
      else
        requireValue(
          typeof value === 'string' && !value.includes('\0'),
          'Expected workspace text parameter',
        );
    }
    if (method === 'filesWrite')
      requireValue(
        typeof request.path === 'string' &&
          typeof request.content === 'string' &&
          typeof request.expectedRevision === 'string',
        'Missing file save parameters',
      );
  }
  private async execute(
    workspace: RegisteredWorkspace,
    method: string,
    request: Wire,
    rpcId: string,
  ): Promise<Reply> {
    if (!mutations.has(method)) return this.invoke(workspace, method, request);
    const directory = join(this.root, 'replay');
    const path = join(directory, sha(rpcId) + '.json');
    const digest = sha(
      JSON.stringify(
        canonical({
          connectionId: this.connectionId,
          workspaceId: workspace.id,
          root: workspace.root,
          helper: this.options.helper.sha256,
          method,
          request,
        }),
      ),
    );
    try {
      await exclusivePrivate(path, JSON.stringify({ digest }));
      await syncDirectory(directory);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST')
        return failure(
          'outcome-unknown',
          'Workspace mutation could not reserve a durable receipt',
        );
      let previous: unknown;
      try {
        previous = JSON.parse(await readPrivate(path));
      } catch {
        return failure(
          'outcome-unknown',
          'A prior workspace operation has no readable receipt',
        );
      }
      if (!object(previous) || previous.digest !== digest)
        return object(previous) && typeof previous.digest === 'string'
          ? failure(
              'idempotency-conflict',
              'RPC identity was reused with different parameters',
            )
          : failure(
              'outcome-unknown',
              'A prior workspace operation has no readable receipt',
            );
      return object(previous.reply) &&
        Object.hasOwn(previous.reply, 'result') !==
          Object.hasOwn(previous.reply, 'error')
        ? (previous.reply as Reply)
        : failure(
            'outcome-unknown',
            'A prior workspace operation may have completed; refresh its state',
          );
    }
    const reply = await this.invoke(workspace, method, request);
    const temporary = path + '.' + randomUUID();
    try {
      await exclusivePrivate(temporary, JSON.stringify({ digest, reply }));
      await rename(temporary, path);
      await syncDirectory(directory);
    } catch {
      return failure(
        'outcome-unknown',
        'Workspace operation ran but its receipt could not be durably saved',
      );
    }
    return reply;
  }
  private async invoke(
    workspace: RegisteredWorkspace,
    method: string,
    request: Wire,
  ): Promise<Reply> {
    const mutation = mutations.has(method);
    if (this.closed)
      return failure(
        mutation ? 'outcome-unknown' : 'unavailable',
        'Workspace service is closed',
      );
    const input = JSON.stringify({ method, request });
    if (
      Buffer.byteLength(input) >
      (method === 'filesWrite' ? 8 : 1) * 1024 * 1024
    )
      return failure(
        'invalid-request',
        'Workspace helper request is too large',
      );
    const complete = method === 'filesRead' && request.maxBytes === 0;
    const reply = await new Promise<Reply>((resolve) => {
      const child = spawn(
        this.options.helper.path,
        ['--root', workspace.root, '--authority-file', workspace.authorityFile],
        {
          env: cleanEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        },
      );
      this.children.add(child);
      const stdout: Buffer[] = [];
      let outputBytes = 0,
        stderrBytes = 0,
        problem = '';
      const stop = () => {
        if (child.pid)
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if (errorCode(error) !== 'ESRCH')
              problem ||= 'Workspace helper cleanup failed';
          }
      };
      const timer = setTimeout(() => {
        problem = 'Workspace helper timed out';
        stop();
      }, this.options.timeoutMs ?? 30000);
      child.stdout.on('data', (data: Buffer) => {
        outputBytes += data.length;
        if (!complete && outputBytes > 8 * 1024 * 1024) {
          problem = 'Workspace helper output exceeded limit';
          stop();
        } else stdout.push(data);
      });
      child.stderr.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes > 64 * 1024) {
          problem = 'Workspace helper error output exceeded limit';
          stop();
        }
      });
      child.stdin.on('error', () => {
        problem ||= 'Workspace helper input failed';
        stop();
      });
      child.once('error', () => {
        problem ||= 'Workspace helper could not start';
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        stop();
        this.children.delete(child);
        if (problem || code !== 0) {
          resolve(
            failure(
              mutation ? 'outcome-unknown' : 'process-failed',
              problem || `Workspace helper exited ${code}`,
            ),
          );
          return;
        }
        try {
          const value: unknown = JSON.parse(
            Buffer.concat(stdout).toString('utf8'),
          );
          requireValue(
            object(value) &&
              Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error'),
            'Expected exactly one workspace result or error',
          );
          if (Object.hasOwn(value, 'error'))
            requireValue(
              object(value.error) &&
                typeof value.error.code === 'string' &&
                typeof value.error.message === 'string',
              'Invalid workspace helper error',
            );
          resolve(value as Reply);
        } catch {
          resolve(
            failure(
              mutation ? 'outcome-unknown' : 'invalid-response',
              'Workspace helper returned invalid JSON',
            ),
          );
        }
      });
      child.stdin.end(input);
    });
    if ('result' in reply && method.startsWith('git')) {
      try {
        await this.addRepositoryPaths(workspace.root, reply.result);
      } catch {
        return failure(
          'invalid-response',
          'Workspace helper returned a repository outside the registered root',
        );
      }
    }
    return reply;
  }
  private async addRepositoryPaths(
    root: string,
    value: unknown,
  ): Promise<void> {
    if (!object(value)) return;
    if (typeof value.repositoryRoot === 'string') {
      requireValue(
        isAbsolute(value.repositoryRoot),
        'Expected absolute repository identity',
      );
      const repository = await realpath(value.repositoryRoot);
      requireValue(
        within(root, repository),
        'Repository escapes registered workspace',
      );
      value.repositoryPath = relative(root, repository).split(sep).join('/');
    }
    if (Array.isArray(value.repositories))
      for (const repository of value.repositories)
        await this.addRepositoryPaths(root, repository);
  }
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled([...this.inFlight]);
      return;
    }
    this.closed = true;
    for (const child of this.children)
      if (child.pid)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (errorCode(error) !== 'ESRCH') throw error;
        }
    await Promise.allSettled([...this.inFlight]);
  }
}
