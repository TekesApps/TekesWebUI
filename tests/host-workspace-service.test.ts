import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  WorkspaceCallRequest,
  WorkspaceResult,
} from '@tekesagentkit/client-contract/workspace';
import {
  WorkspaceService,
  type WorkspaceRegistration,
} from '../host/workspace-service.js';

const exec = promisify(execFile);
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
async function temporary(run: (root: string) => Promise<void>) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'tekes-workspace-host-')),
  );
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function call(
  service: WorkspaceService,
  method: WorkspaceCallRequest['method'],
  request: Record<string, unknown> = {},
  rpcId: string = randomUUID(),
  workspaceId = 'opaque-workspace',
) {
  return service.call({
    op: 'workspace.call',
    connectionId: 'local-workspace',
    workspaceId,
    method,
    request,
    rpcId,
  } as WorkspaceCallRequest);
}
function value<T>(reply: WorkspaceResult<unknown>): T {
  assert.ok('result' in reply, JSON.stringify(reply));
  return reply.result as T;
}
function errorCode(reply: WorkspaceResult<unknown>) {
  assert.ok('error' in reply, JSON.stringify(reply));
  return reply.error.code;
}
async function fixtureHelper(root: string) {
  const path = join(root, 'tekes-workspace-service');
  await writeFile(
    path,
    `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const root=process.argv[process.argv.indexOf('--root')+1];let input='';
process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const q=JSON.parse(input);fs.appendFileSync(path.join(root,'calls.log'),q.method+'\\n');
if(q.method==='filesWrite' && q.request.content==='broken'){process.stdout.write('result lost');return;}
if(q.request.path==='hang'){const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(path.join(root,'pids.json'),JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);return;}
if(q.method==='gitChangesNavigator'){process.stdout.write(JSON.stringify({result:{repositories:[{repositoryRoot:path.dirname(root)}]}}));return;}
process.stdout.write(JSON.stringify({result:{workspaceId:q.request.workspaceId,path:q.request.path||'',content:q.request.content||'',revision:'returned'}}));});
`,
  );
  await chmod(path, 0o700);
  return { path, sha256: sha(await readFile(path)) };
}
async function service(
  root: string,
  options: { write?: boolean; git?: WorkspaceRegistration['git'] } = {},
) {
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const helper = await fixtureHelper(root);
  return {
    workspace,
    helper,
    instance: await WorkspaceService.create({
      helper,
      stateRoot: join(root, 'state'),
      workspaces: [
        {
          id: 'opaque-workspace',
          title: 'Project',
          root: workspace,
          allowRead: true,
          allowFileWrites: options.write,
          git: options.git,
        },
      ],
    }),
  };
}

test('host registry rejects browser authority, unknown IDs and methods before invoking its private helper', () =>
  temporary(async (root) => {
    const { instance, workspace } = await service(root);
    try {
      assert.equal(
        instance.list().workspaces[0].capabilities?.turnChanges,
        false,
      );
      assert.equal(
        instance.list().workspaces[0].capabilities?.mutations,
        false,
      );
      assert.ok(
        !instance
          .list()
          .workspaces[0].capabilities?.methods.includes('turnChanges'),
      );
      assert.equal(
        errorCode(
          await call(instance, 'filesList', {}, randomUUID(), 'unregistered'),
        ),
        'invalid-request',
      );
      assert.equal(
        errorCode(await call(instance, 'filesList', { root: '/elsewhere' })),
        'invalid-request',
      );
      assert.equal(
        errorCode(
          await call(instance, 'filesList', { url: 'http://localhost' }),
        ),
        'invalid-request',
      );
      assert.equal(
        errorCode(
          await call(instance, 'filesList', {
            authority: { allowFileWrites: true },
          }),
        ),
        'invalid-request',
      );
      assert.equal(
        errorCode(await call(instance, 'filesRead', { path: '../outside' })),
        'invalid-request',
      );
      assert.equal(
        errorCode(await call(instance, 'turnChanges', {})),
        'invalid-request',
      );
      assert.equal(
        errorCode(
          await call(instance, 'filesWrite', {
            path: 'file',
            content: 'data',
            expectedRevision: '0'.repeat(64),
          }),
        ),
        'permission-denied',
      );
      assert.equal(
        errorCode(
          await instance.call({
            op: 'workspace.call',
            connectionId: 'invented',
            workspaceId: 'opaque-workspace',
            method: 'filesList',
            request: {},
            rpcId: 'id',
          }),
        ),
        'invalid-request',
      );
      await assert.rejects(readFile(join(workspace, 'calls.log')), {
        code: 'ENOENT',
      });
      assert.equal(
        value<{ path: string }>(await call(instance, 'filesList', { path: '' }))
          .path,
        '',
      );
      assert.equal(
        (await readFile(join(workspace, 'calls.log'), 'utf8')).trim(),
        'filesList',
      );
      assert.equal(
        errorCode(await call(instance, 'gitChangesNavigator')),
        'invalid-response',
        'helper roots are checked before deriving browser repository paths',
      );
    } finally {
      await instance.close();
      await instance.close();
    }
  }));

