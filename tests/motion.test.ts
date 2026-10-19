import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialTyping,
  admitTyping,
  tickTyping,
  flushTyping,
  maxTypingTail,
  graphemes,
} from '../src/motion';

test('history is immediate; appended text advances a real visible frontier without changing source', () => {
  const history = initialTyping('历史段落', 0, false);
  assert.equal(history.visible, 4);
  const next = admitTyping(history, '历史段落，新增内容', 100, true);
  assert.equal(next.visible, 4);
  const first = tickTyping(next, 116);
  assert.ok(first.visible > 4 && first.visible < next.text.length);
  assert.equal(first.text, '历史段落，新增内容');
});
test('reconciliation rewrites are immediate and settled responses can finish a pending tail', () => {
  const live = initialTyping('旧内容', 0, true);
  const final = admitTyping(live, '旧内容追加', 10, false);
  assert.equal(final.visible, 0);
  assert.equal(tickTyping(final, 1000).visible, final.text.length);
  const rewrite = admitTyping(live, '校正后的内容', 20, true);
  assert.equal(rewrite.visible, rewrite.text.length);
});
test('large and rapid network frames bound the typing tail and catch up without an indefinite queue', () => {
  let state = initialTyping('', 0, false);
  for (let i = 0; i < 12; i++) {
    state = admitTyping(state, state.text + '字'.repeat(500), i, true);
    const index = state.boundaries.indexOf(state.visible);
    assert.ok(state.boundaries.length - 1 - index <= maxTypingTail);
  }
  assert.equal(state.text.length, 6000);
  let now = 12;
  while (state.visible < state.text.length && now < 1000) {
    now += 16;
    state = tickTyping(state, now);
  }
  assert.equal(state.visible, 6000);
  assert.ok(now < 650, 'burst should settle in less than 650 ms');
});
test('typing never splits combined glyphs, emoji or a ZWJ sequence', () => {
  for (const [before, after] of [
    ['A\ud83d', 'A😀'],
    ['e', 'e\u0301'],
    ['👩', '👩‍💻'],
  ]) {
    let state = admitTyping(initialTyping(before, 0, false), after, 1, true);
    assert.ok(state.boundaries.includes(state.visible));
    for (let now = 17; state.visible < after.length; now += 16) {
      state = tickTyping(state, now);
      assert.ok(state.boundaries.includes(state.visible));
      assert.equal(
        graphemes(state.text.slice(0, state.visible)).join(''),
        state.text.slice(0, state.visible),
      );
    }
    assert.equal(state.visible, after.length);
  }
});
test('reduced motion and backgrounding flush presentation without changing the transcript', () => {
  const live = initialTyping('新增文字', 0, true),
    flush = flushTyping(live);
  assert.equal(flush.visible, live.text.length);
  assert.equal(flush.text, live.text);
});
