import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type { Workspace, WorkspaceState } from '../workspace';
import { byteSize, effortTitle, presetTitle } from '../composer';
import { shouldSend } from '../state';
import { Dialog } from './Dialog';
import { Tooltip } from './Tooltip';

export function Composer({
  workspace: w,
  state: s,
  prompt,
  onSubmit,
}: {
  workspace: Workspace;
  state: WorkspaceState;
  prompt: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null),
    pickerRoot = useRef<HTMLDivElement>(null),
    composing = useRef(false);
  const [picker, setPicker] = useState(false),
    [details, setDetails] = useState(false),
    [configuration, setConfiguration] = useState(''),
    [dragging, setDragging] = useState(false);
  const endpoint = s.endpoints.find(
    (e) => e.id === (s.selected?.endpoint || s.newEndpoint),
  );
  const preset = s.presets
    .get(endpoint?.id || '')
    ?.presets.find((p) => p.id === s.preset);
  const model = s.models.find(
    (m) => m.id === s.model?.model && m.provider === s.model.provider,
  );
  const efforts = model?.reasoning?.efforts || [];
  const canAttach =
    !!endpoint?.capabilities?.methods?.includes('session.uploadFile');
  const current =
    s.selected &&
    s.inventories
      .get(s.selected.endpoint)
      ?.find((row) => row.sessionId === s.selected?.sessionId)?.summary;
  const cwd = current?.cwd || s.cwd;
  const harnessName =
    endpoint?.kind === 'tekes'
      ? 'Kernel'
      : endpoint?.kind === 'dsh'
        ? 'DSH'
        : endpoint?.name || 'Harness';
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!pickerRoot.current?.contains(e.target as Node)) setPicker(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicker(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    setPicker(false);
    setDragging(false);
    setDetails(false);
  }, [s.selected?.endpoint, s.selected?.sessionId, s.newEndpoint, s.cwd]);
  async function showDetails() {
    setDetails(true);
    setConfiguration('正在读取配置…');
    setConfiguration(await w.presetConfiguration());
  }
  return (
    <>
      <form
        className={`composer ${dragging ? 'dragging' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            setDragging(false);
            w.addFiles(Array.from(e.dataTransfer.files));
            prompt.current?.focus();
          }
        }}
      >
        {!!s.attachments.length && (
          <div className="attachment-tray" aria-label="待发送附件">
            {s.attachments.map((attachment) => (
              <div className="pending-attachment" key={attachment.id}>
                <span className="attachment-file-icon">
                  <FileText size={18} />
                </span>
                <span className="attachment-file-info">
                  <span title={attachment.file.name}>
                    {attachment.file.name}
                  </span>
                  <small>{byteSize(attachment.file.size)}</small>
                </span>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`移除附件 ${attachment.file.name}`}
                  title="移除附件"
                  disabled={s.busy}
                  onClick={() => w.removeFile(attachment.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor="prompt">
          消息
        </label>
        <textarea
          ref={prompt}
          id="prompt"
          rows={2}
          placeholder={
            dragging
              ? '松开以添加附件'
              : s.selected
                ? '继续对话…'
                : '描述一个想法，或交给我一项任务…'
          }
          value={s.draft}
          onChange={(e) => w.setDraft(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              w.addFiles(Array.from(e.clipboardData.files));
            }
          }}
          onKeyDown={(event) => {
            if (
              !composing.current &&
              shouldSend({
                key: event.key,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
                keyCode: event.keyCode,
                isComposing: event.nativeEvent.isComposing,
              })
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-options">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-label="选择附件文件"
              onChange={(e) => {
                w.addFiles(Array.from(e.target.files || []));
                e.target.value = '';
                prompt.current?.focus();
              }}
            />
            <Tooltip
              content={
                canAttach
                  ? '添加附件 · 也可拖入文件或粘贴图片'
                  : '当前 Harness 不支持附件'
              }
            >
              <button
                className="composer-add icon-button"
                type="button"
                aria-label="添加附件"
                disabled={s.busy || s.controlsLoading || !canAttach}
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={19} />
              </button>
            </Tooltip>
            <div className="harness-picker-root" ref={pickerRoot}>
              <Tooltip
                content={
                  <>
                    <strong>{endpoint?.name || 'Harness'}</strong>
                    <span>
                      {s.selected && !s.preset
                        ? '未报告初始预设'
                        : presetTitle(preset)}{' '}
                      · 版本 {endpoint?.host?.product.version || '未知'}
                    </span>
                    {s.selected && <span>会话的 Harness 与预设已固定</span>}
                  </>
                }
              >
                <button
                  className="composer-chip harness-chip"
                  type="button"
                  aria-label={
                    s.selected
                      ? '查看会话 Harness 与预设'
                      : '选择 Harness 与预设'
                  }
                  aria-expanded={!s.selected && picker}
                  disabled={s.busy}
                  onClick={() =>
                    s.selected ? void showDetails() : setPicker(!picker)
                  }
                >
                  <span className={`harness-symbol ${endpoint?.kind || ''}`}>
                    {endpoint?.kind === 'pi'
                      ? 'π'
                      : endpoint?.kind === 'dsh'
                        ? 'D'
                        : 'T'}
                  </span>
                  <span>
                    {harnessName}
                    {s.controlsLoading
                      ? ' · 读取中'
                      : s.preset
                        ? ` · ${presetTitle(preset || { id: s.preset })}`
                        : ''}
                  </span>
                  {s.selected ? (
                    <LockKeyhole size={11} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              </Tooltip>
              {picker && !s.selected && (
                <div
                  className="harness-menu"
                  role="dialog"
                  aria-label="选择 Harness 与预设"
                >
                  {s.endpoints.map((agent) => {
                    const catalog = s.presets.get(agent.id);
                    return (
                      <section key={agent.id}>
                        <div className="harness-menu-heading">
                          <strong>{agent.name}</strong>
                          <small>
                            {agent.host?.product.version || '未连接'}
                          </small>
                        </div>
                        {catalog?.presets.length ? (
                          catalog.presets.map((p) => (
                            <button
                              type="button"
                              className="preset-choice"
                              aria-pressed={
                                agent.id === s.newEndpoint && s.preset === p.id
                              }
                              key={p.id}
                              disabled={!!p.broken || !!p.unavailableReason}
                              title={
                                p.description ||
                                p.broken ||
                                p.unavailableReason ||
                                undefined
                              }
                              onClick={() => {
                                if (agent.id !== s.newEndpoint)
                                  w.newSession(s.cwd, agent.id);
                                w.choosePreset(p.id);
                                setPicker(false);
                              }}
                            >
                              <span>{presetTitle(p)}</span>
                              {agent.id === s.newEndpoint &&
                                s.preset === p.id && <Check size={14} />}
                            </button>
                          ))
                        ) : (
                          <button
                            type="button"
                            className="preset-choice"
                            onClick={() => {
                              w.newSession(s.cwd, agent.id);
                              setPicker(false);
                            }}
                          >
                            使用 {agent.name}
                          </button>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
            <Tooltip content="输入设置 · 预设配置、模型与工作目录">
              <button
                className="icon-button composer-inspect"
                type="button"
                aria-label="查看输入设置"
                onClick={() => void showDetails()}
              >
                <SlidersHorizontal size={15} />
              </button>
            </Tooltip>
          </div>
          <div className="composer-model-controls">
            <label
              className="select-control model-picker"
              title={
                model?.contextWindow
                  ? `${model.name || model.id}\n上下文上限：${model.contextWindow.toLocaleString()} tokens`
                  : '选择模型'
              }
            >
              <span className="sr-only">模型</span>
              <select
                aria-label="模型"
                value={
                  s.model
                    ? JSON.stringify([s.model.provider, s.model.model])
                    : ''
                }
                disabled={s.busy || s.modelLoading}
                onChange={(e) => {
                  const [provider, modelID] = JSON.parse(e.target.value) as [
                    string,
                    string,
                  ];
                  const chosen = s.models.find(
                    (m) => m.id === modelID && m.provider === provider,
                  );
                  void w.chooseModel({
                    provider,
                    model: modelID,
                    ...(chosen?.reasoning?.defaultEffort
                      ? { reasoningEffort: chosen.reasoning.defaultEffort }
                      : {}),
                  });
                }}
              >
                <option value="" disabled>
                  {s.modelLoading ? '读取模型…' : '选择模型'}
                </option>
                {s.models.map((m) => (
                  <option
                    key={JSON.stringify([m.provider, m.id])}
                    value={JSON.stringify([m.provider, m.id])}
                  >
                    {m.name || m.id}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            {!!efforts.length && (
              <label className="select-control effort-picker" title="推理强度">
                <Brain size={14} />
                <span className="sr-only">推理强度</span>
                <select
                  aria-label="推理强度"
                  value={
                    s.model?.reasoningEffort ||
                    model?.reasoning?.defaultEffort ||
                    efforts[0].id
                  }
                  disabled={s.busy || s.modelLoading}
                  onChange={(e) => {
                    if (s.model)
                      void w.chooseModel({
                        ...s.model,
                        reasoningEffort: e.target.value,
                      });
                  }}
                >
                  {efforts.map((e) => (
                    <option key={e.id} value={e.id}>
                      {effortTitle(e.id)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} />
              </label>
            )}
            {s.view?.run.canCancel ? (
              <Tooltip content="停止当前任务">
                <button
                  className="stop-button"
                  type="button"
                  aria-label="停止当前任务"
                  onClick={() => void w.cancel()}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip
                content={
                  s.busy ? s.submissionStage || '正在发送' : '发送消息 · Enter'
                }
              >
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送消息"
                  disabled={!w.canSend()}
                >
                  {s.busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowUp size={18} />
                  )}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        {(s.busy || s.controlsError) && (
          <div
            className={`composer-feedback ${s.controlsError ? 'error' : ''}`}
            role="status"
          >
            {s.controlsError || s.submissionStage}
          </div>
        )}
      </form>
      {details && (
        <Dialog title="输入设置" onClose={() => setDetails(false)}>
          <dl className="composer-details">
            <div>
              <dt>Harness</dt>
              <dd>
                {endpoint?.name} ·{' '}
                {endpoint?.host?.product.version || '未知版本'}
              </dd>
            </div>
            <div>
              <dt>预设</dt>
              <dd>
                {s.selected && !s.preset
                  ? 'Harness 未报告'
                  : presetTitle(
                      preset || (s.preset ? { id: s.preset } : undefined),
                    )}
                {s.selected && <small>此会话创建时的预设</small>}
              </dd>
            </div>
            <div>
              <dt>工作目录</dt>
              <dd>{cwd || s.hostWorkspace}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{model?.name || s.model?.model || '尚未选择'}</dd>
            </div>
            {model?.contextWindow && (
              <div>
                <dt>上下文上限</dt>
                <dd>{model.contextWindow.toLocaleString()} tokens</dd>
              </div>
            )}
            {!!efforts.length && (
              <div>
                <dt>推理强度</dt>
                <dd>
                  {effortTitle(
                    s.model?.reasoningEffort ||
                      model?.reasoning?.defaultEffort ||
                      efforts[0].id,
                  )}
                </dd>
              </div>
            )}
          </dl>
          <details className="preset-configuration" open>
            <summary>
              <Info size={14} />
              预设配置
              <ChevronDown size={13} />
            </summary>
            <pre>{configuration}</pre>
          </details>
          <p className="dialog-note">
            选择的预设会用于新会话的初始配置。已有会话的 Harness
            与初始预设由会话自身保存。
          </p>
        </Dialog>
      )}
    </>
  );
}
