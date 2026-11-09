import { useEffect, useRef, useState } from 'react';
import type {
  HarnessSettingField,
  HarnessSettingsMutation,
  HarnessSettingsSnapshot,
  HarnessSettingValue,
} from '../harness-settings';
import { displayError } from '../state';
import { t } from '../i18n';

export interface HarnessSettingsProps {
  endpointId: string;
  /** Pi reads additionally bind its source session. */
  sessionId?: string;
  load: () => Promise<HarnessSettingsSnapshot>;
  mutate: (request: HarnessSettingsMutation) => Promise<unknown>;
}

export function HarnessSettings(props: HarnessSettingsProps) {
  return (
    <ScopedSettings
      key={JSON.stringify([props.endpointId, props.sessionId])}
      {...props}
    />
  );
}
function draftValue(field: HarnessSettingField): string | boolean {
  if (field.kind === 'boolean') return field.value === true;
  if (field.kind === 'stringList')
    return Array.isArray(field.value) ? field.value.join('\n') : '';
  return field.value === null ? '' : String(field.value);
}
function formValue(
  field: HarnessSettingField,
  draft: string | boolean,
): Exclude<HarnessSettingValue, null> {
  if (field.kind === 'boolean') return draft === true;
  if (field.kind === 'stringList')
    return String(draft).split('\n').filter(Boolean);
  if (field.kind === 'integer' || field.kind === 'number') {
    if (!String(draft).trim()) throw new Error(t('请填写有效数值。'));
    const number = Number(draft);
    if (
      !Number.isFinite(number) ||
      (field.kind === 'integer' && !Number.isSafeInteger(number)) ||
      (field.minimum !== undefined && number < field.minimum) ||
      (field.maximum !== undefined && number > field.maximum)
    )
      throw new Error(t('请填写有效数值。'));
    return number;
  }
  return String(draft);
}
function ScopedSettings({ endpointId, load, mutate }: HarnessSettingsProps) {
  const [snapshot, setSnapshot] = useState<HarnessSettingsSnapshot | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const callbacks = useRef({ load, mutate });
  callbacks.current = { load, mutate };
  async function read() {
    const value = await callbacks.current.load();
    if (!mounted.current) return;
    if (value.endpointId !== endpointId)
      throw new Error(t('设置来源已变化，请重新读取。'));
    setSnapshot(value);
    setFresh(true);
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await read();
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
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save(
    namespace: string,
    field: HarnessSettingField,
    unset = false,
  ) {
    if (pending.current || !fresh || !snapshot || !field.writable) return;
    const owner = snapshot.namespaces.find((ns) => ns.id === namespace);
    if (owner?.revision === null || owner?.revision === undefined) return;
    const key = JSON.stringify([namespace, field.path]);
    let change: HarnessSettingsMutation['changes'][number];
    try {
      change = unset
        ? { path: field.path, unset: true }
        : {
            path: field.path,
            value: formValue(field, drafts[key] ?? draftValue(field)),
          };
    } catch (cause) {
      setError(displayError(cause));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await callbacks.current.mutate({
        connectionEpoch: snapshot.connectionEpoch,
        namespace,
        expectedRevision: owner.revision,
        changes: [change],
      });
      if (!mounted.current) return;
      setFresh(false);
      setDrafts((values) => {
        const next = { ...values };
        delete next[key];
        return next;
      });
      setNotice(t('设置已保存，正在读取最新状态。'));
      try {
        await read();
        if (mounted.current) setNotice(t('设置已保存。'));
      } catch (cause) {
        if (mounted.current) {
          setError(displayError(cause));
          setNotice(t('保存已确认；请刷新核对状态，不会自动重发。'));
        }
      }
    } catch (cause) {
      if (mounted.current) {
        setFresh(false);
        setError(displayError(cause));
        setNotice(t('保存结果尚未确认，请刷新核对后再操作。'));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="family-panel" aria-label={t('Harness 设置')}>
      <div className="family-heading">
        <h3>{t('Harness 设置')}</h3>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {t('刷新设置')}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!snapshot && <p>{t('正在读取设置…')}</p>}
      {snapshot?.namespaces.map((namespace) => (
        <fieldset key={namespace.id} disabled={busy}>
          <legend>{namespace.title}</legend>
          <p className="dialog-note">
            {namespace.applies === 'next-launch'
              ? t('修改将在下次启动时生效。')
              : namespace.applies === 'live'
                ? t('修改会立即生效。')
                : t('当前运行时的有效设置。')}
          </p>
          {namespace.readOnlyReason && (
            <p className="dialog-note">
              {t('当前集成仅提供此设置的只读视图。')}
            </p>
          )}
          {!namespace.fields.length && (
            <p>{t('此命名空间没有可显示的非敏感设置。')}</p>
          )}
          {namespace.fields.map((field) => {
            const key = JSON.stringify([namespace.id, field.path]);
            const draft = drafts[key] ?? draftValue(field);
            const disabled = busy || !fresh || !field.writable;
            const changed =
              Object.hasOwn(drafts, key) &&
              JSON.stringify(drafts[key]) !== JSON.stringify(draftValue(field));
            return (
              <div className="harness-setting" key={key}>
                <label>
                  {field.label}
                  {field.kind === 'unavailable' ? (
                    <span>{t('此设置需要 Harness 专用编辑器。')}</span>
                  ) : field.kind === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={draft === true}
                      disabled={disabled}
                      onChange={(event) =>
                        setDrafts((values) => ({
                          ...values,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                  ) : field.kind === 'enum' ? (
                    <select
                      value={String(draft)}
                      disabled={disabled}
                      onChange={(event) =>
                        setDrafts((values) => ({
                          ...values,
                          [key]: event.target.value,
                        }))
                      }
                    >
                      <option value="" disabled>
                        {t('未设置')}
                      </option>
                      {field.options?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.kind === 'string' || field.kind === 'stringList' ? (
                    <textarea
                      value={String(draft)}
                      disabled={disabled}
                      rows={field.kind === 'stringList' ? 3 : 2}
                      onChange={(event) =>
                        setDrafts((values) => ({
                          ...values,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <input
                      type="number"
                      value={String(draft)}
                      disabled={disabled}
                      min={field.minimum}
                      max={field.maximum}
                      step={field.kind === 'integer' ? 1 : 'any'}
                      onChange={(event) =>
                        setDrafts((values) => ({
                          ...values,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </label>
                {field.description && (
                  <p className="dialog-note">{field.description}</p>
                )}
                {field.kind === 'stringList' && (
                  <p className="dialog-note">{t('每行填写一项。')}</p>
                )}
                {field.value === null && (
                  <p className="dialog-note">
                    {t('尚未设置，当前使用 Harness 默认值。')}
                  </p>
                )}
                {field.writable && (
                  <div className="dialog-actions">
                    <button
                      type="button"
                      disabled={disabled || !changed}
                      onClick={() => void save(namespace.id, field)}
                    >
                      {t('保存此设置')}
                    </button>
                    {field.overridden && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void save(namespace.id, field, true)}
                      >
                        {t('恢复继承值')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </section>
  );
}
