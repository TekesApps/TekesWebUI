/** Incremental presentation metadata only: text is never queued or truncated. */
export const revealDuration = 320;
export const revealStagger = 60;
export interface RevealRange {
  start: number;
  end: number;
  at: number;
}
export interface RevealSnapshot {
  text: string;
  ranges: RevealRange[];
}
export function advanceReveal(
  previous: RevealSnapshot,
  text: string,
  now: number,
  animate: boolean,
): RevealSnapshot {
  if (!text.startsWith(previous.text)) return { text, ranges: [] };
  let ranges = previous.ranges.filter(
    (range) => now - range.at < revealDuration + revealStagger,
  );
  if (animate && text.length > previous.text.length) {
    // Bound the animated tail, including large coalesced network frames.
    const tail = Array.from(segmenter.segment(text)).filter(
      (part) => part.index + part.segment.length > previous.text.length,
    );
    const start = tail.slice(-120)[0]?.index ?? text.length;
    // A network frame can complete an emoji, combining mark or ZWJ sequence.
    // Move the entire grapheme into its new range rather than splitting a glyph.
    ranges = ranges
      .map((range) => ({ ...range, end: Math.min(range.end, start) }))
      .filter((range) => range.start < range.end);
    ranges.push({ start, end: text.length, at: now });
  }
  return { text, ranges: ranges.slice(-4) };
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}
