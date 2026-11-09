import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import {
  PresetEditor,
  type PresetEditorProps,
} from '../src/components/PresetEditor';
import {
  presetDraftError,
  presetHasDefaults,
  presetSignature,
  type PresetDescriptionSnapshot,
  type PresetPreviewSnapshot,
  type SessionPreset,
} from '../src/session-presets';
import { getLocale, setLocale } from '../src/i18n';
const description: PresetDescriptionSnapshot = {
  endpointId: 'kernel',
  connectionEpoch: 2,
  description: {
    format: 1,
    renderVersion: 1,
    bases: [{ id: 'general' }],
    kernelLayers: [
      { kind: 'kernel', id: 'coding', version: '1', title: 'Coding' },
    ],
    limits: {
      maxLayers: 2,
      maxIdBytes: 64,
      maxVersionBytes: 32,
      maxIdentityBytes: 6,
      maxDutyBytes: 12,
      maxTextBytes: 1000,
      maxTools: 5,
      maxMcpServers: 1,
      maxMcpToolsPerServer: 2,
      maxSkills: 5,
    },
    selectableTools: ['read', 'write'],
    invalidReasons: [],
  },
};
const models = [
  {
    id: 'flash',
    provider: 'configured',
    reasoning: { efforts: [{ id: 'low' }] },
  },
];
function result(preset: SessionPreset): PresetPreviewSnapshot {
  return {
    endpointId: 'kernel',
    connectionEpoch: 2,
    preset: JSON.parse(JSON.stringify(preset)) as SessionPreset,
    resolution: {
      base: 'general',
      layers: [],
      presetText: 'Resolved exact preset',
      digest: 'sha256:proof',
      defaults: preset.defaults,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  check: (context: {
    container: HTMLElement;
    render: (props: PresetEditorProps) => Promise<void>;
    button: (label: string) => HTMLButtonElement | undefined;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = keys.map(
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
      container,
      render: (props) =>
        act(async () => root.render(createElement(PresetEditor, props))),
      button: (label) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent === label,
        ),
    });
  } finally {
    await act(async () => root.unmount());
    setLocale(locale);
    for (const [key, value] of original) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test('preset validation uses byte limits, known tools and actual model defaults', () => {
  assert.equal(
    presetDraftError(
      {
        layers: [
          { kind: 'inline', id: 'role', version: '1', identity: '角色' },
        ],
      },
      description.description,
      models,
    ),
    null,
  );
  assert.match(
    presetDraftError(
      {
        layers: [
          { kind: 'inline', id: 'role', version: '1', identity: '三个字' },
        ],
      },
      description.description,
      models,
    )!,
    /身份/,
  );
  assert.match(
    presetDraftError({ tools: ['plan'] }, description.description, models)!,
    /工具/,
  );
  assert.match(
    presetDraftError(
      { defaults: { provider: 'configured', model: 'missing' } },
      description.description,
      models,
    )!,
    /模型/,
  );
  assert.equal(
    presetHasDefaults({
      layers: [
        {
          kind: 'inline',
          id: 'role',
          version: '1',
          defaults: { provider: 'configured', model: 'flash' },
        },
      ],
    }),
    true,
  );
  assert.equal(
    presetSignature({
      tools: ['read'],
      defaults: { provider: 'configured', model: 'flash' },
    }),
    presetSignature({
      defaults: { model: 'flash', provider: 'configured' },
      tools: ['read'],
    }),
  );
});

test('preset application requires a successful unchanged preview and retains defaults', async () => {
  await fixture(async ({ container, render, button }) => {
    const preset: SessionPreset = {
      tools: ['read'],
      defaults: {
        provider: 'configured',
        model: 'flash',
        reasoningEffort: 'low',
      },
    };
    let previews = 0;
    const applied: SessionPreset[] = [];
    await render({
      endpointId: 'kernel',
      cwd: '/project',
      connectionEpoch: 2,
      describe: async () => description,
      models,
      initialPreset: preset,
      preview: async (value) => {
        previews++;
        return result(value);
      },
      onApply: (value) => applied.push(value),
    });
    assert.equal(button('用于下一次新建会话'), undefined);
    assert.match(container.textContent!, /未配置 MCP/);
    await act(async () => button('预览初始配置')!.click());
    assert.equal(previews, 1);
    assert.equal(applied.length, 0);
    await act(async () => button('用于下一次新建会话')!.click());
    assert.deepEqual(applied, [preset]);
    await act(async () => button('添加自定义层')!.click());
    assert.equal(
      button('用于下一次新建会话'),
      undefined,
      'editing invalidates the prior resolution',
    );
  });
});

test('a late preview cannot authorize a different directory and a refusal keeps the draft', async () => {
  await fixture(async ({ container, render, button }) => {
    const old = deferred<PresetPreviewSnapshot>();
    const applied: SessionPreset[] = [];
    const common = {
      endpointId: 'kernel',
      connectionEpoch: 2,
      describe: async () => description,
      models,
      onApply: (value: SessionPreset) => applied.push(value),
    };
    await render({
      ...common,
      cwd: '/first',
      initialPreset: { layers: [{ kind: 'kernel', id: 'coding' }] },
      preview: () => old.promise,
    });
    await act(async () => button('预览初始配置')!.click());
    await render({
      ...common,
      cwd: '/second',
      initialPreset: {
        layers: [
          { kind: 'inline', id: 'custom', version: '1', duty: 'keep me' },
        ],
      },
      preview: async () => {
        throw new Error('tool-not-permitted');
      },
    });
    await act(async () =>
      old.resolve(result({ layers: [{ kind: 'kernel', id: 'coding' }] })),
    );
    assert.equal(button('用于下一次新建会话'), undefined);
    assert.equal(applied.length, 0);
    assert.match(container.textContent!, /\/second/);
    await act(async () => button('预览初始配置')!.click());
    assert.match(container.textContent!, /tool-not-permitted/);
    assert.equal(container.querySelector('textarea')!.value, 'keep me');
  });
});
