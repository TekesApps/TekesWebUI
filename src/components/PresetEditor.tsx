import { useEffect, useRef, useState } from 'react';
import type { Model } from '../types';
import type {
  InlinePresetLayer,
  PresetDescriptionSnapshot,
  PresetPreviewSnapshot,
  SessionPreset,
  SessionPresetDefaults,
  SessionPresetDescription,
  SessionPresetResolution,
  SessionPresetSelection,
} from '../session-presets';
import { presetDraftError, presetSignature } from '../session-presets';
import { displayError } from '../state';
import { t } from '../i18n';
export interface PresetEditorProps {
  endpointId: string;
  cwd: string;
  connectionEpoch: number;
  describe: () => Promise<PresetDescriptionSnapshot>;
  preview: (preset: SessionPreset) => Promise<PresetPreviewSnapshot>;
  models: Model[];
  initialPreset?: SessionPreset;
  onApply: (preset: SessionPreset, resolution: SessionPresetResolution) => void;
}
export function PresetEditor(props: PresetEditorProps) {
  return (
    <ScopedPresetEditor
      key={JSON.stringify([props.endpointId, props.cwd, props.connectionEpoch])}
      {...props}
    />
  );
}
function SelectionFields({
  selection,
  description,
  onChange,
}: {
  selection: SessionPresetSelection;
  description: SessionPresetDescription;
  onChange: (selection: SessionPresetSelection) => void;
}) {
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={selection.tools !== undefined}
          onChange={(event) =>
            onChange({
              ...selection,
              tools: event.target.checked ? [] : undefined,
            })
          }
        />
        {t('显式选择工具（不增加宿主权限）')}
      </label>
      {selection.tools !== undefined && (
        <div className="preset-tools">
          {description.selectableTools.map((tool) => (
            <label key={tool}>
              <input
                type="checkbox"
                checked={selection.tools!.includes(tool)}
                onChange={(event) =>
                  onChange({
                    ...selection,
                    tools: event.target.checked
                      ? [...selection.tools!, tool]
                      : selection.tools!.filter((value) => value !== tool),
                  })
                }
              />
              {tool}
            </label>
          ))}
        </div>
      )}
      <label>
        <input
          type="checkbox"
          checked={selection.skills !== undefined}
          onChange={(event) =>
            onChange({
              ...selection,
              skills: event.target.checked ? [] : undefined,
            })
          }
        />
        {t('显式选择技能包')}
      </label>
      {selection.skills !== undefined && (
        <label>
          {t('技能包目录名，每行一项；由预览验证。')}
          <textarea
            value={selection.skills.join('\n')}
            onChange={(event) =>
              onChange({
                ...selection,
                skills: event.target.value.split('\n').filter(Boolean),
              })
            }
          />
        </label>
      )}
      <p className="dialog-note">
        {t('当前宿主未配置 MCP 连接，不能在这里新建连接或输入凭据。')}
      </p>
      {!!selection.mcp?.length && (
        <>
          <p>
            {selection.mcp
              .map(
                (reference) =>
                  `${reference.server}: ${reference.tools.join(', ')}`,
              )
              .join('; ')}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...selection, mcp: undefined })}
          >
            {t('移除 MCP 引用')}
          </button>
        </>
      )}
    </>
  );
}
function ModelDefaults({
  value,
  models,
  onChange,
}: {
  value?: SessionPresetDefaults;
  models: Model[];
  onChange: (value?: SessionPresetDefaults) => void;
}) {
  const selected = models.find(
    (model) => model.provider === value?.provider && model.id === value?.model,
  );
  return (
    <>
      <label>
        <input
          type="checkbox"
          disabled={!models.length}
          checked={!!value}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { provider: models[0].provider, model: models[0].id }
                : undefined,
            )
          }
        />
        {t('设置启动模型')}
      </label>
      {value && (
        <>
          <select
            aria-label={t('预设启动模型')}
            value={JSON.stringify([value.provider, value.model])}
            onChange={(event) => {
              const [provider, model] = JSON.parse(
                event.target.value,
              ) as string[];
              onChange({ provider, model });
            }}
          >
            {models.map((model) => (
              <option
                key={JSON.stringify([model.provider, model.id])}
                value={JSON.stringify([model.provider, model.id])}
              >
                {model.provider} / {model.name || model.id}
              </option>
            ))}
          </select>
          {!!selected?.reasoning?.efforts.length && (
            <select
              aria-label={t('预设推理档位')}
              value={value.reasoningEffort || ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  reasoningEffort: event.target.value || undefined,
                })
              }
            >
              <option value="">{t('使用模型默认档位')}</option>
              {selected.reasoning.efforts.map((effort) => (
                <option key={effort.id} value={effort.id}>
                  {effort.name || effort.id}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </>
  );
}
function ScopedPresetEditor({
  endpointId,
  cwd,
  connectionEpoch,
  describe,
  preview,
  models,
  initialPreset,
  onApply,
}: PresetEditorProps) {
  const [description, setDescription] =
    useState<SessionPresetDescription | null>(null);
  const [draft, setDraft] = useState<SessionPreset>(() =>
    initialPreset
      ? (JSON.parse(JSON.stringify(initialPreset)) as SessionPreset)
      : {},
  );
  const [resolved, setResolved] = useState<PresetPreviewSnapshot | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const mounted = useRef(false),
    pending = useRef(false),
    generation = useRef(0);
  const callbacks = useRef({ describe, preview, onApply });
  callbacks.current = { describe, preview, onApply };
  const signature = presetSignature(draft);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  function change(next: SessionPreset) {
    generation.current++;
    setDraft(next);
    setResolved(null);
    setError('');
  }
  async function readDescription() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const request = ++generation.current;
    try {
      const result = await callbacks.current.describe();
      if (!mounted.current || request !== generation.current) return;
      if (
        result.endpointId !== endpointId ||
        result.connectionEpoch !== connectionEpoch
      )
        throw new Error(t('预设来源已变化，请重新打开。'));
      setDescription(result.description);
    } catch (cause) {
      if (mounted.current) setError(displayError(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void readDescription();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  async function resolve() {
    if (pending.current || !description) return;
    const problem = presetDraftError(draft, description, models);
    if (problem) {
      setError(t(problem));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setResolved(null);
    const request = ++generation.current;
    const captured = JSON.parse(JSON.stringify(draft)) as SessionPreset;
    const capturedSignature = signature;
    try {
      const result = await callbacks.current.preview(captured);
      if (
        !mounted.current ||
        request !== generation.current ||
        currentSignature.current !== capturedSignature
      )
        return;
      if (
        result.endpointId !== endpointId ||
        result.connectionEpoch !== connectionEpoch ||
        presetSignature(result.preset) !== capturedSignature
      )
        throw new Error(t('预设预览与当前草稿不一致，请重新预览。'));
      setResolved(result);
    } catch (cause) {
      if (mounted.current && request === generation.current)
        setError(displayError(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function updateLayer(index: number, next: InlinePresetLayer) {
    change({
      ...draft,
      layers: draft.layers?.map((layer, i) => (i === index ? next : layer)),
    });
  }
  const layers = draft.layers || [];
  const validPreview =
    resolved && presetSignature(resolved.preset) === signature;
  return (
    <section className="family-panel" aria-label={t('高级会话预设')}>
      <div className="family-heading">
        <h3>{t('高级会话预设')}</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void readDescription()}
        >
          {t('重新读取预设目录')}
        </button>
      </div>
      <p>{t('工作目录：{0}', cwd)}</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="dialog-note">
        {t('预览只解析初始配置，不创建会话、不启动模型或 MCP 服务器。')}
      </p>
      {description && (
        <fieldset disabled={busy}>
          <legend>{t('预设层（按显示顺序合并）')}</legend>
          {layers.map((layer, index) => (
            <div key={index} className="preset-layer">
              <div>
                <strong>
                  {layer.kind === 'kernel'
                    ? description.kernelLayers.find(
                        (known) => known.id === layer.id,
                      )?.title || layer.id
                    : t('自定义层')}
                </strong>
                <button
                  type="button"
                  disabled={!index}
                  aria-label={t('上移预设层')}
                  onClick={() => {
                    const next = [...layers];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    change({ ...draft, layers: next });
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === layers.length - 1}
                  aria-label={t('下移预设层')}
                  onClick={() => {
                    const next = [...layers];
                    [next[index + 1], next[index]] = [
                      next[index],
                      next[index + 1],
                    ];
                    change({ ...draft, layers: next });
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    change({
                      ...draft,
                      layers: layers.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t('移除预设层')}
                </button>
              </div>
              {layer.kind === 'inline' && (
                <>
                  <label>
                    {t('层 ID')}
                    <input
                      value={layer.id}
                      onChange={(event) =>
                        updateLayer(index, { ...layer, id: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t('层版本')}
                    <input
                      value={layer.version}
                      onChange={(event) =>
                        updateLayer(index, {
                          ...layer,
                          version: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t('身份说明（可选，单行）')}
                    <input
                      value={layer.identity || ''}
                      onChange={(event) =>
                        updateLayer(index, {
                          ...layer,
                          identity: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t('职责文本（可选）')}
                    <textarea
                      value={layer.duty || ''}
                      onChange={(event) =>
                        updateLayer(index, {
                          ...layer,
                          duty: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <SelectionFields
                    selection={layer}
                    description={description}
                    onChange={(selection) =>
                      updateLayer(index, { ...layer, ...selection })
                    }
                  />
                  <ModelDefaults
                    value={layer.defaults}
                    models={models}
                    onChange={(defaults) =>
                      updateLayer(index, { ...layer, defaults })
                    }
                  />
                </>
              )}
            </div>
          ))}
          <label>
            {t('添加 Kernel 层')}
            <select
              value=""
              disabled={layers.length >= description.limits.maxLayers}
              onChange={(event) => {
                if (event.target.value)
                  change({
                    ...draft,
                    layers: [
                      ...layers,
                      { kind: 'kernel', id: event.target.value },
                    ],
                  });
              }}
            >
              <option value="">{t('选择预设层')}</option>
              {description.kernelLayers
                .filter(
                  (layer) =>
                    !layers.some((selected) => selected.id === layer.id),
                )
                .map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.title || layer.id} · {layer.version}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={layers.length >= description.limits.maxLayers}
            onClick={() => {
              let i = layers.length + 1;
              while (layers.some((layer) => layer.id === `custom-${i}`)) i++;
              change({
                ...draft,
                layers: [
                  ...layers,
                  { kind: 'inline', id: `custom-${i}`, version: '1' },
                ],
              });
            }}
          >
            {t('添加自定义层')}
          </button>
          <h4>{t('顶层选择')}</h4>
          <SelectionFields
            selection={draft}
            description={description}
            onChange={(selection) => change({ ...draft, ...selection })}
          />
          <ModelDefaults
            value={draft.defaults}
            models={models}
            onChange={(defaults) => change({ ...draft, defaults })}
          />
          <p className="dialog-note">
            {t(
              '最多 {0} 层；身份 {1} 字节；每层职责 {2} 字节。最终限制由 Kernel 预览验证。',
              description.limits.maxLayers,
              description.limits.maxIdentityBytes,
              description.limits.maxDutyBytes,
            )}
          </p>
          <button type="button" onClick={() => void resolve()}>
            {t('预览初始配置')}
          </button>
        </fieldset>
      )}
      {resolved && validPreview && (
        <div className="preset-preview">
          <h4>{t('已解析的只读预览')}</h4>
          <p>{t('基础：{0}', resolved.resolution.base)}</p>
          <p>{t('配置摘要：{0}', resolved.resolution.digest)}</p>
          <pre>{resolved.resolution.presetText}</pre>
          {resolved.resolution.defaults && (
            <p>
              {t(
                '启动模型：{0} / {1}',
                resolved.resolution.defaults.provider,
                resolved.resolution.defaults.model,
              )}
            </p>
          )}
          {!!resolved.resolution.tools?.length && (
            <p>{t('工具：{0}', resolved.resolution.tools.join(', '))}</p>
          )}
          {!!resolved.resolution.skills?.length && (
            <p>{t('技能包：{0}', resolved.resolution.skills.join(', '))}</p>
          )}
          {!!resolved.resolution.mcp?.length && (
            <p>{t('MCP 引用已解析，但当前结果没有证明服务器就绪。')}</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              callbacks.current.onApply(
                JSON.parse(JSON.stringify(resolved.preset)) as SessionPreset,
                resolved.resolution,
              )
            }
          >
            {t('用于下一次新建会话')}
          </button>
        </div>
      )}
    </section>
  );
}
