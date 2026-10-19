import { useEffect, useState } from 'react';
import {
  admitTyping,
  initialTyping,
  tickTyping,
  flushTyping,
} from '../../motion';

/** Pace the Markdown source itself, so unseen text does not reserve a paragraph of space. */
export function useTypedText(
  text: string,
  streaming: boolean,
  fresh: boolean,
  enabled: boolean,
) {
  const [snapshot, setSnapshot] = useState(() =>
    initialTyping(text, Date.now(), enabled && streaming && fresh),
  );
  let current = snapshot;
  if (text !== snapshot.text)
    current = admitTyping(snapshot, text, Date.now(), enabled && streaming);
  if (!enabled) current = flushTyping(current);
  if (current !== snapshot) setSnapshot(current);
  useEffect(() => {
    if (!enabled || current.visible === current.text.length) return;
    if (document.visibilityState === 'hidden') {
      setSnapshot((previous) => flushTyping(previous));
      return;
    }
    let frame = 0;
    const advance = () => {
      setSnapshot((previous) => tickTyping(previous, Date.now()));
      frame = window.requestAnimationFrame(advance);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden')
        setSnapshot((previous) => flushTyping(previous));
    };
    document.addEventListener('visibilitychange', onVisibility);
    frame = window.requestAnimationFrame(advance);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [current, enabled]);
  return current.text.slice(0, current.visible);
}
