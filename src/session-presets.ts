import type { Model } from './types';
export interface SessionPresetDefaults {
  provider: string;
  model: string;
  reasoningEffort?: string;
}
export interface SessionPresetMcpReference {
  server: string;
  tools: string[];
}
export interface SessionPresetSelection {
  tools?: string[];
  skills?: string[];
  mcp?: SessionPresetMcpReference[];
}
export interface InlinePresetLayer extends SessionPresetSelection {
  kind: 'inline';
  id: string;
  version: string;
  identity?: string;
  duty?: string;
  defaults?: SessionPresetDefaults;
}
export type SessionPresetLayer =
  { kind: 'kernel'; id: string } | InlinePresetLayer;
export interface SessionPreset extends SessionPresetSelection {
  layers?: SessionPresetLayer[];
  defaults?: SessionPresetDefaults;
}
export interface SessionPresetDescription {
  format: number;
  renderVersion: number;
  bases: { id: string; identity?: string; rules?: string }[];
  kernelLayers: {
    kind: string;
    id: string;
    version: string;
    title?: string;
    identity?: string;
    duty?: string;
  }[];
  limits: {
    maxLayers: number;
    maxIdBytes: number;
    maxVersionBytes: number;
    maxIdentityBytes: number;
    maxDutyBytes: number;
    maxTextBytes: number;
    maxTools: number;
    maxMcpServers: number;
    maxMcpToolsPerServer: number;
    maxSkills: number;
  };
  selectableTools: string[];
  invalidReasons: string[];
}
export interface SessionPresetResolution {
  base: string;
  layers: { kind: string; id: string; version: string }[];
  presetText: string;
  digest: string;
  tools?: string[];
  skills?: string[];
  defaults?: SessionPresetDefaults;
  mcp?: { server: string; digest: string; tools: string[] }[];
  mcpReadiness?: {
    server: string;
    status: string;
    code?: string;
    missingTools?: string[];
    refusedTools?: { tool: string; code: string }[];
  }[];
}
export interface PresetDescriptionSnapshot {
  endpointId: string;
  connectionEpoch: number;
  description: SessionPresetDescription;
}
export interface PresetPreviewSnapshot {
  endpointId: string;
  connectionEpoch: number;
  preset: SessionPreset;
  resolution: SessionPresetResolution;
}
export function presetHasDefaults(preset: SessionPreset): boolean {
  return (
    !!preset.defaults ||
    !!preset.layers?.some(
      (layer) => layer.kind === 'inline' && !!layer.defaults,
    )
  );
}
export function presetSignature(preset: SessionPreset): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return value;
  }
  return JSON.stringify(canonical(preset));
}
export function presetDraftError(
  preset: SessionPreset,
  description: SessionPresetDescription,
  models: Model[],
): string | null {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const layers = preset.layers || [],
    limits = description.limits;
  if (layers.length > limits.maxLayers) return '预设层数超过当前 Kernel 限制。';
  const ids = new Set<string>();
  let identities = 0;
  const selections: SessionPresetSelection[] = [preset];
  const defaults: SessionPresetDefaults[] = [];
  if (preset.defaults) defaults.push(preset.defaults);
  for (const layer of layers) {
    if (ids.has(layer.id)) return '预设层 ID 必须唯一。';
    ids.add(layer.id);
    if (layer.kind === 'kernel') {
      if (!description.kernelLayers.some((known) => known.id === layer.id))
        return '预设引用了未知的 Kernel 层。';
      continue;
    }
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(layer.id) ||
      bytes(layer.id) > limits.maxIdBytes
    )
      return '请填写合法的预设层 ID。';
    if (
      !/^[\x21-\x7e]+$/.test(layer.version) ||
      bytes(layer.version) > limits.maxVersionBytes
    )
      return '预设版本须为限制内的可见 ASCII 文本。';
    if (layer.identity !== undefined) {
      identities++;
      if (
        !layer.identity.trim() ||
        /[\r\n]/.test(layer.identity) ||
        bytes(layer.identity) > limits.maxIdentityBytes
      )
        return '身份说明须为限制内的单行文本。';
    }
    if (layer.duty !== undefined && bytes(layer.duty) > limits.maxDutyBytes)
      return '职责文本超过当前 Kernel 的字节限制。';
    selections.push(layer);
    if (layer.defaults) defaults.push(layer.defaults);
  }
  if (identities > 1) return '最多只能有一个自定义身份说明。';
  for (const selection of selections) {
    if (
      selection.tools &&
      (selection.tools.length > limits.maxTools ||
        selection.tools.some(
          (tool) => !description.selectableTools.includes(tool),
        ))
    )
      return '工具选择超出当前 Kernel 的公开目录。';
    if (
      selection.skills &&
      (selection.skills.length > limits.maxSkills ||
        selection.skills.some((skill) => !skill.trim()))
    )
      return '技能引用超出当前 Kernel 限制。';
    if (
      selection.mcp &&
      (selection.mcp.length > limits.maxMcpServers ||
        selection.mcp.some(
          (reference) => reference.tools.length > limits.maxMcpToolsPerServer,
        ))
    )
      return 'MCP 引用超出当前 Kernel 限制。';
  }
  for (const value of defaults) {
    const model = models.find(
      (model) => model.provider === value.provider && model.id === value.model,
    );
    if (
      !model ||
      (value.reasoningEffort &&
        !model.reasoning?.efforts.some(
          (effort) => effort.id === value.reasoningEffort,
        ))
    )
      return '启动模型或推理档位已不在当前目录中。';
  }
  return null;
}
