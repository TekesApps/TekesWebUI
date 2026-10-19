import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { Transcript } from '../src/components/Transcript';
import {
  toolFamilies,
  toolRole,
  toolState,
  toolSummary,
  partitionTurn,
  thinkingStatus,
  liveOutputTokens,
  reportedOutputUsage,
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

test('running phases show only the orbit unless thinking, while real tool rows remain visible', () => {
  for (const model of [
    view([item('user', 'hello')], [], 'running'),
    view([item('assistant', 'partial answer')], [], 'running'),
    view(
      [item('assistant', '', { reasoning: 'private', reasoningEnded: true })],
      [],
      'running',
    ),
    view(
      [item('user', 'hello')],
      [tool('read', 'doing', { arguments: { path: 'README.md' } })],
      'running',
    ),
  ]) {
    const html = renderToStaticMarkup(
      createElement(Transcript, { view: model }),
    );
    assert.ok(html.includes('working-orbit'));
    assert.ok(!html.includes('working-label'));
    assert.ok(!html.includes('正在工作'));
    assert.ok(!html.includes('working-dots'));
    if (model.transcript!.tools.length) assert.ok(html.includes('README.md'));
  }
});

test('output counter follows real reports only and hides unavailable, stale and other-turn counts', () => {
  const model = view(
    [item('assistant', 'Long text is never counted as tokens')],
    [],
    'running',
  );
  model.transcript!.turns = [{ id: 'turn', status: 'running', input: '' }];
  assert.equal(liveOutputTokens(model), undefined);
  assert.ok(
    !renderToStaticMarkup(createElement(Transcript, { view: model })).includes(
      'working-tokens',
    ),
  );
  for (const count of [0, 7, 7, 1234]) {
    model.transcript!.turns[0].liveUsage = { outputTokens: count };
    model.transcript!.turns[0].reportedUsage = {
      outputTokens: count,
      isComplete: true,
    };
    assert.equal(liveOutputTokens(model), count);
    const html = renderToStaticMarkup(
      createElement(Transcript, { view: model }),
    );
    assert.equal(html.includes('working-tokens'), count > 0);
    assert.ok(!html.includes('≈'));
    assert.ok(!html.includes('正在工作'));
  }
  for (const count of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    model.transcript!.turns[0].liveUsage = { outputTokens: count };
    assert.equal(liveOutputTokens(model), undefined);
  }
  model.transcript!.turns[0].liveUsage = { outputTokens: 100 };
  model.transcript!.isStale = true;
  assert.equal(liveOutputTokens(model), undefined);
  model.transcript!.isStale = false;
  model.run.connection.phase = 'disconnected';
  assert.equal(liveOutputTokens(model), undefined);
  model.run.connection.phase = 'connected';
  model.run.phase = 'idle';
  assert.equal(liveOutputTokens(model), undefined);
  model.run.phase = 'running';
  model.transcript!.turns.push({ id: 'next', status: 'running', input: '' });
  assert.equal(liveOutputTokens(model), undefined);
});

test('thinking resumes after completed tools only for an active reasoning preview', () => {
  const model = view(
    [item('assistant', '', { reasoning: 'hidden', isProvisional: true })],
    [tool('read', 'done')],
    'running',
  );
  assert.equal(thinkingStatus(model), true);
  model.transcript!.tools[0].phase = 'doing';
  assert.equal(thinkingStatus(model), false);
  model.transcript!.tools[0].phase = 'done';
  model.transcript!.items[0].isProvisional = false;
  assert.equal(thinkingStatus(model), false);
});

test('ClientKit token footnotes appear only on the live run, compact thousands and hide zero', () => {
  const model = view([item('assistant', 'completed', { isFinal: true })]);
  model.transcript!.turns = [
    {
      id: 'turn',
      status: 'completed',
      input: '',
      reportedUsage: { outputTokens: 12400, isComplete: true },
    },
  ];
  const html = () =>
    renderToStaticMarkup(createElement(Transcript, { view: model }));
  const text = () => new JSDOM(html()).window.document.body.textContent || '';
  // Facts remain available to all consumers, but settled transcripts do not show token badges.
  assert.equal(reportedOutputUsage(model, 'turn')?.outputTokens, 12400);
  for (const phase of [
    'idle',
    'completed',
    'failed',
    'cancelled',
    'waitingForInput',
  ]) {
    model.run.phase = phase;
    assert.ok(!html().includes('working-tokens'));
  }
  model.run.phase = 'running';
  assert.ok(!html().includes('working-tokens')); // control update before the next journal turn
  model.transcript!.turns[0].status = 'running';
  assert.ok(text().includes('12.4k tokens'));
  assert.ok(!text().includes('输出'));
  model.run.connection.phase = 'disconnected';
  model.transcript!.isStale = true;
  assert.ok(!html().includes('working-tokens'));
  assert.equal(reportedOutputUsage(model, 'turn')?.outputTokens, 12400);
  model.run.connection.phase = 'connected';
  model.transcript!.isStale = false;
  assert.ok(text().includes('12.4k tokens'));
  model.transcript!.turns.push({ id: 'new', status: 'running', input: '' });
  assert.ok(!html().includes('working-tokens')); // never reuse another turn's count
  model.transcript!.turns.pop();
  model.transcript!.turns[0].reportedUsage = {
    outputTokens: 17,
    isComplete: false,
  };
  assert.ok(text().includes('已记录 17 tokens'));
  model.transcript!.turns[0].reportedUsage = {
    outputTokens: 0,
    isComplete: true,
  };
  assert.ok(!html().includes('working-tokens'));
  for (const count of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    model.transcript!.turns[0].reportedUsage = {
      outputTokens: count,
      isComplete: true,
    };
    assert.equal(reportedOutputUsage(model, 'turn'), undefined);
    assert.ok(!html().includes('working-tokens'));
  }
});

test('live answer is outside tools before finality; explicit tool narration stays inside', () => {
  const toolCalls = [tool('read')];
  const narration = item('assistant', 'reading', {
    metadata: { hasToolCalls: true },
  });
  const answer = item('assistant', 'answer streaming', {
    isFinal: false,
    isProvisional: true,
  });
  let parts = partitionTurn([narration, answer], toolCalls, true);
  assert.deepEqual(parts.output, [answer]);
  assert.deepEqual(parts.activity, [narration]);
  answer.isProvisional = false;
  parts = partitionTurn([narration, answer], toolCalls, true);
  assert.deepEqual(parts.output, [answer]);
  answer.isFinal = true;
  assert.deepEqual(
    partitionTurn([narration, answer], toolCalls, false).output,
    [answer],
  );
  answer.isFinal = false;
  answer.metadata = { sessionFinal: false };
  assert.deepEqual(
    partitionTurn([narration, answer], toolCalls, true).output,
    [],
  );
  answer.metadata = { stopReason: 'toolUse' };
  assert.deepEqual(
    partitionTurn([narration, answer], toolCalls, true).output,
    [],
  );
});

test('historical errors show only their original text without later recovery decoration', () => {
  const message = 'The worker could not be started: worker hello timed out';
  const render = (status: string) =>
    renderToStaticMarkup(
      createElement(Transcript, {
        view: view([
          item('notice', message, {
            metadata: { classification: 'worker_launch', status },
          }),
        ]),
      }),
    );
  const html = render('recovered');
  const dom = new JSDOM(html);
  assert.equal(
    dom.window.document.querySelector('[role="note"]')!.textContent,
    message,
  );
  assert.equal(html, render('error'));
  assert.ok(!html.includes('已恢复'));
  assert.ok(!html.includes('transcript-notice recovered'));
});

test('session errors stay between their original turns as later turns arrive and recovery changes', () => {
  const message = 'The worker could not be started: worker hello timed out';
  const history = [
    item('user', 'first input', { id: 'u1', turnId: 't1', sourceSequence: 10 }),
    item('assistant', 'first answer', {
      id: 'a1',
      turnId: 't1',
      sourceSequence: 11,
      isFinal: true,
    }),
    item('notice', message, {
      id: 'notice:12',
      turnId: '',
      sourceSequence: 12,
      metadata: { status: 'error' },
    }),
    item('user', 'second input', {
      id: 'u2',
      turnId: 't2',
      sourceSequence: 14,
    }),
    item('assistant', 'second answer', {
      id: 'a2',
      turnId: 't2',
      sourceSequence: 15,
      isFinal: true,
    }),
  ];
  const rendered = (items: Item[], turns: string[]) => {
    const v = view(items);
    v.transcript!.turns = turns.map((id) => ({
      id,
      status: 'completed',
      input: '',
    }));
    const dom = new JSDOM(
      renderToStaticMarkup(createElement(Transcript, { view: v })),
    );
    return [
      ...dom.window.document.querySelectorAll(
        '.message [data-annotation-text], .transcript-notice',
      ),
    ].map((node) => node.textContent?.trim());
  };
  const expected = [
    'first input',
    'first answer',
    message,
    'second input',
    'second answer',
  ];
  assert.deepEqual(rendered(history, ['t1', 't2']), expected);
  const recovered = history.map((i) =>
    i.id === 'notice:12'
      ? { ...i, metadata: { status: 'recovered', recoveredAtSequence: 999 } }
      : i,
  );
  const later = [
    ...recovered,
    item('user', 'third input', { id: 'u3', turnId: 't3', sourceSequence: 20 }),
    item('assistant', 'third answer', {
      id: 'a3',
      turnId: 't3',
      sourceSequence: 21,
      isFinal: true,
    }),
  ];
  const order = rendered(later, ['t1', 't2', 't3']);
  assert.equal(order.length, 7);
  assert.ok(order[2]!.includes(message));
  assert.equal(order[2], message);
  assert.deepEqual(order.slice(3), [
    'second input',
    'second answer',
    'third input',
    'third answer',
  ]);
  // Reconnection and prepending earlier history retain the same event position.
  assert.deepEqual(
    rendered(JSON.parse(JSON.stringify(later)), ['t1', 't2', 't3']),
    order,
  );
  const older = item('assistant', 'older answer', {
    id: 'a0',
    turnId: 't0',
    sourceSequence: 1,
    isFinal: true,
  });
  assert.deepEqual(
    rendered([older, ...later], ['t0', 't1', 't2', 't3']).slice(1),
    order,
  );
});

test('unassigned inputs and multiple session notices retain occurrence order before, inside and after turns', () => {
  const rows = [
    item('notice', 'before history', {
      id: 'n0',
      turnId: '',
      sourceSequence: 1,
    }),
    item('user', 'input', { id: 'u', sourceSequence: 2 }),
    item('notice', 'during turn', { id: 'n1', turnId: '', sourceSequence: 3 }),
    item('assistant', 'answer', { id: 'a', sourceSequence: 4, isFinal: true }),
    item('user', 'failed input', {
      id: 'pending',
      turnId: '',
      sourceSequence: 5,
    }),
    item('notice', 'failure one', { id: 'n2', turnId: '', sourceSequence: 6 }),
    item('notice', 'failure two', { id: 'n3', turnId: '', sourceSequence: 7 }),
  ];
  for (const items of [
    rows,
    rows.map(({ sourceSequence: _, ...row }) => row),
  ]) {
    const v = view(items);
    v.transcript!.turns = [{ id: 'turn', status: 'completed', input: '' }];
    const dom = new JSDOM(
      renderToStaticMarkup(createElement(Transcript, { view: v })),
    );
    const text = dom.window.document.body.textContent!;
    let previous = -1;
    for (const row of rows) {
      const position = text.indexOf(row.text);
      assert.ok(
        position > previous,
        `${row.text} should follow its preceding event`,
      );
      previous = position;
    }
    assert.equal(
      dom.window.document.querySelectorAll('.transcript-notice').length,
      4,
    );
  }
});
