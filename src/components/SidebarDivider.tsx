import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { preference, savePreference } from '../state';

const preferenceKey = 'tekes.web.sidebarWidth';
const minimum = 220;
const maximum = 480;
const mainMinimum = 400;
const limit = (viewport: number) =>
  Math.max(minimum, Math.min(maximum, viewport - mainMinimum));
const clamp = (width: number, viewport: number) =>
  Math.max(minimum, Math.min(limit(viewport), width));

export function SidebarDivider() {
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [preferred, setPreferred] = useState<number | null>(() => {
    const saved = Number(preference(preferenceKey));
    return Number.isFinite(saved) && saved >= minimum && saved <= maximum
      ? saved
      : null;
  });
  const [viewport, setViewport] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );
  const [dragging, setDragging] = useState(false);
  const defaultWidth = viewport > 1499 ? 280 : viewport <= 1000 ? 235 : 266;
  const width = clamp(preferred ?? defaultWidth, viewport);

  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    const shell = divider.current?.parentElement;
    shell?.style.setProperty('--sidebar-width', `${width}px`);
    return () => {
      shell?.style.removeProperty('--sidebar-width');
    };
  }, [width]);

  function finish() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    savePreference(preferenceKey, String(width));
  }

  return (
    <div
      ref={divider}
      className={`sidebar-divider${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-label={t('调整侧栏宽度')}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={limit(viewport)}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        setPreferred(clamp(start.width + event.clientX - start.x, viewport));
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        finish();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        let next = width;
        const step = event.shiftKey ? 40 : 10;
        if (event.key === 'ArrowLeft') next -= step;
        else if (event.key === 'ArrowRight') next += step;
        else if (event.key === 'Home') next = minimum;
        else if (event.key === 'End') next = limit(viewport);
        else return;
        event.preventDefault();
        next = clamp(next, viewport);
        setPreferred(next);
        savePreference(preferenceKey, String(next));
      }}
    />
  );
}