test('mutation replay survives host restart and refuses changed parameters or an incomplete durable receipt', () =>
  temporary(async (root) => {
    const { instance, workspace, helper } = await service(root, {
      write: true,
    });
    const request = {
      path: 'file',
      content: 'payload',
      expectedRevision: '0'.repeat(64),
    };
    const first = await call(instance, 'filesWrite', request, 'write-once');
    assert.equal(value<{ revision: string }>(first).revision, 'returned');
    assert.deepEqual(
      await call(instance, 'filesWrite', request, 'write-once'),
      first,
    );
    assert.equal(
      errorCode(
        await call(
          instance,
          'filesWrite',
          { ...request, content: 'changed' },
          'write-once',
        ),
      ),
      'idempotency-conflict',
    );
    await instance.close();
    const restarted = await WorkspaceService.create({
      helper,
      stateRoot: join(root, 'state'),
      workspaces: [
        {
          id: 'opaque-workspace',
          root: workspace,
          allowRead: true,
          allowFileWrites: true,
        },
      ],
    });
    try {
      assert.deepEqual(
        await call(restarted, 'filesWrite', request, 'write-once'),
        first,
      );
      const receipts = await readdir(join(root, 'state', 'replay'));
      assert.equal(receipts.length, 1);
      const path = join(root, 'state', 'replay', receipts[0]);
      const receipt = JSON.parse(await readFile(path, 'utf8')) as {
        digest: string;
      };
      await writeFile(path, JSON.stringify({ digest: receipt.digest }), {
        mode: 0o600,
      });
      assert.equal(
        errorCode(await call(restarted, 'filesWrite', request, 'write-once')),
        'outcome-unknown',
      );
      assert.equal(
        (await readFile(join(workspace, 'calls.log'), 'utf8')).trim(),
        'filesWrite',
        'unrecorded outcomes must not re-execute the helper',
      );
    } finally {
      await restarted.close();
    }
  }));

test('a helper outcome lost after execution stays unknown and is never resent', () =>
  temporary(async (root) => {
    const { instance, workspace } = await service(root, { write: true });
    try {
      const request = {
        path: 'file',
        content: 'broken',
        expectedRevision: '0'.repeat(64),
      };
      assert.equal(
        errorCode(await call(instance, 'filesWrite', request, 'lost-reply')),
        'outcome-unknown',
      );
      assert.equal(
        errorCode(await call(instance, 'filesWrite', request, 'lost-reply')),
        'outcome-unknown',
      );
      assert.equal(
        (await readFile(join(workspace, 'calls.log'), 'utf8')).trim(),
        'filesWrite',
      );
    } finally {
      await instance.close();
    }
  }));

