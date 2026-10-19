import { useState } from 'react';
import { intlLocale, t } from '../../i18n';

/** Transitions between actual provider reports, without inventing intermediate counts. */
export function OutputTokenCounter({
  count,
  complete = true,
}: {
  count: number;
  complete?: boolean;
}) {
  const [frame, setFrame] = useState<{ current: number; previous?: number }>({
    current: count,
  });
  if (frame.current !== count)
    setFrame({ current: count, previous: frame.current });
  const [prefix, suffix] = t(
    complete ? '输出 {0} tokens' : '已记录输出 {0} tokens',
    '\u0000',
  ).split('\u0000');
  return (
    <span className="working-tokens" aria-live="off">
      {prefix}
      <span
        className="token-counter"
        key={frame.current}
        data-direction={
          frame.previous !== undefined && frame.current < frame.previous
            ? 'down'
            : 'up'
        }
      >
        {frame.previous !== undefined && (
          <span className="token-counter-previous" aria-hidden="true">
            {frame.previous.toLocaleString(intlLocale())}
          </span>
        )}
        <span
          className={
            frame.previous === undefined
              ? 'token-counter-current'
              : 'token-counter-current token-counter-enter'
          }
        >
          {frame.current.toLocaleString(intlLocale())}
        </span>
      </span>
      {suffix}
    </span>
  );
}
