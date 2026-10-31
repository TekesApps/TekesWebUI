import type { ThreadActionDefinition } from '@tekesagentkit/client-contract';
import { TekesIcon } from './ui/TekesIcon';
import { threadActionIcons } from '../icons/thread-action-assets';
import { t, useLocale } from '../i18n';
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, FileText, LoaderCircle, X } from './ui/Icons';
import {
  safeLink,
  formatTimestamp,
  formatMessageTime,
  timestampMillis,
} from '../state';
import { Tooltip } from './Tooltip';
import type { Item, View } from '../types';
import type { Address } from '../types';
import type { Annotation } from '../annotations';
import { AnnotationList, ComposerAnnotations } from './Annotations';
import { AttachmentCards } from './ui/AttachmentCards';
import { useTypedText } from './ui/useTypedText';
import { OutputTokenCounter } from './ui/OutputTokenCounter';
import { CopyButton } from './ui/CopyButton';
import { Activity, Information, ToolRows } from './TranscriptActivity';
import {
  liveTurnID,
  reportedOutputUsage,
  partitionTurn,
  sessionItemAnchors,
  thinkingStatus,
  turnStatus,
  turnElapsedSeconds,
  visibleItem,
} from '../transcript';

// Stable Markdown component identities avoid remounting links and code during each typing step.
const markdownComponents: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (
    <span className="attachment-note">
      <FileText size={14} />
      {alt || t('图片附件')}
    </span>
  ),
  pre: ({ children }) => (
    <div className="code-block">
      <pre>{children}</pre>
    </div>
  ),
};
const reducedQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(reducedQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function motionSnapshot() {
  return window.matchMedia(reducedQuery).matches;
}

const Message = memo(function Message({
  item,
  fresh,
  streaming,
  motionEnabled,
  calendarDay,
  endedAt,
  process = false,
  address,
  annotations,
  onSaveAnnotation,
  onRemoveAnnotation,
  footnoteActions,
  onTurnAction,
}: {
  footnoteActions?: ThreadActionDefinition[];
  onTurnAction?: (address: Address, actionId: string) => Promise<unknown>;
  item: Item;
  fresh: boolean;
  streaming: boolean;
  motionEnabled: boolean;
  calendarDay: string;
  endedAt?: number;
  process?: boolean;
  address: Address;
  annotations?: Annotation[];
  onSaveAnnotation?: (annotation: Annotation) => void;
  onRemoveAnnotation?: (id: string) => void;
}) {
  const language = useLocale();
  const typedText = useTypedText(item.text, streaming, fresh, motionEnabled);
  const time =
    item.kind === 'user'
      ? item.time
      : !process && item.isFinal
        ? (endedAt ?? item.time)
        : undefined;
  const absoluteTime = useMemo(() => formatTimestamp(time), [time, language]);
  const captionTime = useMemo(
    () => formatMessageTime(time),
    [time, language, calendarDay],
  );
  const timestamp = absoluteTime ? (
    <Tooltip content={absoluteTime}>
      <time
        className="message-time"
        tabIndex={0}
        aria-label={absoluteTime}
        dateTime={new Date(timestampMillis(time)).toISOString()}
      >
        {captionTime}
      </time>
    </Tooltip>
  ) : null;
  const input =
    item.kind === 'user'
      ? {
          body: item.inputPresentation?.text ?? item.text,
          annotations: item.inputPresentation?.annotations || [],
        }
      : null;
  const message = (
    <article
      data-message-id={item.id}
      data-turn-id={item.turnId}
      data-message-kind={item.kind}
      className={`message ${item.kind} ${fresh ? 'message-enter' : ''} ${process ? 'message-narration' : ''}`}
    >
      {item.kind === 'user' ? (
        <>
          <div className="user-bubble">
            {!!input?.annotations.length && (
              <details className="message-annotations">
                <summary>
                  {t('批注 · ')}
                  {input.annotations.length}
                </summary>
                <AnnotationList
                  annotations={input.annotations}
                  address={address}
                />
              </details>
            )}
            {input?.body && <div data-annotation-text>{input.body}</div>}
            {!!item.attachments?.length && (
              <AttachmentCards attachments={item.attachments} />
            )}
          </div>
          <div className="input-time">
            {timestamp}
            {input?.body && <CopyButton text={input.body} />}
          </div>
        </>
      ) : (
        <div className="markdown" data-annotation-text>
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => safeLink(url) || ''}
            components={markdownComponents}
          >
            {typedText}
          </Markdown>
        </div>
      )}
      {item.kind !== 'user' && !!item.attachments?.length && (
        <AttachmentCards attachments={item.attachments} />
      )}
      {item.text && item.kind !== 'user' && (
        <div className="message-actions">
          <CopyButton text={item.text} />
          <FootnoteActions
            address={address}
            actions={footnoteActions}
            onAction={onTurnAction}
          />
          {timestamp}
        </div>
      )}
      {onSaveAnnotation && onRemoveAnnotation && (
        <ComposerAnnotations
          annotations={(annotations || []).filter(
            (a) =>
              a.sourceLocator?.itemId === item.id &&
              a.sourceLocator?.turnId === item.turnId &&
              a.sourceLocator?.endpoint === address.endpoint &&
              a.sourceLocator?.sessionId === address.sessionId,
          )}
          address={address}
          onSave={onSaveAnnotation}
          onRemove={onRemoveAnnotation}
        />
      )}
    </article>
  );
  return message;
});
function FootnoteActions({
  address,
  actions = [],
  onAction,
}: {
  address: Address;
  actions?: ThreadActionDefinition[];
  onAction?: (address: Address, actionId: string) => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  return (
    onAction &&
    actions.map((action) => (
      <button
        key={action.id}
        className="icon-button"
        aria-label={t(action.label)}
        title={t(action.disabledReason || action.label)}
        disabled={!action.enabled || pending}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          try {
            await onAction(address, action.id);
          } finally {
            setPending(false);
          }
        }}
      >
        <TekesIcon
          name={threadActionIcons[action.icon] || 'tekes-more'}
          size={15}
        />
      </button>
    ))
  );
}
interface TranscriptProps {
  view: View | null;
  onTurnAction?: (address: Address, actionId: string) => Promise<unknown>;
  onRemoveQueued?: (
    address: Address,
    itemId: string,
    connectionEpoch: number,
  ) => Promise<unknown>;
  annotations?: Annotation[];
  onSaveAnnotation?: (annotation: Annotation) => void;
  onRemoveAnnotation?: (id: string) => void;
}
export function Transcript({ view, ...annotations }: TranscriptProps) {
  if (!view?.transcript)
    return (
      <div className="loading-state">
        <LoaderCircle size={18} className="spin" />
        {t('正在读取会话…')}
      </div>
    );
  return <TranscriptContents view={view} {...annotations} />;
}
function TranscriptContents({
  view,
  ...annotations
}: TranscriptProps & { view: View }) {
  const [removingQueueItems, setRemovingQueueItems] = useState<Set<string>>(
    () => new Set(),
  );
  const removeQueued = annotations.onRemoveQueued;
  const [calendarDay, setCalendarDay] = useState(() =>
    new Date().toDateString(),
  );
  useEffect(() => {
    const refresh = () => setCalendarDay(new Date().toDateString());
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const [baseline] = useState(
    () => new Set(view.transcript?.items.map((item) => item.id)),
  );
  const reduced = useSyncExternalStore(
    subscribeMotion,
    motionSnapshot,
    () => true,
  );
  const items = view.transcript?.items.filter(visibleItem) || [],
    tools = view.transcript?.tools || [];
  const turns = [
    ...new Set([
      ...(view.transcript?.turns?.map((t) => t.id) || []),
      ...items.map((i) => i.turnId),
      ...tools.map((t) => t.turnId),
    ]),
  ].filter((turn) => turn || tools.some((tool) => !tool.turnId));
  const liveID = liveTurnID(view);
  const partitions = new Map(
    turns.map((turn) => [
      turn,
      partitionTurn(
        items.filter((item) => !!item.turnId && item.turnId === turn),
        tools.filter((tool) => tool.turnId === turn),
        turn === liveID,
      ),
    ]),
  );
  const sessionItems = sessionItemAnchors(
    items,
    [...partitions.values()].flatMap(({ inputs, output, activity }) => [
      ...inputs,
      ...output,
      ...activity.filter((item) =>
        ['system', 'notice', 'error'].includes(item.kind),
      ),
    ]),
  );
  const runningUsage =
    liveID &&
    view.run.phase === 'running' &&
    turnStatus(view, liveID) === 'running'
      ? reportedOutputUsage(view, liveID)
      : undefined;
  function renderItem(item: Item, process = false) {
    return (
      <Fragment key={item.id}>
        {sessionItems.before.get(item.id)?.map((item) => renderBareItem(item))}
        {renderBareItem(item, process)}
      </Fragment>
    );
  }
  function renderBareItem(item: Item, process = false) {
    if (
      item.kind !== 'user' &&
      item.kind !== 'assistant' &&
      item.kind !== 'narration'
    )
      return <Information key={item.id} item={item} />;
    return (
      <Message
        {...annotations}
        key={item.id}
        address={view}
        item={item}
        footnoteActions={
          item.isFinal &&
          item.turnId !== liveID &&
          !view.transcript?.isStale &&
          view.run.connection.phase === 'connected'
            ? view.transcript?.turns?.find((turn) => turn.id === item.turnId)
                ?.footnoteActions
            : undefined
        }
        process={process || item.kind === 'narration'}
        calendarDay={calendarDay}
        endedAt={
          view.transcript?.turns?.find((turn) => turn.id === item.turnId)
            ?.endedAt
        }
        motionEnabled={!reduced}
        fresh={
          !reduced &&
          !item.isFinal &&
          item.turnId === liveID &&
          !baseline.has(item.id)
        }
        streaming={
          !reduced &&
          item.turnId === liveID &&
          item.kind === 'assistant' &&
          !item.isFinal
        }
      />
    );
  }
  return (
    <>
      {turns.map((turn) => {
        const turnTools = tools.filter((t) => t.turnId === turn);
        const live = turn === liveID;
        const { inputs, output, activity } = partitions.get(turn)!;
        const information = activity.filter((i) =>
          ['system', 'notice', 'error'].includes(i.kind),
        );
        const process = activity.filter((i) => !information.includes(i));
        return (
          <section className="turn" key={turn}>
            {information
              .filter((i) => i.kind === 'system')
              .map((i) => renderItem(i))}
            {inputs.map((i) => renderItem(i))}
            {information
              .filter((i) => i.kind !== 'system')
              .map((i) => renderItem(i))}
            {(turnTools.length > 0 || process.length > 0) && (
              <Activity
                live={live}
                status={turnStatus(view, turn)}
                elapsedSeconds={turnElapsedSeconds(view, turn)}
              >
                {process.map((i) => renderItem(i, true))}
                <ToolRows tools={turnTools} live={live} />
              </Activity>
            )}
            {output.map((i) => renderItem(i))}
            {!!view.transcript?.turns?.find((t) => t.id === turn)
              ?.footnoteActions?.length &&
              !live &&
              !output.length &&
              !view.transcript?.isStale &&
              view.run.connection.phase === 'connected' && (
                <div className="message-actions">
                  <FootnoteActions
                    address={view}
                    actions={
                      view.transcript?.turns?.find((t) => t.id === turn)
                        ?.footnoteActions
                    }
                    onAction={annotations.onTurnAction}
                  />
                </div>
              )}
          </section>
        );
      })}
      {sessionItems.trailing.map((item) => renderBareItem(item))}
      {view.run.phase === 'running' && (
        <div className="working" role="status" aria-label={t('运行中')}>
          <span className="working-orbit" />
          {thinkingStatus(view) && (
            <span className="working-label">{t('正在思考')}</span>
          )}
          {runningUsage && runningUsage.outputTokens > 0 && (
            <OutputTokenCounter
              key={liveID}
              count={runningUsage.outputTokens}
              complete={runningUsage.isComplete}
            />
          )}
        </div>
      )}
      {view.run.phase !== 'running' && !items.length && !tools.length && (
        <p className="loading-state">{t('会话已准备好，发送消息开始。')}</p>
      )}
      {view.run.queue.map((queued, i) => {
        const itemId = queued.id;
        const queuedAddress = {
          endpoint: view.endpoint,
          sessionId: view.sessionId,
        };
        const removalKey = JSON.stringify([
          view.endpoint,
          view.sessionId,
          view.run.connectionEpoch,
          itemId,
        ]);
        const attachments = (queued.message?.content || []).filter(
          (part) =>
            !!part &&
            typeof part === 'object' &&
            !Array.isArray(part) &&
            part.type !== 'text',
        );
        return (
          <div className="queued" key={itemId ?? i}>
            <div className="queued-header">
              <small>{t('等待执行')}</small>
              {view.run.canUpdateQueue && itemId && removeQueued && (
                <button
                  className="queued-remove icon-button"
                  type="button"
                  aria-label={t('移除排队消息')}
                  title={t('移除排队消息')}
                  disabled={removingQueueItems.has(removalKey)}
                  onClick={async () => {
                    setRemovingQueueItems((current) =>
                      new Set(current).add(removalKey),
                    );
                    try {
                      await removeQueued(
                        queuedAddress,
                        itemId,
                        view.run.connectionEpoch,
                      );
                    } finally {
                      setRemovingQueueItems((current) => {
                        const next = new Set(current);
                        next.delete(removalKey);
                        return next;
                      });
                    }
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {queued.message?.content?.map((part, index) =>
              part &&
              typeof part === 'object' &&
              !Array.isArray(part) &&
              part.type === 'text' &&
              typeof part.text === 'string' ? (
                <p key={index}>{part.text}</p>
              ) : null,
            )}
            {!!attachments.length && (
              <AttachmentCards attachments={attachments} />
            )}
          </div>
        );
      })}
      {view.run.error && (
        <div className="inline-error" role="alert">
          {view.run.error}
        </div>
      )}
    </>
  );
}
