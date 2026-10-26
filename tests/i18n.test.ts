import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, readdir } from 'node:fs/promises';
import { parsers } from 'prettier/plugins/typescript';
import english from '../src/locales/en.json';
import { detectLocale, setLocale, t, tContext } from '../src/i18n';
import App from '../src/App';
import { Workspace } from '../src/workspace';
import { Transcript } from '../src/components/Transcript';
import type { View } from '../src/types';

test('language selection, interpolation and saved interface notices switch without touching payloads', () => {
  assert.equal(detectLocale(null, 'zh-TW'), 'zh-CN');
  assert.equal(detectLocale(null, 'en-GB'), 'en');
  assert.equal(detectLocale('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(detectLocale('en', 'zh-CN'), 'en');
  try {
    setLocale('en');
    assert.equal(t('未运行'), 'Not running');
    assert.equal(tContext('threadAction', '置顶'), 'Pin');
    assert.equal(t('置顶'), 'Pinned');
    assert.equal(
      t('会话操作：{0}', '中文 project'),
      'Chat actions: 中文 project',
    );
    assert.equal(t('上传附件 2/3'), 'Uploading attachment 2/3');
    const html = renderToStaticMarkup(
      createElement(App, { workspace: new Workspace() }),
    );
    assert.match(html, /Connect to your workspace/);
    assert.match(html, /Language/);
    assert.match(html, /Browser access token/);
    assert.doesNotMatch(html, /连接到你的工作空间|浏览器访问令牌|会话列表选项/);
    setLocale('zh-CN');
    assert.equal(t('Uploading attachment 2/3'), '上传附件 2/3');
    assert.equal(t('未运行'), '未运行');
  } finally {
    setLocale('zh-CN');
  }
});

test('English transcript chrome preserves original message and quotation text', () => {
  const view: View = {
    endpoint: 'e',
    sessionId: 's',
    run: {
      scope: { endpointId: 'e', threadId: 's', sessionId: 's' },
      jobs: [],
      phase: 'idle',
      canSubmit: true,
      canCancel: false,
      connection: {
        phase: 'connected',
        canSubmit: true,
        historyIsStale: false,
      },
      actionables: [],
      queue: [],
    },
    transcript: {
      items: [
        {
          id: 'u',
          kind: 'user',
          turnId: 't',
          text: '未运行：这是中文原文，不应该被翻译。',
          isVisible: true,
          isFinal: true,
          isProvisional: false,
        },
        {
          id: 'a',
          kind: 'assistant',
          turnId: 't',
          text: '中文回复保持原样。',
          isVisible: true,
          isFinal: true,
          isProvisional: false,
        },
      ],
      tools: [],
      hasMoreBefore: false,
      isStale: false,
    },
  };
  try {
    setLocale('en');
    const html = renderToStaticMarkup(createElement(Transcript, { view }));
    assert.match(html, /未运行：这是中文原文，不应该被翻译。/);
    assert.match(html, /Copy content/);
  } finally {
    setLocale('zh-CN');
  }
});

test('every static translation call has English copy and preserves interpolation placeholders', async () => {
  const dictionary: Record<string, string> = english;
  const tokens = (value: string) =>
    [...new Set(value.match(/\{\d+\}/g) || [])].sort();
  for (const [key, value] of Object.entries(dictionary)) {
    assert.ok(value.trim(), key);
    assert.deepEqual(tokens(key), tokens(value), key);
  }
  const files = (
    await readdir(new URL('../src/', import.meta.url), { recursive: true })
  ).filter((name) => /\.tsx?$/.test(name));
  for (const file of files) {
    const source = await readFile(
      new URL('../src/' + file, import.meta.url),
      'utf8',
    );
    const ast = (await parsers.typescript.parse(source, {
      filepath: file,
    } as Parameters<typeof parsers.typescript.parse>[1])) as unknown;
    function visit(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const value = node as Record<string, unknown>;
      if (
        value.type === 'CallExpression' &&
        (value.callee as { name?: string })?.name === 't'
      ) {
        const arg = (
          value.arguments as { type?: string; value?: unknown }[]
        )[0];
        if (arg?.type === 'Literal' && typeof arg.value === 'string')
          assert.ok(
            Object.hasOwn(dictionary, arg.value),
            `${file}: ${arg.value}`,
          );
      }
      for (const [key, child] of Object.entries(value))
        if (!['loc', 'range', 'tokens', 'comments'].includes(key)) {
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
    }
    visit(ast);
  }
});
