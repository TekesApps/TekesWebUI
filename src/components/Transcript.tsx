import { memo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  LoaderCircle,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { safeLink } from '../state';
import type { Item, Json, Tool, View } from '../types';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <button
      className="icon-button copy-button"
      aria-label={error ? '复制失败，请选择文本复制' : '复制内容'}
      title={
        copied ? '已复制' : error ? '复制失败，请选择文本复制' : '复制内容'
      }
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setError(true);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
const Message = memo(function Message({ item }: { item: Item }) {
  return (
    <article className={`message ${item.kind}`}>
      {item.kind === 'assistant' && (
        <div className="message-author">
          <span className="mini-mark">T</span>Tekes
        </div>
      )}
      {item.reasoning && (
        <details className="thinking">
          <summary>
            <Sparkles size={14} />
            思考过程
            <ChevronDown size={14} />
          </summary>
          <div>{item.reasoning}</div>
        </details>
      )}
      {item.kind === 'user' ? (
        <div className="user-bubble">{item.text}</div>
      ) : (
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => safeLink(url) || ''}
            components={{
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
      {!!item.attachments?.length && (
        <div className="attachment-note">
          <FileText size={14} />
          {item.attachments.length} 个附件 · 请在 App 中查看
        </div>
      )}
      {item.text && item.kind !== 'user' && (
        <div className="message-actions">
          <CopyButton text={item.text} />
        </div>
      )}
    </article>
  );
});
function output(value: Json | undefined): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.content))
      return value.content
        .map((v) =>
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          typeof v.text === 'string'
            ? v.text
            : '',
        )
        .filter(Boolean)
        .join('\n');
    if (typeof value.output === 'string') return value.output;
  }
  return value == null ? '' : JSON.stringify(value, null, 2);
}
function Tools({ tools }: { tools: Tool[] }) {
  const active = tools.some((t) =>
    ['doing', 'running', 'pending'].includes(t.phase),
  );
  return (
    <details className="work-summary">
      <summary>
        {active ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Check size={15} />
        )}
        <span>
          {active ? '正在执行' : '已完成'} {tools.length} 项操作
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="tool-list">
        {tools.map((tool) => {
          const args =
            tool.arguments &&
            typeof tool.arguments === 'object' &&
            !Array.isArray(tool.arguments)
              ? tool.arguments
              : {};
          const command =
            args.command || args.cmd || args.path || args.file_path;
          return (
            <details className="tool" key={tool.id}>
              <summary>
                <Terminal size={14} />
                <strong>{tool.name}</strong>
                <span>{typeof command === 'string' ? command : ''}</span>
                <small>{tool.phase}</small>
              </summary>
              <pre>
                {typeof command === 'string'
                  ? command
                  : JSON.stringify(tool.arguments, null, 2)}
              </pre>
              {tool.result != null && <pre>{output(tool.result)}</pre>}
            </details>
          );
        })}
      </div>
    </details>
  );
}
export function Transcript({ view }: { view: View | null }) {
  if (!view)
    return (
      <div className="loading-state">
        <LoaderCircle size={18} className="spin" />
        正在读取会话…
      </div>
    );
  const items = view.transcript?.items.filter((i) => i.isVisible) || [],
    tools = view.transcript?.tools || [];
  const turns = [
    ...new Set([...items.map((i) => i.turnId), ...tools.map((t) => t.turnId)]),
  ];
  return (
    <>
      {turns.map((turn) => (
        <section className="turn" key={turn}>
          {items
            .filter((i) => i.turnId === turn && i.kind === 'user')
            .map((item) => (
              <Message key={item.id} item={item} />
            ))}
          {tools.some((t) => t.turnId === turn) && (
            <Tools tools={tools.filter((t) => t.turnId === turn)} />
          )}
          {items
            .filter((i) => i.turnId === turn && i.kind !== 'user')
            .map((item) => (
              <Message key={item.id} item={item} />
            ))}
        </section>
      ))}
      {view.run.phase === 'running' && (
        <div className="working" role="status">
          <span className="working-orbit" />
          正在工作<span className="ellipsis">…</span>
        </div>
      )}
      {view.run.phase !== 'running' && !items.length && (
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
