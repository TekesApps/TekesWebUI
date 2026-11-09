import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  WorkspacePanel,
  type WorkspacePanelProps,
} from '../src/components/WorkspacePanel';
import {
  workspaceFileText,
  workspaceTextBase64,
  type WorkspaceCall,
  type WorkspaceCapabilities,
  type WorkspaceFile,
} from '../src/workspace-service';
import { getLocale, setLocale } from '../src/i18n';

function file(
  workspaceId = 'one',
  text = 'original',
  revision = 'revision-1',
): WorkspaceFile {
  return {
    workspaceId,
    path: 'proof.txt',
    encoding: 'base64',
    content: workspaceTextBase64(text),
    size: new TextEncoder().encode(text).byteLength,
    truncated: false,
    revision,
  };
}
const caps: WorkspaceCapabilities = {
  version: 1,
  methods: ['filesList', 'filesRead', 'filesWrite', 'filesSearch'],
  mutations: true,
  allowedGitOperations: [],
  turnChanges: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: WorkspacePanelProps) => Promise<void>;
    button: (text: string) => HTMLButtonElement;
    enter: (selector: string, value: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const locale = getLocale();
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await check({
      container,
      render: (props) =>
        act(async () => root.render(createElement(WorkspacePanel, props))),
      button: (text) => {
        const b = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => b.textContent === text);
        assert.ok(b, `Missing ${text}`);
        return b;
      },
      enter: (selector, value) =>
        act(async () => {
          const input = container.querySelector<
            HTMLInputElement | HTMLTextAreaElement
          >(selector)!;
          assert.ok(input, selector);
          const prototype =
            input.tagName === 'TEXTAREA'
              ? dom.window.HTMLTextAreaElement.prototype
              : dom.window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
            input,
            value,
          );
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
    });
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}
function handler(
  workspaceId = 'one',
  read: () => Promise<WorkspaceFile> = async () => file(workspaceId),
  write: WorkspaceCall = async () => ({}),
): WorkspaceCall {
  return async (method, payload, id) => {
    if (method === 'capabilities') return caps;
    assert.equal(payload.workspaceId, workspaceId);
    if (method === 'filesList' || method === 'filesSearch')
      return {
        workspaceId,
        path: '',
        entries: [
          { name: 'proof.txt', path: 'proof.txt', kind: 'file', hidden: false },
        ],
        truncated: false,
      };
    if (method === 'filesRead') return read();
    return write(method, payload, id);
  };
}

test('only complete canonical UTF-8 snapshots are editable', () => {
  assert.equal(workspaceFileText(file('one', '你好')), '你好');
  assert.equal(
    workspaceTextBase64(workspaceFileText(file('one', '\ufeffhello'))!),
    workspaceTextBase64('\ufeffhello'),
  );
  assert.equal(workspaceFileText({ ...file(), truncated: true }), null);
  assert.equal(
    workspaceFileText({ ...file(), content: 'AA==', size: 1 }),
    null,
  );
  assert.equal(
    workspaceFileText({ ...file(), content: '/w==', size: 1 }),
    null,
  );
  assert.equal(
    workspaceFileText({ ...file(), content: 'YQ==', size: 2 }),
    null,
  );
});

test('file saves retain source revision and preserve drafts after unknown outcomes without retry', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    const pending = deferred<unknown>();
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const call = handler('one', undefined, async (method, payload) => {
      calls.push({ method, payload });
      return pending.promise;
    });
    await render({
      connectionId: 'host',
      workspaceId: 'one',
      label: 'One',
      call,
    });
    await act(async () => button('proof.txt').click());
    await enter('textarea', 'edited');
    await act(async () => {
      button('保存文件').click();
      button('保存文件').click();
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.expectedRevision, 'revision-1');
    assert.equal(calls[0].payload.content, workspaceTextBase64('edited'));
    await act(async () => pending.reject(new Error('outcome-unknown')));
    assert.equal(container.querySelector('textarea')!.value, 'edited');
    assert.equal(button('保存文件').disabled, true);
    assert.match(container.textContent!, /操作结果尚未确认/);
    assert.equal(calls.length, 1);
    await act(async () => button('刷新工作区').click());
    assert.equal(container.querySelector('textarea')!.value, 'edited');
    assert.equal(button('保存文件').disabled, false);
    assert.equal(calls.length, 1);
  });
});

