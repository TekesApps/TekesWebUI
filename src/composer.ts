import { t } from './i18n';
import type { AgentClient } from './api';
import type {
  AttachmentPolicy,
  Endpoint,
  ModelChoice,
  Preset,
  PresetCatalog,
} from './types';

export const presetTitle = (preset?: Preset) =>
  preset?.title ||
  preset?.name ||
  {
    standard: t('标准'),
    ptc: 'PTC',
    minimal: t('精简'),
    cordis: 'Creative',
    coding: 'Coding',
    general: 'General',
    default: t('默认'),
  }[preset?.id || ''] ||
  preset?.id ||
  t('默认');
export const effortTitle = (value: string) =>
  ({
    low: t('低'),
    medium: t('中'),
    high: t('高'),
    max: t('最高'),
    minimal: t('最低'),
    off: t('关闭'),
  })[value] || value;
export function sameModel(a: ModelChoice | null, b: ModelChoice | null) {
  return a?.provider === b?.provider && a?.model === b?.model;
}
export function creationPreset(
  endpoint: Endpoint,
  preset: string | null,
): Record<string, string> {
  if (!preset) return {};
  return endpoint.kind === 'tekes'
    ? { identityProfile: preset }
    : { agentPreset: preset };
}
export async function readPresets(
  client: AgentClient,
  endpoint: Endpoint,
): Promise<PresetCatalog> {
  const methods = endpoint.capabilities?.methods || [];
  if (methods.includes('session.initialPresets'))
    return client.call<PresetCatalog>(endpoint.id, 'session.initialPresets');
  if (!methods.includes('presets.list')) return { presets: [] };
  const result = await client.call<PresetCatalog>(endpoint.id, 'presets.list');
  // Same public DSH roster + document composition as ClientKit's initialPresets().
  const presets = await Promise.all(
    result.presets.map(async (preset) => {
      if (preset.broken || !methods.includes('presets.read')) return preset;
      try {
        const document = await client.call<{ content?: string }>(
          endpoint.id,
          'presets.read',
          { agentPreset: preset.id },
        );
        return { ...preset, configurationText: document.content };
      } catch {
        return { ...preset, configurationText: null };
      }
    }),
  );
  return {
    ...result,
    presets,
    defaultID: result.defaultID || presets.find((p) => p.isDefault)?.id,
  };
}
export const UPLOAD_LIMIT = 8 * 1024 * 1024; // Existing public AgentKit upload contract.
export function validateFiles(
  files: File[],
  existing: File[],
  policy: AttachmentPolicy | null,
) {
  const all = [...existing, ...files];
  if (all.length > Math.min(policy?.maxAttachmentsPerMessage || 8, 20))
    throw new Error(t('附件数量超过当前 Harness 的限制，请移除一部分后再试。'));
  for (const file of files) {
    if (!file.size) throw new Error(t('{0} 是空文件。', file.name));
    const limit = file.type.startsWith('image/')
      ? Math.min(UPLOAD_LIMIT, policy?.maxAttachmentBytes || UPLOAD_LIMIT)
      : UPLOAD_LIMIT;
    if (file.size > limit)
      throw new Error(
        t(
          '{0} 超过附件大小限制（{1} MB）。',
          file.name,
          Math.floor(limit / 1024 / 1024),
        ),
      );
  }
  if (
    all.reduce((sum, file) => sum + file.size, 0) >
    (policy?.maxMessageAttachmentBytes || 16 * 1024 * 1024)
  )
    throw new Error(t('附件总大小超过当前 Harness 的限制。'));
}
export async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export const byteSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : size >= 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${size} B`;
