import { t } from '../i18n';
import { useState, type ReactNode } from 'react';
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
  elapsedText,
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
    const recovered = object(item.metadata).status === 'recovered';
    const failure =
      !recovered &&
      (item.kind === 'error' || object(item.metadata).status === 'error');
    return (
      <div
        className={`transcript-notice ${recovered ? 'recovered' : failure ? 'failure' : 'warning'}`}
        role="note"
      >
        {recovered ? (
          <Check size={15} />
        ) : failure ? (
          <AlertCircle size={15} />
        ) : (
          <Info size={15} />
        )}
        <div>
          {recovered && <strong>{t('已恢复')} · </strong>}
          {item.text}
        </div>
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
  live,
  status,
  elapsedSeconds,
  children,
}: {
  live: boolean;
  status: string;
  elapsedSeconds?: number;
  children: ReactNode;
}) {
  const failed = ['failed', 'error'].includes(status);
  const stopped = [
    'interrupted',
    'aborted',
    'stopped',
    'cancelled',
    'canceled',
  ].includes(status);
  const [disclosure, setDisclosure] = useState({ live, open: live });
  // Collapse in the same render as settlement, before tools can paint as loose history.
  if (disclosure.live !== live) setDisclosure({ live, open: live });
  const duration =
    elapsedSeconds === undefined ? undefined : elapsedText(elapsedSeconds);
  const label = live
    ? status === 'waitingForInput'
      ? t('等待确认')
      : t('工具调用')
    : failed
      ? duration
        ? t('失败，用时 {0}', duration)
        : t('执行失败')
      : stopped
        ? duration
          ? t('已停止，用时 {0}', duration)
          : t('已停止')
        : duration
          ? t('已工作 {0}', duration)
          : t('已工作');
  return (
    <details
      className="work-summary"
      data-state={
        failed ? 'error' : stopped ? 'stopped' : live ? 'running' : 'ok'
      }
      open={disclosure.open}
      onToggle={(e) => setDisclosure({ live, open: e.currentTarget.open })}
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
        <span>{label}</span>
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
