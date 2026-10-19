/** Presentation frontier only. The original transcript and copy payload are never changed. */
export const maxTypingTail = 96;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string): string[] =>
  Array.from(segmenter.segment(text), (part) => part.segment);
export interface TypingSnapshot {
  text: string;
  visible: number;
  at: number;
  boundaries: number[];
}
export function initialTyping(
  text: string,
  now: number,
  animate: boolean,
): TypingSnapshot {
  const boundaries = [0];
  for (const part of segmenter.segment(text))
    boundaries.push(part.index + part.segment.length);
  return {
    text,
    boundaries,
    at: now,
    visible: animate
      ? boundaries[Math.max(0, boundaries.length - 1 - maxTypingTail)]
      : text.length,
  };
}
export function admitTyping(
  previous: TypingSnapshot,
  text: string,
  now: number,
  animate: boolean,
): TypingSnapshot {
  // Replacements are authoritative corrections, not another typing pass.
  if (
    !text.startsWith(previous.text) ||
    (!animate && previous.visible === previous.text.length)
  )
    return initialTyping(text, now, false);
  const next = initialTyping(text, now, false);
  // Appended combining marks / ZWJ sequences can change the final grapheme boundary.
  const aligned =
    next.boundaries.filter((end) => end <= previous.visible).at(-1) || 0;
  next.visible = Math.max(
    aligned,
    next.boundaries[Math.max(0, next.boundaries.length - 1 - maxTypingTail)],
  );
  next.at = previous.visible < previous.text.length ? previous.at : now;
  return next;
}
export function tickTyping(
  previous: TypingSnapshot,
  now: number,
): TypingSnapshot {
  const index = previous.boundaries.indexOf(previous.visible);
  const pending = previous.boundaries.length - 1 - index;
  if (!pending) return previous;
  // Modest packets type steadily; coalesced bursts catch up instead of building a long queue.
  const rate = Math.max(90, pending / 0.16);
  const count = Math.floor((Math.max(0, now - previous.at) * rate) / 1000);
  if (!count) return previous;
  return {
    ...previous,
    visible:
      previous.boundaries[
        Math.min(index + count, previous.boundaries.length - 1)
      ],
    at: now,
  };
}
export const flushTyping = (snapshot: TypingSnapshot): TypingSnapshot =>
  snapshot.visible === snapshot.text.length
    ? snapshot
    : { ...snapshot, visible: snapshot.text.length };
