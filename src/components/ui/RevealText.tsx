import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import {
  advanceReveal,
  graphemes,
  revealDuration,
  revealStagger,
  type RevealSnapshot,
} from '../../motion';

export const TextMotion = createContext({ streaming: false, fresh: false });

/** Animate appended graphemes without delaying authoritative text or replaying its prefix. */
export function RevealText({ text }: { text: string }) {
  const { streaming, fresh } = useContext(TextMotion);
  const [snapshot, setSnapshot] = useState<RevealSnapshot>(() =>
    advanceReveal(
      { text: '', ranges: [] },
      text,
      Date.now(),
      streaming && fresh,
    ),
  );
  let current = snapshot;
  if (text !== snapshot.text) {
    current = advanceReveal(snapshot, text, Date.now(), streaming);
    setSnapshot(current);
  }
  useEffect(() => {
    if (!snapshot.ranges.length) return;
    const expires = Math.min(
      ...snapshot.ranges.map((r) => r.at + revealDuration + revealStagger),
    );
    const timer = setTimeout(
      () =>
        setSnapshot((previous) =>
          advanceReveal(previous, previous.text, Date.now(), false),
        ),
      Math.max(1, expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [snapshot]);
  if (!current.ranges.length) return text;
  let offset = 0;
  const parts = current.ranges.flatMap((range) => {
    const prefix = text.slice(offset, range.start);
    offset = range.end;
    const units = graphemes(text.slice(range.start, range.end));
    // Group three graphemes per span; long responses do not accumulate per-character DOM.
    const groups = Array.from({ length: Math.ceil(units.length / 3) }, (_, i) =>
      units.slice(i * 3, i * 3 + 3).join(''),
    );
    let position = range.start;
    return [
      prefix,
      ...groups.map((group, index) => {
        const key = position;
        position += group.length;
        return (
          <span
            key={key}
            className="text-reveal"
            style={
              {
                '--reveal-delay': `${Math.round((index / Math.max(1, groups.length - 1)) * revealStagger)}ms`,
              } as CSSProperties
            }
          >
            {group}
          </span>
        );
      }),
    ];
  });
  return (
    <>
      {parts}
      {text.slice(offset)}
    </>
  );
}