test('late file responses and mutation acknowledgements cannot populate a different workspace', async () => {
  await fixture(async ({ container, render, button }) => {
    const late = deferred<WorkspaceFile>();
    await render({
      connectionId: 'host',
      workspaceId: 'one',
      label: 'One',
      call: handler('one', () => late.promise),
    });
    await act(async () => button('proof.txt').click());
    await render({
      connectionId: 'host',
      workspaceId: 'two',
      label: 'Two',
      call: handler('two', async () => file('two', 'second')),
    });
    await act(async () => late.resolve(file('one', 'private first')));
    assert.doesNotMatch(container.textContent!, /private first/);
    await act(async () => button('proof.txt').click());
    assert.equal(container.querySelector('textarea')!.value, 'second');
  });
});

test('changed file revisions do not silently rebase a retained draft', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    let current = file();
    await render({
      connectionId: 'host',
      workspaceId: 'one',
      label: 'One',
      call: handler('one', async () => current),
    });
    await act(async () => button('proof.txt').click());
    await enter('textarea', 'local draft');
    current = file('one', 'other writer', 'revision-2');
    await act(async () => button('刷新工作区').click());
    assert.equal(container.querySelector('textarea')!.value, 'local draft');
    assert.equal(button('保存文件').disabled, true);
    assert.match(container.textContent!, /文件已被其他操作修改/);
    await act(async () => button('放弃草稿并重新读取').click());
    assert.equal(container.querySelector('textarea')!.value, 'other writer');
  });
});

test('Git mutations follow host grants, use selected paths and retain an uncertain commit message', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    const writes: { method: string; payload: Record<string, unknown> }[] = [];
    const pending = deferred<unknown>();
    const call: WorkspaceCall = async (method, payload) => {
      if (method === 'capabilities')
        return {
          ...caps,
          methods: [
            'gitStatus',
            'gitBranches',
            'gitLog',
            'gitDiff',
            'gitCommit',
            'gitPush',
            'gitChangeBranch',
          ],
          allowedGitOperations: ['commit', 'branch.switch'],
        };
      if (method === 'gitStatus')
        return {
          repositoryRoot: '/host/registered',
          branch: 'main',
          head: 'a'.repeat(40),
          detached: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          remotes: ['origin'],
          changes: [
            {
              path: 'proof.txt',
              kind: 'ordinary',
              indexStatus: '.',
              workTreeStatus: 'M',
              isConflict: false,
            },
          ],
        };
      if (method === 'gitBranches')
        return {
          branches: [
            { name: 'main', isCurrent: true, head: 'a'.repeat(40) },
            { name: 'other', isCurrent: false, head: 'b'.repeat(40) },
          ],
        };
      if (method === 'gitLog')
        return {
          head: 'a'.repeat(40),
          commits: [
            {
              id: 'a'.repeat(40),
              author: 'Author',
              date: '2026-11-09',
              subject: 'Proof',
            },
          ],
          nextOffset: null,
        };
      writes.push({ method, payload });
      return pending.promise;
    };
    await render({
      connectionId: 'host',
      workspaceId: 'one',
      label: 'One',
      call,
    });
    await act(async () => button('Git').click());
    assert.equal(button('推送当前分支').disabled, true);
    assert.equal(button('创建并切换分支').disabled, true);
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await enter('textarea', 'commit draft');
    await act(async () => {
      button('提交所选文件').click();
      button('提交所选文件').click();
    });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].payload, {
      workspaceId: 'one',
      repositoryPath: '',
      message: 'commit draft',
      paths: ['proof.txt'],
    });
    await act(async () => pending.reject(new Error('outcome-unknown')));
    assert.equal(container.querySelector('textarea')!.value, 'commit draft');
    assert.equal(button('提交所选文件').disabled, true);
    assert.equal(writes.length, 1);
  });
});

test('a late save acknowledgement stays with its original workspace', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    const pending = deferred<unknown>();
    let readCalls = 0;
    const first = handler(
      'one',
      async () => {
        readCalls++;
        return file();
      },
      async () => pending.promise,
    );
    await render({
      connectionId: 'first-host',
      workspaceId: 'one',
      label: 'One',
      call: first,
    });
    await act(async () => button('proof.txt').click());
    await enter('textarea', 'first draft');
    await act(async () => button('保存文件').click());
    await render({
      connectionId: 'second-host',
      workspaceId: 'two',
      label: 'Two',
      call: handler('two'),
    });
    await act(async () =>
      pending.resolve({
        workspaceId: 'one',
        path: 'proof.txt',
        revision: 'revision-2',
        size: 11,
      }),
    );
    assert.equal(
      readCalls,
      1,
      'old acknowledgement must not initiate a new read through the new workspace callback',
    );
    assert.match(container.textContent!, /Two/);
    assert.doesNotMatch(container.textContent!, /操作已确认|工作区状态已更新/);
    assert.equal(container.querySelector('textarea'), null);
  });
});

