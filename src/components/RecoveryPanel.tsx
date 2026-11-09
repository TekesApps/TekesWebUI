import { useEffect, useRef, useState } from 'react';
import type { Address } from '../types';
import type { RecoveryRequest, RecoverySnapshot } from '../recovery';
import { displayError } from '../state';
import { t } from '../i18n';

export interface RecoveryPanelProps {
  address: Address;
  load: () => Promise<RecoverySnapshot>;
  run: (request: RecoveryRequest) => Promise<unknown>;
}
export function RecoveryPanel(props: RecoveryPanelProps) {
  return (
    <SessionRecovery
      key={JSON.stringify([props.address.endpoint, props.address.sessionId])}
      {...props}
    />
  );
}
function SessionRecovery({ address, load, run }: RecoveryPanelProps) {
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const callbacks = useRef({ load, run });
  callbacks.current = { load, run };
  async function read() {
    const result = await callbacks.current.load();
    if (!mounted.current) return;
    if (
      result.endpointId !== address.endpoint ||
      result.sessionId !== address.sessionId ||
      (result.outcome &&
        result.outcome.connectionEpoch !== result.connectionEpoch)
    )
      throw new Error(t('恢复状态来源已变化，请重新读取。'));
    setSnapshot(result);
    setFresh(true);
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await read();
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(displayError(cause));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function recover() {
    if (pending.current || !fresh || !snapshot?.canRecover) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let acknowledged = false;
    try {
      await callbacks.current.run({
        sessionId: address.sessionId,
        connectionEpoch: snapshot.connectionEpoch,
      });
      acknowledged = true;
      if (!mounted.current) return;
      setNotice(t('恢复请求已返回，正在核对实际释放结果。'));
      await read();
      if (mounted.current) setNotice('');
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(displayError(cause));
        setNotice(
          acknowledged
            ? t(
                '恢复请求已返回；状态读取失败。请只刷新核对，请求不会自动重发。',
              )
            : t('恢复结果尚未确认。请刷新核对，请求不会自动重发。'),
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const outcome = snapshot?.outcome;
  const recovered = outcome?.recoveredSessionIds.includes(address.sessionId);
  const unresolved = outcome?.unresolvedSessionIds.includes(address.sessionId);
  const skipped = outcome?.notRetriedSessionIds.includes(address.sessionId);
  return (
    <section className="family-panel" aria-label={t('中断工作恢复')}>
      <div className="family-heading">
        <h3>{t('中断工作恢复')}</h3>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? t('读取中…') : t('刷新恢复状态')}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {snapshot && (
        <>
          {!outcome && <p>{t('本连接尚无此会话的恢复回执。')}</p>}
          {recovered && (
            <p>{t('此会话已释放恢复准入；不代表工作已启动或完成。')}</p>
          )}
          {unresolved && !outcome?.error && (
            <p>{t('此会话未被恢复回执列为已释放，原因尚未确定。')}</p>
          )}
          {outcome?.error && (
            <p role="status">
              {t('此会话的恢复结果未确认。')} {outcome.error}
            </p>
          )}
          {skipped && (
            <p>{t('先前结果未确认，连接重开没有自动重发恢复请求。')}</p>
          )}
          {!snapshot.canRecover && (
            <p>{t('此会话当前不能恢复执行，请先打开可运行的会话历史。')}</p>
          )}
          <p className="dialog-note">
            {t('恢复会放行此会话的中断工作，Harness 可能调用模型并继续执行。')}
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || !fresh || !snapshot.canRecover}
            onClick={() => void recover()}
          >
            {t('恢复并继续执行')}
          </button>
        </>
      )}
    </section>
  );
}
