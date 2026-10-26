import { t } from '../i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowUp,
  Brain,
  ChevronDown,
  FileText,
  Info,
  LoaderCircle,
  LockKeyhole,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from './ui/Icons';
import type { Workspace, WorkspaceState } from '../workspace';
import { permissionTitle } from '../permissions';
import { byteSize, effortTitle, presetTitle } from '../composer';
import { shouldSend } from '../state';
import { Dialog } from './Dialog';
import { ComposerAnnotations } from './Annotations';
import { Tooltip } from './Tooltip';
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  ChoiceMenu,
} from './ui/Menu';

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
    composing = useRef(false);
  const [details, setDetails] = useState(false),
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
    setDragging(false);
    setDetails(false);
  }, [s.selected?.endpoint, s.selected?.sessionId, s.newEndpoint, s.cwd]);
  async function showDetails() {
    setDetails(true);
    setConfiguration(t('正在读取配置…'));
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
        <ComposerAnnotations
          key={w.key()}
          annotations={s.annotations}
          address={s.selected}
          onSave={w.saveAnnotation}
          onRemove={w.removeAnnotation}
        />
        {!!s.attachments.length && (
          <div className="attachment-tray" aria-label={t('待发送附件')}>
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
                  aria-label={t('移除附件 {0}', attachment.file.name)}
                  title={t('移除附件')}
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
          {t('消息')}
        </label>
        <textarea
          ref={prompt}
          id="prompt"
          rows={2}
          placeholder={
            dragging
              ? t('松开以添加附件')
              : s.selected
                ? t('继续对话…')
                : t('描述一个想法，或交给我一项任务…')
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
              aria-label={t('选择附件文件')}
              onChange={(e) => {
                w.addFiles(Array.from(e.target.files || []));
                e.target.value = '';
                prompt.current?.focus();
              }}
            />
            <Tooltip
              content={
                canAttach
                  ? t('添加附件 · 也可拖入文件或粘贴图片')
                  : t('当前 Harness 不支持附件')
              }
            >
              <button
                className="composer-add icon-button"
                type="button"
                aria-label={t('添加附件')}
                disabled={s.busy || s.controlsLoading || !canAttach}
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={19} />
              </button>
            </Tooltip>
            {s.selected ? (
              <button
                className="composer-chip harness-chip"
                type="button"
                aria-label={t('查看会话 Harness 与预设')}
                disabled={s.busy}
                onClick={() => void showDetails()}
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
                  {s.preset
                    ? ` · ${presetTitle(preset || { id: s.preset })}`
                    : ''}
                </span>
                <LockKeyhole size={11} />
              </button>
            ) : (
              <Menu
                label={t('选择 Harness 与预设')}
                side="top"
                align="start"
                wide
                trigger={
                  <button
                    className="composer-chip harness-chip"
                    type="button"
                    aria-label={t('选择 Harness 与预设')}
                    disabled={s.busy}
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
                        ? t(' · 读取中')
                        : s.preset
                          ? ` · ${presetTitle(preset || { id: s.preset })}`
                          : ''}
                    </span>
                    <ChevronDown size={12} />
                  </button>
                }
              >
                {s.endpoints.map((agent, index) => (
                  <div key={agent.id}>
                    {index > 0 && <MenuSeparator />}
                    <MenuLabel>
                      <span>{agent.name}</span>
                      <small>
                        {agent.host?.product.version || t('未连接')}
                      </small>
                    </MenuLabel>
                    {s.presets.get(agent.id)?.presets.length ? (
                      s.presets.get(agent.id)!.presets.map((p) => (
                        <MenuItem
                          key={p.id}
                          selected={
                            agent.id === s.newEndpoint && s.preset === p.id
                          }
                          disabled={!!p.broken || !!p.unavailableReason}
                          description={
                            p.broken ||
                            p.unavailableReason ||
                            p.description ||
                            undefined
                          }
                          onSelect={() => {
                            if (agent.id !== s.newEndpoint)
                              w.newSession(s.cwd, agent.id);
                            w.choosePreset(p.id);
                          }}
                        >
                          {presetTitle(p)}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem onSelect={() => w.newSession(s.cwd, agent.id)}>
                        {t('使用 ')}
                        {agent.name}
                      </MenuItem>
                    )}
                  </div>
                ))}
              </Menu>
            )}
            {s.permissionPolicy &&
              (s.permissionPolicy.threadLevel.length ? (
                <ChoiceMenu
                  label={
                    s.permissionLoading
                      ? t('正在应用权限…')
                      : s.permissionMode
                        ? t('权限模式')
                        : s.selected
                          ? t('Harness 未报告权限')
                          : t('Harness 默认权限')
                  }
                  icon={<LockKeyhole size={14} />}
                  value={s.permissionMode || ''}
                  disabled={s.busy || s.controlsLoading || s.permissionLoading}
                  options={s.permissionPolicy.threadLevel.map((option) => ({
                    value: option.value,
                    label: permissionTitle(option),
                    description: option.description || undefined,
                  }))}
                  onChange={(value) => void w.choosePermission(value)}
                />
              ) : s.permissionPolicy.serverLevel.currentValue ? (
                <span
                  className="composer-chip"
                  title={t('权限由 Harness 固定管理')}
                >
                  <LockKeyhole size={14} />
                  {permissionTitle(
                    s.permissionPolicy.serverLevel.options.find(
                      (o) =>
                        o.value ===
                        s.permissionPolicy!.serverLevel.currentValue,
                    ) || { value: s.permissionPolicy.serverLevel.currentValue },
                  )}
                </span>
              ) : null)}
            <Tooltip content={t('输入设置 · 预设配置、模型与工作目录')}>
              <button
                className="icon-button composer-inspect"
                type="button"
                aria-label={t('查看输入设置')}
                onClick={() => void showDetails()}
              >
                <SlidersHorizontal size={15} />
              </button>
            </Tooltip>
          </div>
          <div
            className={`composer-model-controls ${s.busy ? 'submitting' : ''}`}
            aria-busy={s.busy}
          >
            {s.busy && (
              <div className="composer-progress" role="status">
                <LoaderCircle size={12} className="spin" />
                <span>{t(s.submissionStage || '正在发送')}</span>
              </div>
            )}
            <ChoiceMenu
              label={s.modelLoading ? t('读取模型…') : t('模型')}
              value={
                s.model ? JSON.stringify([s.model.provider, s.model.model]) : ''
              }
              disabled={s.busy || s.modelLoading}
              className="model-picker"
              options={s.models.map((m) => ({
                value: JSON.stringify([m.provider, m.id]),
                label: m.name || m.id,
                description: `${m.contextWindow ? t('{0} tokens 上下文', m.contextWindow.toLocaleString()) : t('当前 Harness 提供的模型')}${s.models.some((other) => other !== m && other.id === m.id) ? ` · ${m.provider}` : ''}`,
              }))}
              onChange={(value) => {
                const [provider, modelID] = JSON.parse(value) as [
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
            />
            {!!efforts.length && (
              <ChoiceMenu
                label={t('推理强度')}
                icon={<Brain size={14} />}
                value={
                  s.model?.reasoningEffort ||
                  model?.reasoning?.defaultEffort ||
                  efforts[0].id
                }
                disabled={s.busy || s.modelLoading}
                options={efforts.map((e) => ({
                  value: e.id,
                  label: effortTitle(e.id),
                  description:
                    e.id === 'low'
                      ? t('更快响应，适合日常任务')
                      : e.id === 'high'
                        ? t('深入思考，适合复杂任务')
                        : e.id === 'max'
                          ? t('最高推理强度，可能需要更长时间')
                          : undefined,
                }))}
                onChange={(value) => {
                  if (s.model)
                    void w.chooseModel({ ...s.model, reasoningEffort: value });
                }}
              />
            )}
          </div>
        </div>
        {(s.controlsError || s.permissionError) && (
          <div
            className={`composer-feedback ${s.controlsError ? 'error' : ''}`}
            role="status"
          >
            {t(s.permissionError || s.controlsError)}
          </div>
        )}
      </form>
      {details && (
        <Dialog title={t('输入设置')} onClose={() => setDetails(false)}>
          <dl className="composer-details">
            <div>
              <dt>Harness</dt>
              <dd>
                {endpoint?.name} ·{' '}
                {endpoint?.host?.product.version || t('未知版本')}
              </dd>
            </div>
            <div>
              <dt>{t('预设')}</dt>
              <dd>
                {s.selected && !s.preset
                  ? t('Harness 未报告')
                  : presetTitle(
                      preset || (s.preset ? { id: s.preset } : undefined),
                    )}
                {s.selected && <small>{t('此会话创建时的预设')}</small>}
              </dd>
            </div>
            <div>
              <dt>{t('工作目录')}</dt>
              <dd>{cwd || s.hostWorkspace}</dd>
            </div>
            <div>
              <dt>{t('模型')}</dt>
              <dd>{model?.name || s.model?.model || t('尚未选择')}</dd>
            </div>
            {model?.contextWindow && (
              <div>
                <dt>{t('上下文上限')}</dt>
                <dd>{model.contextWindow.toLocaleString()} tokens</dd>
              </div>
            )}
            {!!efforts.length && (
              <div>
                <dt>{t('推理强度')}</dt>
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
              {t('预设配置')}
              <ChevronDown size={13} />
            </summary>
            <pre>{configuration}</pre>
          </details>
          <p className="dialog-note">
            {t(
              '选择的预设会用于新会话的初始配置。已有会话的 Harness 与初始预设由会话自身保存。',
            )}
          </p>
        </Dialog>
      )}
    </>
  );
}