test('closing the host retires the owned helper group and preserves an unknown mutation receipt', () =>
  temporary(async (root) => {
    const { instance, workspace, helper } = await service(root, {
      write: true,
    });
    const request = {
      path: 'hang',
      content: 'pending',
      expectedRevision: '0'.repeat(64),
    };
    const pending = call(
      instance,
      'filesWrite',
      request,
      'closed-during-write',
    );
    let pids: number[] | undefined;
    const deadline = Date.now() + 2000;
    while (!pids) {
      try {
        pids = JSON.parse(
          await readFile(join(workspace, 'pids.json'), 'utf8'),
        ) as number[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        assert.ok(Date.now() < deadline, 'fixture helper did not start');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await instance.close();
    assert.equal(errorCode(await pending), 'outcome-unknown');
    for (const pid of pids) {
      let alive = true;
      const deadline = Date.now() + 1000;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 5));
        } catch (error) {
          assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
          alive = false;
        }
      }
      assert.equal(alive, false, `owned helper process ${pid} leaked`);
    }
    const restarted = await WorkspaceService.create({
      helper,
      stateRoot: join(root, 'state'),
      workspaces: [
        {
          id: 'opaque-workspace',
          root: workspace,
          allowRead: true,
          allowFileWrites: true,
        },
      ],
    });
    try {
      assert.equal(
        errorCode(
          await call(restarted, 'filesWrite', request, 'closed-during-write'),
        ),
        'outcome-unknown',
      );
      assert.equal(
        (await readFile(join(workspace, 'calls.log'), 'utf8')).trim(),
        'filesWrite',
      );
    } finally {
      await restarted.close();
    }
  }));

test('workspace helper identity and private repository grants are checked before use', () =>
  temporary(async (root) => {
    const workspace = join(root, 'workspace');
    const outside = join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, join(workspace, 'escape'));
    const helper = await fixtureHelper(root);
    await assert.rejects(
      WorkspaceService.create({
        helper: { ...helper, sha256: '0'.repeat(64) },
        stateRoot: join(root, 'state'),
        workspaces: [],
      }),
      /hash mismatch/,
    );
    await assert.rejects(
      WorkspaceService.create({
        helper,
        stateRoot: join(root, 'state'),
        workspaces: [
          {
            id: 'opaque',
            root: workspace,
            git: { operations: ['commit'], repositories: ['escape'] },
          },
        ],
      }),
      /escapes workspace/,
    );
  }));

