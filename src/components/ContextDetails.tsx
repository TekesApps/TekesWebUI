import { useEffect, useRef, useState } from 'react';
import type { Address } from '../types';
import type { ContextRow, ContextSnapshot } from '../context-details';
import { displayError } from '../state';
import { t } from '../i18n';

export interface ContextDetailsProps {
  address: Address;
  load: () => Promise<ContextSnapshot>;
}
export function ContextDetails(props: ContextDetailsProps) {
  return (
    <SessionContext
      key={JSON.stringify([props.address.endpoint, props.address.sessionId])}
      {...props}
    />
  );
}
const basisLabels: Record<string, string> = {
  reported: '已报告',
  estimated: '估算',
  upperBound: '上界',
  unknown: '未知',
  tokenized: '已分词',
  lowerBound: '下界',
};
const roleLabels: Record<string, string> = {
  occupied: '已占用',
  reserved: '已预留',
  available: '可用',
  deferred: '待加载',
  inventory: '目录内容',
};
function Rows({ rows }: { rows: ContextRow[] }) {
  return (
    <ul className="context-rows">
      {rows.map((row) => (
        <li key={row.id}>
          <span>
            {row.title} · {t(roleLabels[row.role])}
          </span>{' '}
          <span>
            {row.tokens
              ? `${row.tokens.value.toLocaleString()} tokens · ${t(basisLabels[row.tokens.basis] || '未知')}`
              : t('Token 数未知')}
          </span>
          {row.itemCount && (
            <small> · {t('{0} 项', row.itemCount.value)}</small>
          )}
          {!!row.children?.length && <Rows rows={row.children} />}
        </li>
      ))}
    </ul>
  );
}
function SessionContext({ address, load }: ContextDetailsProps) {
  const [value, setValue] = useState<ContextSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const callback = useRef(load);
  callback.current = load;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void callback
      .current()
      .then((result) => {
        if (!active) return;
        if (
          result.endpointId !== address.endpoint ||
          result.sessionId !== address.sessionId
        )
          throw new Error(t('上下文来源已变化，请重新读取。'));
        setValue(result);
      })
      .catch((cause) => {
        if (active) setError(displayError(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, address.endpoint, address.sessionId]);
  const usage = value?.usage;
  return (
    <section className="family-panel" aria-label={t('上下文与用量')}>
      <div className="family-heading">
        <h3>{t('上下文与用量')}</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {busy ? t('读取中…') : t('刷新上下文')}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {value && (
        <>
          <h4>{t('当前上下文')}</h4>
          <p>
            {usage?.usedTokens == null
              ? t('当前占用未知')
              : t('当前占用：{0} tokens', usage.usedTokens.toLocaleString())}
            {usage?.contextWindow != null && (
              <>
                {' '}
                · {t('窗口：{0} tokens', usage.contextWindow.toLocaleString())}
              </>
            )}
          </p>
          <p>
            {t('依据：{0}', t(basisLabels[usage?.basis || 'unknown']))}
            {usage?.model && (
              <>
                {' '}
                · {usage.provider ? `${usage.provider}/` : ''}
                {usage.model}
              </>
            )}
          </p>
          {value.details ? (
            <>
              <p>
                {value.details.relation === 'reconciled'
                  ? t('明细与同一样本总量对齐。')
                  : t('明细有独立估算或目录来源，不能相加当作总占用。')}
              </p>
              <Rows rows={value.details.rows} />
              {value.details.unavailableReason && (
                <p className="dialog-note">{value.details.unavailableReason}</p>
              )}
            </>
          ) : (
            <p>{t('此会话尚无可用的上下文明细。')}</p>
          )}
          {!!value.notices.length && (
            <p className="dialog-note">
              {t('部分明细已失效或无法解析，当前总量与未知项保持原始含义。')}
            </p>
          )}
          <h4>{t('累计模型用量')}</h4>
          <p className="dialog-note">
            {t('累计用量包含历史请求，不代表当前上下文占用。')}
          </p>
          {value.billing.summary ? (
            <dl>
              {(
                [
                  ['inputTokens', '输入 tokens'],
                  ['outputTokens', '输出 tokens'],
                  ['cacheReadTokens', '缓存读取 tokens'],
                  ['cacheWriteTokens', '缓存写入 tokens'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{t(label)}</dt>
                  <dd>
                    {value.billing.summary?.[key]?.toLocaleString() ??
                      t('未知')}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{t('此 Harness 尚未提供累计用量。')}</p>
          )}
          {value.billing.cacheAttribution && (
            <>
              <h4>{t('缓存归因')}</h4>
              {value.billing.cacheAttribution.length ? (
                <ul>
                  {value.billing.cacheAttribution.map((entry, index) => (
                    <li
                      key={`${entry.dialectId}:${entry.modelProfileId}:${entry.exactSku}:${index}`}
                    >
                      {entry.modelProfileId} · {entry.exactSku} ·{' '}
                      {entry.dialectId}
                      <br />
                      {t(
                        '{0} 次请求 · 输入 {1} · 输出 {2} · 缓存读取 {3}',
                        entry.attempts,
                        entry.inputTokens,
                        entry.outputTokens,
                        entry.cacheReadTokens,
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('尚无带完整路由身份的缓存报告。')}</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
