import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cleanEnvironment, jsonFile } from './private.js';

export const exec = promisify(execFile);
export const KERNEL_PIN = {
  format: 1,
  repository: 'https://github.com/TekesApps/TekesKernel.git',
  tag: 'v0.9.0',
  version: '0.9.0',
  revision: '768ed1622d7a7065d593c7d77963b7dd31216748',
};
export interface Model {
  id: string;
  enabled?: boolean;
  kernelProfile?: string;
  contextWindow?: number;
  compactTriggerTokens?: number;
  [key: string]: unknown;
}
export interface Provider {
  id: string;
  name?: string;
  providerID: string;
  vendorID?: string;
  connectionMode: string;
  api: string;
  baseURL: string;
  models: Model[];
  agentSettings?: { kernel?: Record<string, string> };
}
export interface Selection {
  providerIDs?: string[];
  disabledProviderIDs?: string[];
}
export interface Settings {
  providers: Provider[];
  agentSelections?: Record<string, Selection>;
}
export function selected(selection: Selection = {}): Set<string> {
  return new Set(
    (selection.providerIDs ?? []).filter(
      (id) => !selection.disabledProviderIDs?.includes(id),
    ),
  );
}
export function kernelProjection(
  settings: Settings,
  root: string,
  binary: string,
) {
  const enabled = selected(settings.agentSelections?.tekes);
  const rows = settings.providers.filter((p) => enabled.has(p.id));
  const provider = rows[0];
  if (
    rows.length !== 1 ||
    provider.providerID !== 'deepseek' ||
    provider.connectionMode !== 'direct' ||
    provider.api !== 'deepseek-responses'
  )
    throw new Error(
      'Expected the selected direct DeepSeek Responses connection in Tekes Settings',
    );
  const metadata = provider.agentSettings?.kernel ?? {};
  const dialect = metadata.dialect ?? 'deepseek_responses_v1';
  const models = provider.models
    .filter((m) => m.enabled !== false)
    .map((m) => ({
      id: m.id,
      enabled: true,
      profile: m.kernelProfile ?? `${dialect}:${m.id}`,
      context_window_tokens: m.contextWindow ?? 128000,
      compact_trigger_tokens:
        m.compactTriggerTokens ??
        Math.floor(((m.contextWindow ?? 128000) * 4) / 5),
    }));
  if (!models.length) throw new Error('Selected provider has no enabled model');
  return {
    provider,
    launch: {
      format: 1,
      bootstrap_version: 1,
      root,
      worker: join(binary, 'tekes-worker'),
      listen: '127.0.0.1:0',
      providers: {
        format: 1,
        revision: 1,
        providers: [
          {
            id: provider.id,
            adapter: 'responses',
            dialect,
            endpoint: provider.baseURL.replace(/\/+$/, ''),
            endpoint_owner: metadata.endpointOwner ?? 'deepseek',
            gateway_translation: metadata.gatewayTranslation ?? 'direct',
            evidence_revision: metadata.evidenceRevision ?? 'configured',
            credential_key: provider.id,
            models,
          },
        ],
      },
      credential_bindings: { [provider.id]: 'TEKES_HOST_PRIVATE_CREDENTIAL' },
    },
  };
}
export const sha256 = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
export async function verifyKernel(binary: string): Promise<void> {
  const receipt = await jsonFile<{
    kernel: typeof KERNEL_PIN;
    binaries: Record<string, { sha256: string }>;
  }>(join(binary, 'BuildProvenance.json'));
  for (const [key, value] of Object.entries(KERNEL_PIN)) {
    if (receipt.kernel[key as keyof typeof KERNEL_PIN] !== value)
      throw new Error(
        'Kernel bundle provenance differs from the published pin',
      );
  }
  for (const name of [
    'tekes-supervisor',
    'tekes-worker',
    'tekes-helper',
    'tekes-workspace-service',
  ]) {
    if (
      sha256(await readFile(join(binary, name))) !==
      receipt.binaries[name]?.sha256
    )
      throw new Error(`Kernel bundle hash mismatch: ${name}`);
  }
  const { stdout } = await exec(
    join(binary, 'tekes-supervisor'),
    ['--describe-build'],
    { env: cleanEnvironment(), timeout: 15000, maxBuffer: 65536 },
  );
  const identity = JSON.parse(stdout) as {
    version: string;
    source_revision: string;
  };
  if (
    identity.version !== KERNEL_PIN.version ||
    identity.source_revision !== KERNEL_PIN.revision
  )
    throw new Error('Kernel binary identity mismatch');
}
