import type { Wire } from './bridge.js';
import type { DirectoryAuthority } from './directory.js';

/** Use the existing host grant and execution template for both dry-run and creation. */
export async function prepareNativePresetExecution(
  request: Wire,
  workspace: string,
  directories: DirectoryAuthority,
): Promise<Wire> {
  const source = request.payload ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Invalid session payload');
  const payload = source as Wire;
  const hasPreset = Object.hasOwn(payload, 'preset');
  if (
    hasPreset &&
    (Object.hasOwn(payload, 'identityProfile') ||
      Object.hasOwn(payload, 'agentPreset'))
  )
    throw new Error('Structured preset and identity profile are exclusive');
  const execution = await directories.execution(
    request.endpoint,
    payload.cwd ?? workspace,
    {
      cwd: workspace,
      read_roots: [workspace],
      writable_roots: [workspace],
      toolchain_roots: ['/bin', '/usr/bin'],
      network: false,
      allowed_tools: [
        'read',
        'write',
        'edit',
        'shell',
        'ask_user_questions',
        'context',
        'task',
      ],
    },
  );
  if (request.method === 'agent.preset.preview')
    return {
      connectionEpoch: payload.connectionEpoch,
      execution,
      preset: payload.preset,
    };
  if (request.method === 'session.presets.resolve')
    return { execution, preset: payload.preset };
  const result: Wire = { ...payload, execution };
  delete result.cwd;
  if (!hasPreset) result.identityProfile ??= 'general';
  return result;
}