const realHelper = process.env.TEKES_TEST_WORKSPACE_HELPER;
test(
  'published helper performs scoped files and Git operations in a temporary repository and bare remote',
  { skip: !realHelper },
  () =>
    temporary(async (root) => {
      const helper = {
        path: realHelper!,
        sha256: sha(await readFile(realHelper!)),
      };
      const workspace = join(root, 'workspace'),
        repository = join(workspace, 'repo'),
        remote = join(root, 'remote.git');
      await mkdir(repository, { recursive: true });
      await exec('git', ['init', '-b', 'main', repository]);
      await exec('git', ['init', '--bare', remote]);
      const git = (...args: string[]) =>
        exec('git', ['-C', repository, ...args]);
      await git('config', 'user.name', 'Workspace Fixture');
      await git('config', 'user.email', 'fixture@example.invalid');
      await git('config', 'commit.gpgsign', 'false');
      await git('config', 'core.hooksPath', join(root, 'no-hooks'));
      await writeFile(join(repository, 'proof.txt'), 'initial\n');
      await git('add', 'proof.txt');
      await git('commit', '-m', 'initial');
      await git('remote', 'add', 'origin', remote);
      await writeFile(join(root, 'outside.txt'), 'private outside');
      await symlink(join(root, 'outside.txt'), join(workspace, 'outside-link'));
      const readOnly = await WorkspaceService.create({
        helper,
        stateRoot: join(root, 'readonly-state'),
        workspaces: [
          { id: 'opaque-workspace', root: workspace, allowRead: true },
        ],
      });
      try {
        const read = value<{
          content: string;
          revision: string;
          truncated: boolean;
        }>(
          await call(readOnly, 'filesRead', {
            path: 'repo/proof.txt',
            maxBytes: 0,
          }),
        );
        assert.equal(
          Buffer.from(read.content, 'base64').toString(),
          'initial\n',
        );
        assert.equal(read.truncated, false);
        assert.equal(read.revision, sha('initial\n'));
        assert.equal(
          errorCode(
            await call(readOnly, 'filesRead', { path: 'outside-link' }),
          ),
          'path-outside-workspace',
        );
        assert.equal(
          errorCode(
            await call(readOnly, 'gitCommit', {
              repositoryPath: 'repo',
              message: 'denied',
              paths: ['proof.txt'],
            }),
          ),
          'permission-denied',
        );
        assert.equal(
          errorCode(
            await call(readOnly, 'filesWrite', {
              path: 'repo/proof.txt',
              content: Buffer.from('denied').toString('base64'),
              expectedRevision: read.revision,
            }),
          ),
          'permission-denied',
        );
      } finally {
        await readOnly.close();
      }
      const granted = await WorkspaceService.create({
        helper,
        stateRoot: join(root, 'granted-state'),
        workspaces: [
          {
            id: 'opaque-workspace',
            root: workspace,
            allowRead: true,
            allowFileWrites: true,
            git: {
              operations: ['commit', 'push', 'branch.create', 'branch.switch'],
              repositories: ['repo'],
            },
          },
        ],
      });
      try {
        const navigator = value<{ repositories: { repositoryPath: string }[] }>(
          await call(granted, 'gitChangesNavigator', { includeClean: true }),
        );
        assert.equal(navigator.repositories[0].repositoryPath, 'repo');
        const changed = 'edited through helper\n';
        const write = {
          path: 'repo/proof.txt',
          content: Buffer.from(changed).toString('base64'),
          expectedRevision: sha('initial\n'),
        };
        const saved = value<{ revision: string }>(
          await call(granted, 'filesWrite', write, 'save-once'),
        );
        assert.equal(saved.revision, sha(changed));
        assert.equal(
          errorCode(await call(granted, 'filesWrite', write, 'stale-save')),
          'revision-conflict',
        );
        const diff = value<{ unifiedDiff: string }>(
          await call(granted, 'gitDiff', {
            repositoryPath: 'repo',
            scope: 'unstaged',
            paths: ['proof.txt'],
          }),
        );
        assert.match(diff.unifiedDiff, /edited through helper/);
        const committed = value<{ commit: string }>(
          await call(
            granted,
            'gitCommit',
            {
              repositoryPath: 'repo',
              message: 'helper commit',
              paths: ['proof.txt'],
            },
            'commit-once',
          ),
        );
        assert.equal(
          (await git('rev-parse', 'HEAD')).stdout.trim(),
          committed.commit,
        );
        assert.equal(
          value<{ commit: string }>(
            await call(
              granted,
              'gitCommit',
              {
                repositoryPath: 'repo',
                message: 'helper commit',
                paths: ['proof.txt'],
              },
              'commit-once',
            ),
          ).commit,
          committed.commit,
        );
        value(
          await call(
            granted,
            'gitChangeBranch',
            {
              repositoryPath: 'repo',
              operation: 'create',
              name: 'helper-branch',
            },
            'branch-once',
          ),
        );
        value(
          await call(
            granted,
            'gitPush',
            { repositoryPath: 'repo', remote: 'origin' },
            'push-once',
          ),
        );
        assert.equal(
          (
            await exec('git', [
              '--git-dir',
              remote,
              'rev-parse',
              'refs/heads/helper-branch',
            ])
          ).stdout.trim(),
          committed.commit,
        );
        const branches = value<{ branches: unknown[] }>(
          await call(granted, 'gitBranches', { repositoryPath: 'repo' }),
        );
        assert.ok(branches.branches.length > 0);
        const history = value<{ commits: unknown[] }>(
          await call(granted, 'gitLog', { repositoryPath: 'repo', limit: 10 }),
        );
        assert.equal(history.commits.length, 2);
      } finally {
        await granted.close();
      }
    }),
);

