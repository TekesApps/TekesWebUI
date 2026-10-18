import {
  Children,
  createElement,
  memo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, FileText, LoaderCircle } from './ui/Icons';
import { safeLink, formatTimestamp, timestampMillis } from '../state';
import type { Item, View } from '../types';
import { AttachmentCards } from './ui/AttachmentCards';
import { RevealText, TextMotion } from './ui/RevealText';
import { CopyButton } from './ui/CopyButton';
import { Activity, Information, ToolRows } from './TranscriptActivity';
import {
  liveTurnID,
  partitionTurn,
  thinkingStatus,
  turnStatus,
  visibleItem,
} from '../transcript';

function revealChildren(children: ReactNode) {
  return Children.map(children, (child) =>
    typeof child === 'string' && child.trim() ? (
      <RevealText text={child} />
    ) : (
      child
    ),
  );
}
// Stable component identities prevent a growing Markdown leaf from remounting.
const textComponents = Object.fromEntries(
  [
    'p',
    'li',
    'strong',
    'em',
    'del',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'th',
    'td',
    'blockquote',
  ].map((tag) => [
    tag,
    ({
      children,
      node: _node,
      ...props
    }: {
      children?: ReactNode;
      node?: unknown;
    }) => createElement(tag, props, revealChildren(children)),
  ]),
) as Components;
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
  process = false,
}: {
  item: Item;
  fresh: boolean;
  streaming: boolean;
  process?: boolean;
}) {
  return (
    <TextMotion.Provider value={{ streaming, fresh }}>
      <article
        className={`message ${item.kind} ${fresh ? 'message-enter' : ''} ${process ? 'message-narration' : ''}`}
        title={formatTimestamp(item.time) || undefined}
      >
        {item.kind === 'assistant' && !process && !!item.time && (
          <div className="message-author">
            {item.time && (
              <time
                className="message-time"
                dateTime={new Date(timestampMillis(item.time)).toISOString()}
              >
                {new Date(timestampMillis(item.time)).toLocaleTimeString(
                  'zh-CN',
                  { hour: '2-digit', minute: '2-digit', hour12: false },
                )}
              </time>
            )}
          </div>
        )}
        {item.kind === 'user' ? (
          <>
            <div className="user-bubble">
              {item.text && <div>{item.text}</div>}
              {!!item.attachments?.length && (
                <AttachmentCards attachments={item.attachments} />
              )}
            </div>
            {item.time && (
              <time
                className="message-time"
                dateTime={new Date(timestampMillis(item.time)).toISOString()}
              >
                {formatTimestamp(item.time)}
              </time>
            )}
          </>
        ) : (
          <div className="markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => safeLink(url) || ''}
              components={{
                ...textComponents,
                a: ({ href, children }) =>
                  href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {revealChildren(children)}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
                img: ({ alt }) => (
                  <span className="attachment-note">
                    <FileText size={14} />
                    {alt || '图片附件'}
                  </span>
                ),
                pre: ({ children }) => (
                  <div className="code-block">
                    <pre>{children}</pre>
                  </div>
                ),
              }}
            >
              {item.text}
            </Markdown>
          </div>
        )}
        {item.kind !== 'user' && !!item.attachments?.length && (
          <AttachmentCards attachments={item.attachments} />
        )}
        {item.text && item.kind !== 'user' && (
          <div className="message-actions">
            <CopyButton text={item.text} />
          </div>
        )}
      </article>
    </TextMotion.Provider>
  );
});
export function Transcript({ view }: { view: View | null }) {
  if (!view?.transcript)
    return (
      <div className="loading-state">
        <LoaderCircle size={18} className="spin" />
        正在读取会话…
      </div>
    );
  return <TranscriptContents view={view} />;
}
function TranscriptContents({ view }: { view: View }) {
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
  ];
  const liveID = liveTurnID(view);
  function renderItem(item: Item, process = false) {
    if (
      item.kind !== 'user' &&
      item.kind !== 'assistant' &&
      item.kind !== 'narration'
    )
      return <Information key={item.id} item={item} />;
    return (
      <Message
        key={item.id}
        item={item}
        process={process || item.kind === 'narration'}
        fresh={!reduced && item.turnId === liveID && !baseline.has(item.id)}
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
        const { inputs, output, activity } = partitionTurn(
          items.filter((i) => i.turnId === turn),
          turnTools,
        );
        const live = turn === liveID;
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
                tools={turnTools}
                live={live}
                status={turnStatus(view, turn)}
              >
                {process.map((i) => renderItem(i, true))}
                <ToolRows tools={turnTools} live={live} />
              </Activity>
            )}
            {output.map((i) => renderItem(i))}
          </section>
        );
      })}
      {view.run.phase === 'running' && (
        <div className="working" role="status">
          <span className="working-orbit" />
          <span className="working-label">
            {thinkingStatus(view) ? '正在思考' : '正在工作'}
          </span>
          <span className="working-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {view.run.phase !== 'running' && !items.length && !tools.length && (
        <p className="loading-state">会话已准备好，发送消息开始。</p>
      )}
      {view.run.queue.map((queued, i) => (
        <div className="queued" key={i}>
          <small>等待执行</small>
          <p>
            {queued.content
              ?.filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n')}
          </p>
        </div>
      ))}
      {view.run.error && (
        <div className="inline-error" role="alert">
          {view.run.error}
        </div>
      )}
    </>
  );
}
