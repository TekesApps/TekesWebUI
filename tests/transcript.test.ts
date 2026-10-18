import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Transcript } from '../src/components/Transcript';
import {
  toolFamilies,
  toolRole,
  toolState,
  toolSummary,
  partitionTurn,
  thinkingStatus,
} from '../src/transcript';
import { toolIcons } from '../src/components/ui/ToolIcon';
import type { Item, Tool, View } from '../src/types';
const item = (kind: string, text: string, rest: Partial<Item> = {}): Item => ({
  id: kind,
  turnId: 'turn',
  kind,
  text,
  isVisible: true,
  isFinal: false,
  isProvisional: false,
  ...rest,
});
const tool = (
  name: string,
  phase = 'done',
  rest: Partial<Tool> = {},
): Tool => ({ id: name, turnId: 'turn', name, phase, arguments: {}, ...rest });
function view(items: Item[], tools: Tool[] = [], phase = 'idle'): View {
  return {
    endpoint: 'endpoint',
    sessionId: 'session',
    run: {
      phase,
      canSubmit: true,
      canCancel: phase === 'running',
      connection: { phase: 'connected' },
      actionables: [],
      queue: [],
    },
    transcript: { items, tools, hasMoreBefore: false, isStale: false },
  };
}

test('every ClientKit semantic role and unknown fallback has a browser glyph', () => {
  for (const [name, role] of Object.entries(toolFamilies)) {
    assert.equal(toolRole(name), role);
    assert.ok(toolIcons[role]);
  }
  assert.equal(toolRole('shell.run'), 'shell');
  assert.equal(toolRole('terminal_open'), 'shell');
  assert.equal(toolRole('schedule_create'), 'job');
  assert.equal(toolRole('mcp__custom__widget'), 'unknown');
  assert.ok(toolIcons.unknown);
});
test('terminal state never restarts old activity; failures and nonzero exits are not successful', () => {
  for (const phase of ['done', 'completed', 'succeeded'])
    assert.equal(toolState(tool('read', phase), true), 'ok');
  for (const phase of ['interrupted', 'stopped', 'cancelled'])
    assert.equal(toolState(tool('shell', phase), true), 'stopped');
  assert.equal(toolState(tool('shell', 'running'), false), 'stopped');
  assert.equal(toolState(tool('shell', 'doing'), true), 'running');
  assert.equal(
    toolState(
      tool('shell', 'done', { result: { output: 'bad', exitCode: 2 } }),
      true,
    ),
    'error',
  );
  assert.equal(
    toolState(
      tool('shell', 'done', { result: 'stdout\n[exit code: 1]' }),
      true,
    ),
    'error',
  );
  assert.equal(
    toolState(tool('read', 'done', { result: { isError: true } }), true),
    'error',
  );
});
test('collapsed tool summaries are input-derived and never arbitrary stdout or private fields', () => {
  assert.equal(
    toolSummary(
      tool('read', 'done', {
        arguments: { path: '/workspace/test.ts' },
        result: 'random stdout',
      }),
    ),
    '/workspace/test.ts',
  );
  assert.equal(
    toolSummary(
      tool('unknown', 'done', { arguments: { secret: 'PRIVATE_SENTINEL' } }),
    ),
    undefined,
  );
  assert.equal(
    toolSummary(
      tool('shell', 'done', {
        arguments: { description: '检查项目\nextra', command: 'pwd' },
      }),
    ),
    '检查项目',
  );
});
test('final output stays outside process; narration and nonfinal tool-associated assistant text stay inside', () => {
  const input = item('user', 'input'),
    narration = item('assistant', 'checking'),
    answer = item('assistant', 'answer', { id: 'final', isFinal: true }),
    system = item('system', 'prompt');
  const parts = partitionTurn(
    [system, input, narration, answer],
    [tool('read')],
  );
  assert.deepEqual(parts.inputs, [input]);
  assert.deepEqual(parts.output, [answer]);
  assert.deepEqual(parts.activity, [system, narration]);
});
test('thinking prose is absent from both live and historical HTML, including reasoning-only rows', () => {
  for (const phase of ['running', 'idle']) {
    const model = view(
      [
        item('user', 'hello'),
        item('assistant', 'answer', {
          reasoning: 'PRIVATE_REASONING_SENTINEL',
          isFinal: true,
        }),
        item('reasoning', 'PRIVATE_REASONING_SENTINEL'),
      ],
      [],
      phase,
    );
    const html = renderToStaticMarkup(
      createElement(Transcript, { view: model }),
    );
    assert.ok(!html.includes('PRIVATE_REASONING_SENTINEL'));
    assert.ok(!html.includes('思考过程'));
    assert.ok(!html.includes('thinking'));
  }
  const live = view(
    [
      item('assistant', '', {
        reasoning: 'PRIVATE_REASONING_SENTINEL',
        isProvisional: true,
      }),
    ],
    [],
    'running',
  );
  assert.equal(thinkingStatus(live), true);
  const html = renderToStaticMarkup(createElement(Transcript, { view: live }));
  assert.ok(html.includes('正在思考'));
  assert.ok(!html.includes('PRIVATE_REASONING_SENTINEL'));
  assert.ok(!html.includes('message-author'));
});
test('information classes keep literal text; tools retain full inputs and outputs on disclosure', () => {
  const html = renderToStaticMarkup(
    createElement(Transcript, {
      view: view(
        [
          item('system', 'system **literal**'),
          item('notice', 'notice /path_with_underlines'),
          item('error', 'failed **literal**'),
          item('assistant', 'final', { isFinal: true }),
        ],
        [
          tool('read', 'done', {
            arguments: { path: 'test.ts', offset: 3 },
            result: 'file contents',
          }),
        ],
      ),
    }),
  );
  assert.ok(html.includes('系统提示'));
  assert.ok(html.includes('transcript-notice failure'));
  assert.ok(html.includes('failed **literal**'));
  assert.ok(html.includes('offset'));
  assert.ok(html.includes('file contents'));
  assert.ok(html.includes('data-tool-role="read"'));
  assert.ok(!html.includes('mini-mark'));
});

test('assistant transcript retains time without a Harness initial box or brand label', () => {
  const html = renderToStaticMarkup(
    createElement(Transcript, {
      view: view([
        item('assistant', '答案', { isFinal: true, time: 1792292400 }),
      ]),
    }),
  );
  assert.ok(html.includes('message-time'));
  assert.ok(!html.includes('mini-mark'));
  assert.ok(!html.includes('>T<'));
  assert.ok(!/>Tekes</.test(html));
});