test(
  'overlapping registrations share canonical helper locks without combining their grants',
  { skip: !realHelper },
  () =>
    temporary(async (root) => {
      const helper = {
        path: realHelper!,
        sha256: sha(await readFile(realHelper!)),
      };
      const workspace = join(root, 'workspace'),
        project = join(workspace, 'project'),
        stateRoot = join(root, 'state');
      await mkdir(project, { recursive: true });
      const original = Buffer.alloc(4 * 1024 * 1024, 'o');
      await writeFile(join(project, 'proof.txt'), original);
      await symlink(project, join(root, 'project-alias'));
      await exec('git', ['init', '-b', 'main', project]);
      const git = (...args: string[]) => exec('git', ['-C', project, ...args]);
      await git('config', 'user.name', 'Workspace Fixture');
      await git('config', 'user.email', 'fixture@example.invalid');
      await git('config', 'commit.gpgsign', 'false');
      await git('config', 'core.hooksPath', join(root, 'no-hooks'));
      await git('add', 'proof.txt');
      await git('commit', '-m', 'initial');
      const service = await WorkspaceService.create({
        helper,
        stateRoot,
        workspaces: [
          {
            id: 'outer',
            root: workspace,
            allowRead: true,
            allowFileWrites: true,
            git: { operations: ['commit'], repositories: ['project'] },
          },
          {
            id: 'nested',
            root: project,
            allowRead: true,
            allowFileWrites: true,
            git: { operations: ['branch.create'], repositories: [''] },
          },
          {
            id: 'same-root-alias',
            root: join(root, 'project-alias'),
            allowRead: true,
            allowFileWrites: true,
          },
          { id: 'read-only', root: project, allowRead: true },
        ],
      });
      try {
        for (const [label, left, right] of [
          ['nested', ['outer', 'project/proof.txt'], ['nested', 'proof.txt']],
          [
            'same-root',
            ['nested', 'proof.txt'],
            ['same-root-alias', 'proof.txt'],
          ],
        ] as const) {
          await writeFile(join(project, 'proof.txt'), original);
          const values = [
            Buffer.alloc(original.length, 'x'),
            Buffer.alloc(original.length, 'y'),
          ];
          const replies = await Promise.all(
            [left, right].map(([workspaceId, path], index) =>
              call(
                service,
                'filesWrite',
                {
                  path,
                  content: values[index].toString('base64'),
                  expectedRevision: sha(original),
                },
                `parallel-${label}-${index}`,
                workspaceId,
              ),
            ),
          );
          assert.equal(
            replies.filter((reply) => 'result' in reply).length,
            1,
            'one writer must own the original revision',
          );
          assert.equal(
            replies.filter(
              (reply) =>
                'error' in reply && reply.error.code === 'revision-conflict',
            ).length,
            1,
            'the other registration must observe the committed revision',
          );
          const winner = replies.findIndex((reply) => 'result' in reply);
          assert.deepEqual(
            await readFile(join(project, 'proof.txt')),
            values[winner],
          );
        }
        const before = await readFile(join(project, 'proof.txt'));
        assert.equal(
          errorCode(
            await call(
              service,
              'filesWrite',
              { path: 'proof.txt', content: '', expectedRevision: sha(before) },
              'readonly-denied',
              'read-only',
            ),
          ),
          'permission-denied',
        );
        assert.deepEqual(await readFile(join(project, 'proof.txt')), before);
        assert.equal(
          errorCode(
            await call(
              service,
              'gitCommit',
              { repositoryPath: '', message: 'denied', paths: ['proof.txt'] },
              'no-commit',
              'nested',
            ),
          ),
          'permission-denied',
        );
        assert.equal(
          errorCode(
            await call(
              service,
              'gitChangeBranch',
              {
                repositoryPath: 'project',
                operation: 'create',
                name: 'must-not-exist',
              },
              'no-branch',
              'outer',
            ),
          ),
          'permission-denied',
        );
        value(
          await call(
            service,
            'gitCommit',
            {
              repositoryPath: 'project',
              message: 'shared canonical lock',
              paths: ['proof.txt'],
            },
            'allowed-commit',
            'outer',
          ),
        );
        value(
          await call(
            service,
            'gitChangeBranch',
            { repositoryPath: '', operation: 'create', name: 'allowed-branch' },
            'allowed-branch',
            'nested',
          ),
        );
        assert.equal(
          (await git('branch', '--show-current')).stdout.trim(),
          'allowed-branch',
        );
        assert.equal(
          (await readdir(join(stateRoot, 'helper-state', 'file-locks'))).length,
          1,
          'same canonical file uses one helper lock',
        );
        assert.equal(
          (await readdir(join(stateRoot, 'helper-state', 'git-locks'))).length,
          1,
          'same canonical repository uses one helper lock',
        );
        const inventories = service.list().workspaces;
        assert.deepEqual(
          inventories.find((row) => row.workspaceId === 'outer')!.capabilities
            ?.allowedGitOperations,
          ['commit'],
        );
        assert.deepEqual(
          inventories.find((row) => row.workspaceId === 'nested')!.capabilities
            ?.allowedGitOperations,
          ['branch.create'],
        );
        assert.equal(
          inventories.find((row) => row.workspaceId === 'read-only')!
            .capabilities?.mutations,
          false,
        );
      } finally {
        await service.close();
      }
    }),
);
