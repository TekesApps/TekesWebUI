import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceReveal,
  graphemes,
  revealDuration,
  revealStagger,
} from '../src/motion';

test('history is immediately visible and only an appended suffix gets reveal metadata', () => {
  const history = advanceReveal({ text: '', ranges: [] }, '历史段落', 0, false);
  assert.deepEqual(history.ranges, []);
  const next = advanceReveal(history, '历史段落，新增内容', 100, true);
  assert.deepEqual(next.ranges, [{ start: 4, end: 9, at: 100 }]);
  assert.equal(next.text, '历史段落，新增内容');
});
test('reconciliation rewrites are shown immediately without replaying the paragraph', () => {
  const before = advanceReveal(
    { text: '旧内容', ranges: [] },
    '旧内容加字',
    0,
    true,
  );
  assert.deepEqual(advanceReveal(before, '校正后的内容', 20, true), {
    text: '校正后的内容',
    ranges: [],
  });
});
test('animation metadata expires and is bounded across large and rapid frames', () => {
  let state = { text: '', ranges: [] } as ReturnType<typeof advanceReveal>;
  for (let i = 0; i < 12; i++)
    state = advanceReveal(state, state.text + '字'.repeat(500), i, true);
  assert.equal(state.text.length, 6000);
  assert.equal(state.ranges.length, 4);
  assert.ok(state.ranges.every((range) => range.end - range.start <= 120));
  assert.deepEqual(
    advanceReveal(state, state.text, 12 + revealDuration + revealStagger, false)
      .ranges,
    [],
  );
});
test('grapheme boundaries survive split emoji, combining marks and ZWJ network frames', () => {
  for (const [before, after] of [
    ['A\ud83d', 'A😀'],
    ['e', 'e\u0301'],
    ['👩', '👩‍💻'],
  ]) {
    const initial = advanceReveal({ text: '', ranges: [] }, before!, 0, true);
    const state = advanceReveal(initial, after!, 1, true);
    const range = state.ranges.at(-1)!;
    assert.equal(graphemes(state.text.slice(range.start, range.end)).length, 1);
    assert.equal(
      state.ranges.slice(0, -1).some((old) => old.end > range.start),
      false,
    );
  }
});
test('reduced-motion policy can admit all text without adding animation work', () => {
  assert.deepEqual(
    advanceReveal({ text: '前文', ranges: [] }, '前文和新增文字', 100, false),
    { text: '前文和新增文字', ranges: [] },
  );
});
