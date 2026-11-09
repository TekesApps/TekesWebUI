import { useRef, useState, useEffect } from 'react';
import type { Address } from '../types';
import type { FeedbackAction, FeedbackSnapshot } from '../feedback';
import { displayError } from '../state';
import { t } from '../i18n';

export interface FeedbackControlsProps {
  address: Address;
  itemId: string;
  load: () => Promise<FeedbackSnapshot>;
  act: (action: FeedbackAction) => Promise<unknown>;
}

/** A menu opens against the original message, never a transcript row ordinal. */
export function FeedbackControls(props: FeedbackControlsProps) {
  return (
    <MessageFeedback
      key={JSON.stringify([
        props.address.endpoint,
        props.address.sessionId,
        props.itemId,
      ])}
      {...props}
    />
  );
}
function MessageFeedback({
  address,
  itemId,
  load,
  act,
}: FeedbackControlsProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<FeedbackSnapshot | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ load, act });
  callbacks.current = { load, act };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function read(adoptNote: boolean) {
    const value = await callbacks.current.load();
    if (!mounted.current) return;
    if (
      value.endpointId !== address.endpoint ||
      value.sessionId !== address.sessionId ||
      (value.target && value.target.itemId !== itemId)
    )
      throw new Error(t('评价来源已变化，请重新读取。'));
    if (value.feedback && value.feedback.messageId !== value.target?.messageId)
      throw new Error(t('评价来源已变化，请重新读取。'));
    setSnapshot(value);
    setFresh(true);
    if (adoptNote) setNote(value.feedback?.note || '');
  }
  async function refresh(adoptNote = snapshot === null) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await read(adoptNote);
      if (mounted.current) setNotice('');
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
  async function change(change: FeedbackAction['change']) {
    if (pending.current || !fresh || !snapshot?.target) return;
    const deleting =
      (change.kind === 'setRating' && change.rating === null) ||
      (change.kind === 'toggleRating' &&
        change.rating === snapshot.feedback?.rating);
    if (deleting ? !snapshot.canDelete : !snapshot.canPut) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const target = snapshot.target;
    let acknowledged = false;
    try {
      await callbacks.current.act({
        sessionId: address.sessionId,
        connectionEpoch: snapshot.connectionEpoch,
        itemId: target.itemId,
        messageId: target.messageId,
        responseRevision: target.responseRevision,
        ifVersion: snapshot.feedback?.version || null,
        change,
      });
      acknowledged = true;
      if (!mounted.current) return;
      setFresh(false);
      setNotice(t('评价操作已确认，正在读取。'));
      await read(true);
      if (mounted.current) setNotice(t('评价已更新。'));
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(displayError(cause));
        setNotice(
          acknowledged
            ? t('评价已确认，但读取失败。请刷新，操作不会重发。')
            : t('评价结果尚未确认，请刷新核对后再修改。'),
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (snapshot && !snapshot.target && !error) return null;
  return (
    <div className="message-feedback">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
      >
        {t('评价回复')}
      </button>
      {open && (
        <div className="feedback-editor">
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh(false)}
          >
            {t('刷新评价')}
          </button>
          {snapshot?.target && (
            <>
              <button
                type="button"
                aria-pressed={snapshot.feedback?.rating === 'positive'}
                disabled={
                  busy ||
                  !fresh ||
                  (!snapshot.canPut &&
                    snapshot.feedback?.rating !== 'positive') ||
                  (!snapshot.canDelete &&
                    snapshot.feedback?.rating === 'positive')
                }
                onClick={() =>
                  void change({ kind: 'toggleRating', rating: 'positive' })
                }
              >
                {t('有帮助')}
              </button>
              <button
                type="button"
                aria-pressed={snapshot.feedback?.rating === 'negative'}
                disabled={
                  busy ||
                  !fresh ||
                  (!snapshot.canPut &&
                    snapshot.feedback?.rating !== 'negative') ||
                  (!snapshot.canDelete &&
                    snapshot.feedback?.rating === 'negative')
                }
                onClick={() =>
                  void change({ kind: 'toggleRating', rating: 'negative' })
                }
              >
                {t('没有帮助')}
              </button>
              {snapshot.feedback && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change({ kind: 'setNote', note: note.trim() || null });
                  }}
                >
                  <label>
                    {t('评价备注')}
                    <textarea
                      value={note}
                      disabled={busy || !fresh || !snapshot.canPut}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !fresh || !snapshot.canPut}
                  >
                    {t('保存评价备注')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !fresh || !snapshot.canDelete}
                    onClick={() =>
                      void change({ kind: 'setRating', rating: null })
                    }
                  >
                    {t('删除评价')}
                  </button>
                </form>
              )}
              {!snapshot.feedback && <p>{t('先选择评价，再添加备注。')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
