import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** One delayed tooltip treatment for pointer and keyboard users. Never intercepts clicks. */
export function Tooltip({
  children,
  content,
  block = false,
  side = 'top',
}: {
  children: ReactElement<{ 'aria-describedby'?: string }>;
  content: ReactNode;
  block?: boolean;
  side?: 'top' | 'right';
}) {
  const id = useId(),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    side: string;
  } | null>(null);
  function close() {
    clearTimeout(timer.current);
    setPosition(null);
  }
  function show() {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const right = side === 'right' && window.innerWidth - rect.right > 305;
    setPosition(
      right
        ? {
            x: rect.right + 10,
            y: Math.max(12, Math.min(rect.top, window.innerHeight - 150)),
            side: 'right',
          }
        : {
            x: Math.max(
              155,
              Math.min(rect.left + rect.width / 2, window.innerWidth - 155),
            ),
            y: rect.top > 135 ? rect.top - 8 : rect.bottom + 8,
            side: rect.top > 135 ? 'top' : 'bottom',
          },
    );
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', escape);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <span
      ref={anchor}
      className={`tooltip-anchor ${block ? 'block' : ''}`}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(show, 450);
      }}
      onMouseLeave={close}
      onFocus={show}
      onBlur={close}
      onClick={close}
    >
      {cloneElement(children, {
        'aria-describedby': position ? id : undefined,
      })}
      {position &&
        createPortal(
          <div
            className={`tooltip tooltip-${position.side}`}
            role="tooltip"
            id={id}
            style={{ left: position.x, top: position.y }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
