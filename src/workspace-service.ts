/** Public Workspace Service facts are shared with other AgentKit hosts. */
import type { WorkspaceFile } from '@tekesagentkit/client-contract/workspace';
export type {
  WorkspaceMethod,
  WorkspaceCapabilities,
  WorkspaceFileEntry,
  WorkspaceListing,
  WorkspaceFile,
  WorkspaceGitChange,
  WorkspaceGitStatus,
  WorkspaceGitBranch,
  WorkspaceGitBranches,
  WorkspaceGitDiff,
  WorkspaceGitLog,
  WorkspaceGitNavigator,
  WorkspaceCall,
  WorkspaceDescriptor,
  WorkspaceInventory,
  WorkspaceCallRequest,
  WorkspaceResult as WorkspaceCallResponse,
} from '@tekesagentkit/client-contract/workspace';

/** A complete UTF-8 snapshot is required before the browser can replace a file. */
export function workspaceFileText(file: WorkspaceFile): string | null {
  if (
    file.encoding !== 'base64' ||
    file.truncated ||
    file.size > 4 * 1024 * 1024
  )
    return null;
  try {
    const raw = atob(file.content);
    if (btoa(raw) !== file.content || raw.length !== file.size) return null;
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}
export function workspaceTextBase64(text: string): string {
  let raw = '';
  for (const byte of new TextEncoder().encode(text))
    raw += String.fromCharCode(byte);
  return btoa(raw);
}

export class WorkspaceServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WorkspaceServiceError';
  }
}
