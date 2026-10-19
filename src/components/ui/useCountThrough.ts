import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

export const countThroughMilliseconds = 240;
export interface CountTransition {
  from: number;
  to: number;
  startedAt: number;
}
/** ClientKit AsideTickAnimation: cubic ease-out; authoritative downward corrections are immediate. */
export function presentedCount(transition: CountTransition, now: number) {
  if (transition.to <= transition.from) return transition.to;
  const progress = Math.min(
    1,
    Math.max(0, (now - transition.startedAt) / countThroughMilliseconds),
  );
  return Math.round(
    transition.from +
      (transition.to - transition.from) * (1 - Math.pow(1 - progress, 3)),
  );
}
const query = '(prefers-reduced-motion: reduce)';
function subscribe(listener: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
const reducedSnapshot = () => window.matchMedia?.(query).matches ?? false;

/** Presentation-only catch-up between real reports; never feeds back into usage or accounting. */
export function useCountThrough(target: number) {
  const reduced = useSyncExternalStore(subscribe, reducedSnapshot, () => true);
  const [displayed, setDisplayed] = useState(target);
  const transition = useRef<CountTransition>({
    from: target,
    to: target,
    startedAt: 0,
  });
  useLayoutEffect(() => {
    let frame = 0;
    const now = window.performance.now();
    const previous = transition.current;
    const from = presentedCount(previous, now);
    transition.current = { from, to: target, startedAt: now };
    const flush = () => {
      window.cancelAnimationFrame?.(frame);
      frame = 0;
      transition.current = {
        from: target,
        to: target,
        startedAt: window.performance.now(),
      };
      setDisplayed(target);
    };
    if (
      reduced ||
      document.visibilityState === 'hidden' ||
      target <= from ||
      !window.requestAnimationFrame
    ) {
      flush();
      return;
    }
    setDisplayed(from);
    const advance = (timestamp: number) => {
      setDisplayed(presentedCount(transition.current, timestamp));
      if (timestamp < transition.current.startedAt + countThroughMilliseconds) {
        frame = window.requestAnimationFrame(advance);
      } else frame = 0;
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', visibility);
    frame = window.requestAnimationFrame(advance);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [target, reduced]);
  return displayed;
}
