import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  ResourcePicker,
  type ResourceCatalog,
  type CommandReceipt,
  type ToolCatalog,
  type ToolResolution,
  type SkillResource,
  type SkillResourcePage,
  type SkillResourceRead,
  type ResourcePickerProps,
} from '../src/components/ResourcePicker';
import { getLocale, setLocale } from '../src/i18n';

function catalog(sessionId = 'one'): ResourceCatalog {
  return {
    endpointId: 'pi',
    sessionId,
    connectionEpoch: 4,
    canRunCommands: true,
    commands: [
      {
        name: 'review',
        title: 'Review',
        description: 'Review current work',
        argumentHint: 'path',
        supportsAttachments: false,
      },
    ],
    skills: [
      {
        id: 'audit',
        name: 'audit',
        title: 'Audit',
        description: 'Audit selected work',
        selectable: true,
      },
      {
        id: 'private',
        name: 'private',
        title: 'Private',
        description: '',
        selectable: false,
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(
  check: (context: {
    render: (props: ResourcePickerProps) => Promise<void>;
    button: (text: string) => HTMLButtonElement;
    container: HTMLElement;
    enter: (text: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const locale = getLocale();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  setLocale('zh-CN');
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await check({
      render: (props) =>
        act(async () => root.render(createElement(ResourcePicker, props))),
      button: (text) => {
        const b = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].find((b) => b.textContent === text);
        assert.ok(b, `Missing button ${text}`);
        return b;
      },
      container,
      enter: (text) =>
        act(async () => {
          const input = container.querySelector('textarea')!;
          Object.getOwnPropertyDescriptor(
            dom.window.HTMLTextAreaElement.prototype,
            'value',
          )!.set!.call(input, text);
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        }),
    });
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test('commands preserve failed input, are dispatched once, and skill selection never executes', async () => {
  await fixture(async ({ render, button, enter, container }) => {
    const pending = deferred<CommandReceipt>();
    const calls: unknown[][] = [];
    const skills: string[] = [];
    const props: ResourcePickerProps = {
      address: { endpoint: 'pi', sessionId: 'one' },
      connectionEpoch: 4,
      load: async () => catalog(),
      run: async (...args) => {
        calls.push(args);
        return pending.promise;
      },
      selectSkill: (_, skill) => {
        skills.push(skill.id);
      },
    };
    await render(props);
    await act(async () => button('Audit').click());
    assert.deepEqual(skills, ['audit']);
    assert.equal(calls.length, 0);
    assert.equal(button('Private').disabled, true);
    await act(async () => button('/review — Review').click());
    await enter('src/index.ts');
    await act(async () => {
      button('执行命令').click();
      button('执行命令').click();
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][3], 'src/index.ts');
    assert.deepEqual(calls[0][0], props.address);
    assert.equal(calls[0][1], 4);
    await act(async () => pending.reject(new Error('not accepted')));
    assert.match(container.textContent!, /not accepted/);
    assert.equal(container.querySelector('textarea')!.value, 'src/index.ts');
    assert.equal(calls.length, 1, 'no automatic retry');
  });
});

test('late catalogs and command results cannot populate another session', async () => {
  await fixture(async ({ render, button, container }) => {
    const old = deferred<ResourceCatalog>();
    const run = deferred<CommandReceipt>();
    const load = async (address: { sessionId: string }) =>
      address.sessionId === 'one' ? old.promise : catalog(address.sessionId);
    const base = {
      connectionEpoch: 4,
      load,
      run: async () => run.promise,
      selectSkill: () => {},
    };
    await render({ ...base, address: { endpoint: 'pi', sessionId: 'one' } });
    await render({ ...base, address: { endpoint: 'pi', sessionId: 'two' } });
    await act(async () =>
      old.resolve({
        ...catalog(),
        commands: [
          {
            name: 'stale',
            title: 'Stale',
            description: '',
            argumentHint: null,
            supportsAttachments: false,
          },
        ],
      }),
    );
    assert.doesNotMatch(container.textContent!, /Stale/);
    await act(async () => button('/review — Review').click());
    await act(async () => button('执行命令').click());
    await render({ ...base, address: { endpoint: 'pi', sessionId: 'three' } });
    await act(async () => run.reject(new Error('old command failed')));
    assert.doesNotMatch(container.textContent!, /old command failed/);
    assert.equal(container.querySelector('textarea'), null);
  });
});

test('wrong-session catalog and read-only command authority do not enable execution', async () => {
  await fixture(async ({ render, button, container }) => {
    let calls = 0;
    const base = {
      address: { endpoint: 'pi', sessionId: 'one' },
      connectionEpoch: 4,
      run: async () => {
        calls++;
        return { commandId: 'x', accepted: true as const, text: null };
      },
      selectSkill: () => {},
    };
    await render({ ...base, load: async () => catalog('other') });
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /会话来源已变化/,
    );
    await render({
      ...base,
      load: async () => ({ ...catalog(), canRunCommands: false }),
    });
    await act(async () => button('/review — Review').click());
    assert.equal(button('执行命令').disabled, true);
    await act(async () => button('执行命令').click());
    assert.equal(calls, 0);
  });
});

const digest = 'sha256-' + 'a'.repeat(64);
function toolCatalog(sessionId = 'one'): ToolCatalog {
  return {
    endpointId: 'pi',
    sessionId,
    connectionEpoch: 4,
    catalogDigest: digest,
    tools: [
      {
        name: 'read',
        description: 'Read project text',
        arguments: { type: 'object', properties: { path: { type: 'string' } } },
        availability: 'always',
        backend: 'worker',
        effect: 'read-only',
        source: { kind: 'builtin' },
      },
    ],
  };
}
function skillResource(uri: string, mimeType = 'text/markdown'): SkillResource {
  return {
    uri,
    name: uri,
    mimeType,
    reference: {
      kind: 'skill',
      sessionId: 'one',
      name: 'audit',
      contentDigest: 'b'.repeat(64),
    },
  };
}

test('tools inspect source, schema and effects without invoking and reject stale catalog resolutions', async () => {
  await fixture(async ({ render, button, container }) => {
    let runs = 0;
    let resolves = 0;
    let stale = false;
    const base: ResourcePickerProps = {
      address: { endpoint: 'pi', sessionId: 'one' },
      connectionEpoch: 4,
      load: async () => catalog(),
      run: async () => {
        runs++;
        return { commandId: 'unused', accepted: true, text: null };
      },
      selectSkill: () => {},
      tools: {
        load: async () => toolCatalog(),
        resolve: async () => {
          resolves++;
          return {
            ...toolCatalog(),
            tool: toolCatalog().tools[0],
            catalogDigest: stale ? 'sha256-' + 'c'.repeat(64) : digest,
          };
        },
      },
    };
    await render(base);
    await act(async () => button('工具目录').click());
    await act(async () => button('read').click());
    assert.match(container.querySelector('article')!.textContent!, /builtin/);
    assert.match(container.querySelector('article')!.textContent!, /read-only/);
    assert.match(container.querySelector('article')!.textContent!, /path/);
    stale = true;
    await act(async () => button('read').click());
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /目录已变化/,
    );
    assert.equal(container.querySelector('article'), null);
    assert.equal(resolves, 2);
    assert.equal(runs, 0);
    const pending = deferred<ToolResolution>();
    await render({
      ...base,
      tools: { load: base.tools!.load, resolve: async () => pending.promise },
    });
    await act(async () => button('read').click());
    await render({
      ...base,
      address: { endpoint: 'pi', sessionId: 'two' },
      load: async () => catalog('two'),
    });
    await act(async () =>
      pending.resolve({ ...toolCatalog(), tool: toolCatalog().tools[0] }),
    );
    assert.equal(
      container.querySelector('article'),
      null,
      'late tool details do not cross sessions',
    );
    assert.equal(runs, 0);
  });
});

test('skill resources render Markdown and binary facts read-only and stop after stale pagination', async () => {
  await fixture(async ({ render, button, container }) => {
    const markdown = skillResource('SKILL.md');
    const binary = skillResource('sample.bin', 'application/octet-stream');
    const pages: Array<string | undefined> = [];
    const readCalls: string[] = [];
    const page: SkillResourcePage = {
      endpointId: 'pi',
      sessionId: 'one',
      connectionEpoch: 4,
      items: [markdown, binary],
      next: 'opaque-generation:2',
    };
    const props: ResourcePickerProps = {
      address: { endpoint: 'pi', sessionId: 'one' },
      connectionEpoch: 4,
      load: async () => catalog(),
      run: async () => ({ commandId: 'unused', accepted: true, text: null }),
      selectSkill: () => {},
      resources: {
        list: async (_, __, after) => {
          pages.push(after);
          if (after) throw new Error('resource-stale: generation changed');
          return page;
        },
        read: async (_, __, resource): Promise<SkillResourceRead> => {
          readCalls.push(resource.uri);
          return {
            endpointId: 'pi',
            sessionId: 'one',
            connectionEpoch: 4,
            reference: resource.reference,
            uri: resource.uri,
            content:
              resource.uri === 'SKILL.md'
                ? {
                    kind: 'text',
                    text: '# Resource guide\n\nRead the guide.',
                    mimeType: 'text/markdown',
                  }
                : {
                    kind: 'binary',
                    blobBase64: 'PRIVATE_BINARY_SENTINEL',
                    mimeType: 'application/octet-stream',
                  },
          };
        },
      },
    };
    await render(props);
    await act(async () => button('Skill 资源').click());
    await act(async () => button('SKILL.md').click());
    assert.equal(
      container.querySelector('article h1')!.textContent,
      'Resource guide',
    );
    assert.equal(container.querySelector('textarea'), null);
    await act(async () => button('sample.bin').click());
    assert.match(
      container.querySelector('article')!.textContent!,
      /二进制内容/,
    );
    assert.doesNotMatch(container.textContent!, /PRIVATE_BINARY_SENTINEL/);
    assert.equal(container.querySelector('textarea'), null);
    await act(async () => button('加载更多资源').click());
    assert.match(
      container.querySelector('[role="alert"]')!.textContent!,
      /resource-stale/,
    );
    assert.equal(button('加载更多资源').disabled, true);
    await act(async () => button('加载更多资源').click());
    assert.deepEqual(pages, [undefined, 'opaque-generation:2']);
    assert.deepEqual(readCalls, ['SKILL.md', 'sample.bin']);
  });
});
