import { t } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  LoaderCircle,
  Square,
  Info,
} from './ui/Icons';
import type { Item, Json, Tool } from '../types';
import {
  humanize,
  object,
  resultText,
  toolState,
  toolStateLabels,
  toolSummary,
} from '../transcript';
import { ToolIcon } from './ui/ToolIcon';
import { AttachmentCards } from './ui/AttachmentCards';
import { CopyButton } from './ui/CopyButton';

export function Information({ item }: { item: Item }) {
  if (item.kind === 'artifact')
    return (
      <div className="transcript-artifact">
        {item.text && (
          <details className="transcript-information">
            <summary>
              {t('产物')}
              <ChevronDown size={14} />
            </summary>
            <pre>{item.text}</pre>
          </details>
        )}
        {!!item.attachments?.length && (
          <AttachmentCards attachments={item.attachments} />
        )}
      </div>
    );
  if (item.kind === 'system')
    return (
      <details className="transcript-information">
        <summary>
          {t('系统提示')}
          <ChevronDown size={14} />
        </summary>
        <pre>{item.text}</pre>
      </details>
    );
  if (item.kind === 'notice' || item.kind === 'error') {
    const failure =
      item.kind === 'error' || object(item.metadata).status === 'error';
    return (
      <div
        className={`transcript-notice ${failure ? 'failure' : 'warning'}`}
        role="note"
      >
        {failure ? <AlertCircle size={15} /> : <Info size={15} />}
        <div>{item.text}</div>
      </div>
    );
  }
  return (
    <details className="transcript-information">
      <summary>
        {item.kind === 'artifact'
          ? t('产物')
          : t('事件 · {0}', humanize(item.kind))}
        <ChevronDown size={14} />
      </summary>
      <pre>{item.text}</pre>
    </details>
  );
}
export function Activity({
  tools,
  live,
  status,
  children,
}: {
  tools: Tool[];
  live: boolean;
  status: string;
  children: ReactNode;
}) {
  const states = tools.map((t) => toolState(t, live));
  const failed =
    states.includes('error') || ['failed', 'error'].includes(status);
  const stopped =
    states.includes('stopped') ||
    ['interrupted', 'stopped', 'cancelled', 'canceled'].includes(status);
  const [open, setOpen] = useState(live || failed || stopped);
  useEffect(() => setOpen(live || failed || stopped), [live, failed, stopped]);
  const label = live
    ? status === 'waitingForInput'
      ? t('等待确认')
      : t('正在工作')
    : failed
      ? t('执行失败')
      : stopped
        ? t('已停止')
        : t('已完成');
  return (
    <details
      className="work-summary"
      data-state={
        failed ? 'error' : stopped ? 'stopped' : live ? 'running' : 'ok'
      }
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {live ? (
          <LoaderCircle size={15} className="spin" />
        ) : failed ? (
          <AlertCircle size={15} />
        ) : stopped ? (
          <Square size={13} />
        ) : (
          <Check size={15} />
        )}
        <span>
          {label}
          {tools.length ? t(' · {0} 项操作', tools.length) : ''}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="tool-list">{children}</div>
    </details>
  );
}
function Detail({ title, text }: { title: string; text: string }) {
  return (
    <section className="tool-detail">
      <header>
        <span>{title}</span>
        {text && <CopyButton text={text} />}
      </header>
      <pre>{text || t('暂无内容')}</pre>
    </section>
  );
}
function formatted(value: Json | undefined) {
  return typeof value === 'string'
    ? value
    : value == null
      ? ''
      : JSON.stringify(value, null, 2);
}
export function ToolRows({ tools, live }: { tools: Tool[]; live: boolean }) {
  return (
    <>
      {tools.map((tool) => {
        const state = toolState(tool, live),
          summary = toolSummary(tool);
        const failed = state === 'error';
        return (
          <details className="tool" key={tool.id} data-state={state}>
            <summary>
              <ToolIcon name={tool.name} />
              <strong>{humanize(tool.name)}</strong>
              <span>{summary}</span>
              <small>{t(toolStateLabels[state])}</small>
              {failed && <AlertCircle size={13} aria-label={t('工具失败')} />}
              <ChevronDown className="tool-chevron" size={13} />
            </summary>
            <Detail title={t('输入')} text={formatted(tool.arguments)} />
            <Detail
              title={failed ? t('输出 · 失败') : t('输出')}
              text={resultText(tool.result)}
            />
            {tool.callView != null && (
              <Detail title={t('调用视图')} text={formatted(tool.callView)} />
            )}
            {tool.resultView != null && (
              <Detail title={t('结果视图')} text={formatted(tool.resultView)} />
            )}
          </details>
        );
      })}
    </>
  );
}