test('nested repository selection uses only the host relative mapping and isolates commit drafts', async () => {
  await fixture(async ({ container, render, button, enter }) => {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const call: WorkspaceCall = async (method, payload) => {
      calls.push({ method, payload });
      if (method === 'capabilities')
        return {
          ...caps,
          methods: ['gitStatus', 'gitChangesNavigator', 'gitCommit'],
          allowedGitOperations: ['commit'],
        };
      if (method === 'gitStatus')
        return {
          repositoryRoot: payload.repositoryPath
            ? '/host/root/packages/project'
            : '/host/root',
          branch: 'main',
          head: 'a'.repeat(40),
          detached: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          remotes: [],
          changes: [
            {
              path: 'proof.txt',
              kind: 'ordinary',
              indexStatus: '.',
              workTreeStatus: 'M',
              isConflict: false,
            },
          ],
        };
      if (method === 'gitChangesNavigator')
        return {
          repositories: [
            {
              repositoryRoot: '/host/root/packages/project',
              repositoryPath: 'packages/project',
              name: 'Project',
              branch: 'main',
              uncommitted: [],
              unpushedCommits: [],
              unpushedCommitsTruncated: false,
            },
            {
              repositoryRoot: '/host/private-unmapped',
              name: 'Unmapped facts',
              branch: 'main',
              uncommitted: [],
              unpushedCommits: [],
              unpushedCommitsTruncated: false,
            },
          ],
        };
      throw new Error('No mutation expected');
    };
    await render({
      connectionId: 'host',
      workspaceId: 'one',
      label: 'One',
      call,
    });
    await act(async () => button('Git').click());
    await enter('textarea', 'root draft');
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    const choose = async (value: string) =>
      act(async () => {
        const select = container.querySelector<HTMLSelectElement>(
          'select[aria-label="Git 仓库"]',
        )!;
        select.value = value;
        select.dispatchEvent(
          new container.ownerDocument.defaultView!.Event('change', {
            bubbles: true,
          }),
        );
      });
    const options = [
      ...container.querySelectorAll<HTMLSelectElement>(
        'select[aria-label="Git 仓库"] option',
      ),
    ].map((option) => option.value);
    assert.deepEqual(options, ['', 'packages/project']);
    await choose('packages/project');
    assert.equal(container.querySelector('textarea')!.value, '');
    assert.equal(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .checked,
      false,
    );
    await enter('textarea', 'project draft');
    await choose('');
    assert.equal(container.querySelector('textarea')!.value, 'root draft');
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'gitStatus' &&
          call.payload.repositoryPath === 'packages/project',
      ),
    );
    assert.equal(
      calls.some((call) =>
        Object.values(call.payload).some(
          (value) => typeof value === 'string' && value.startsWith('/host/'),
        ),
      ),
      false,
    );
  });
});

test('a read-only Harness file capability exposes no save or Git operation', async () => {
  await fixture(async ({ container, render, button }) => {
    const methods: string[] = [];
    const call: WorkspaceCall = async (method) => {
      methods.push(method);
      if (method === 'capabilities')
        return {
          version: 1,
          methods: ['filesList', 'filesRead'],
          mutations: false,
          turnChanges: false,
        };
      if (method === 'filesList')
        return {
          workspaceId: 'remote-session',
          path: '',
          entries: [
            {
              name: 'remote.txt',
              path: 'remote.txt',
              kind: 'file',
              hidden: false,
            },
          ],
          truncated: false,
        };
      if (method === 'filesRead')
        return { ...file('remote-session', 'remote text'), path: 'remote.txt' };
      throw new Error('Read-only Harness must not receive a mutation');
    };
    await render({
      connectionId: 'remote-harness',
      workspaceId: 'remote-session',
      label: 'DSH session files',
      call,
    });
    await act(async () => button('remote.txt').click());
    const text = container.querySelector('textarea')!;
    assert.equal(text.value, 'remote text');
    assert.equal(text.readOnly, true);
    assert.equal(text.disabled, false);
    const labels = [...container.querySelectorAll('button')].map(
      (button) => button.textContent,
    );
    assert.equal(labels.includes('Git'), false);
    assert.equal(labels.includes('保存文件'), false);
    assert.equal(labels.includes('放弃草稿并重新读取'), false);
    assert.ok(button('重新读取文件'));
    assert.deepEqual(methods, ['capabilities', 'filesList', 'filesRead']);
  });
});
