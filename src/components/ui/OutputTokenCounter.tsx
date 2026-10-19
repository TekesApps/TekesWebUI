import { useCountThrough } from './useCountThrough';
import { intlLocale, t } from '../../i18n';

/** ClientKit CompactCountFormat: integer below 1000, otherwise fixed one-decimal thousands. */
export function compactTokenCount(count: number) {
  return count < 1000
    ? String(count)
    : new Intl.NumberFormat(intlLocale(), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        useGrouping: false,
      }).format(count / 1000) + 'k';
}

/** Same count-through presentation as ClientKit, bounded by the actual reported target. */
export function OutputTokenCounter({
  count,
  complete = true,
}: {
  count: number;
  complete?: boolean;
}) {
  const displayed = useCountThrough(count);
  const [prefix, suffix] = t(
    complete ? '{0} tokens' : '已记录 {0} tokens',
    '\u0000',
  ).split('\u0000');
  return (
    <span
      className="working-tokens"
      aria-live="off"
      aria-label={t(
        complete ? '{0} tokens' : '已记录 {0} tokens',
        compactTokenCount(count),
      )}
      data-reported-count={count}
    >
      <span aria-hidden="true">
        {prefix}
        <span className="token-counter">
          <span className="token-counter-current">
            {compactTokenCount(displayed)}
          </span>
        </span>
        {suffix}
      </span>
    </span>
  );
}
