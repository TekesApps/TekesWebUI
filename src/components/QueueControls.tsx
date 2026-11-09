import { useRef, useState } from 'react';
import type { Address, RunPresentation } from '../types';
import { displayError } from '../state';
import { t } from '../i18n';
import { AttachmentCards } from './ui/AttachmentCards';
import { X } from './ui/Icons';

type QueueItem = RunPresentation['queue'][number];
export interface QueueControlsProps {
  address: Address;
  connectionEpoch: number;
  harnessKind: string;
  queue: RunPresentation['queue'];
  canUpdateQueue: boolean;
  onEdit?: (
    address: Address,
    itemId: string,
    connectionEpoch: number,
    text: string,
  ) => Promise<void>;
  onRemove?: (
    address: Address,
    itemId: string,
    connectionEpoch: number,
  ) => Promise<void>;
}

/** Text-only public edits must not silently discard the original attachments. */
export function queueEditUnavailableReason(
  item: QueueItem,
  harnessKind: string,
) {
  const placement = item.placement ?? 'queued';
  if (
    placement !== 'queued' &&
    !(harnessKind === 'dsh' && placement === 'next-step')
  )
    return t('此排队消息当前不能编辑');
  const content = item.message?.content;
  if (!content) return t('排队消息内容不可用');
  if (
    harnessKind !== 'pi' &&
    content.some(
      (part) =>
        !part ||
        typeof part !== 'object' ||
        Array.isArray(part) ||
        part.type !== 'text' ||
        typeof part.text !== 'string',
    )
  )
    return t('此消息含附件，当前后端不支持保留附件编辑');
  return null;
}

export function QueueControls(props: QueueControlsProps) {
  const scope = JSON.stringify([
    props.address.endpoint,
    props.address.sessionId,
    props.connectionEpoch,
  ]);
  return props.queue.map((item, index) => (
    <QueueRow key={`${scope}:${item.id ?? index}`} {...props} item={item} />
  ));
}

function QueueRow({
  address,
  connectionEpoch,
  harnessKind,
  canUpdateQueue,
  onEdit,
  onRemove,
  item,
}: QueueControlsProps & { item: QueueItem }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const reason = queueEditUnavailableReason(item, harnessKind);
  const content = item.message?.content ?? [];
  const text = content
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      part.type === 'text' &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n');
  const attachments = content.filter(
    (part) =>
      !!part &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      part.type !== 'text',
  );
  async function mutate(operation: 'edit' | 'remove') {
    const id = item.id;
    if (inFlight.current || !canUpdateQueue || !id) return;
    if (operation === 'edit' && (reason || !draft.trim() || !onEdit)) return;
    if (operation === 'remove' && !onRemove) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      if (operation === 'edit') {
        await onEdit!(address, id, connectionEpoch, draft);
        setEditing(false);
      } else await onRemove!(address, id, connectionEpoch);
      // Only the next public queue projection may replace or remove this row.
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <div className="queued">
      <div className="queued-header">
        <small>{t('等待执行')}</small>
        {canUpdateQueue && item.id && (
          <div>
            {onEdit && !editing && (
              <button
                type="button"
                className="text-button queued-edit"
                disabled={pending || !!reason}
                title={reason ?? t('编辑排队消息')}
                onClick={() => {
                  setDraft(text);
                  setError('');
                  setEditing(true);
                }}
              >
                {t('编辑排队消息')}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="queued-remove icon-button"
                aria-label={t('移除排队消息')}
                title={t('移除排队消息')}
                disabled={pending}
                onClick={() => void mutate('remove')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mutate('edit');
          }}
        >
          <textarea
            aria-label={t('排队消息内容')}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setError('');
              }}
            >
              {t('取消')}
            </button>
            <button
              type="submit"
              disabled={pending || !canUpdateQueue || !!reason || !draft.trim()}
            >
              {t('保存排队消息')}
            </button>
          </div>
          {reason && <p>{reason}</p>}
        </form>
      ) : (
        <p>{text}</p>
      )}
      {!!attachments.length && <AttachmentCards attachments={attachments} />}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
