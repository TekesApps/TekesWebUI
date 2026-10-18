/** Read-only projections of the AgentKit public service contract. */
import type { AnnotationInputPresentation } from '@tekesagentkit/annotations';
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Endpoint {
  id: string;
  kind: string;
  name: string;
  connection: 'ready' | 'connecting' | 'stopped' | { failed: string };
  host?: { product: { version: string } };
  capabilities?: { methods?: string[]; supportsArchiveSession?: boolean };
}
export interface Summary {
  title?: string;
  name?: string;
  cwd?: string;
  running?: boolean;
  ephemeral?: boolean;
  status?: string;
  agentPreset?: string;
  initialPresetID?: string;
  identityProfile?: string;
  preset?: { base?: string; layers?: { id: string }[] };
  createdAt?: string | number;
  updatedAt?: string | number;
  projections?: {
    asOfSeq?: number;
    values?: { title?: string | { title: string } };
  };
}
export interface Session {
  sessionId: string;
  summary?: Summary;
}
export interface Address {
  endpoint: string;
  sessionId: string;
}
export interface Inventory {
  description: Endpoint;
  sessions: Session[];
}
export interface ModelChoice {
  provider: string;
  model: string;
  reasoningEffort?: string;
}
export interface Model {
  id: string;
  name?: string;
  provider: string;
  contextWindow?: number;
  reasoning?: {
    defaultEffort?: string;
    efforts: { id: string; name?: string }[];
  };
}
export interface Preset {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  configurationText?: string | null;
  isDefault?: boolean;
  broken?: string | null;
  unavailableReason?: string | null;
}
export interface PresetCatalog {
  presets: Preset[];
  defaultID?: string | null;
}
export interface AttachmentPolicy {
  inlineMediaTypes: string[];
  maxAttachmentBytes?: number;
  maxAttachmentsPerMessage?: number;
  maxMessageAttachmentBytes?: number;
  maxImagePixels?: number;
  maxImageDimension?: number;
}
export interface PendingAttachment {
  id: string;
  file: File;
}
export interface UploadReceipt {
  receiptId: string;
  file: { attachmentId: string; name: string; bytes: number };
}
export interface Catalog {
  groups?: { id: string; models?: Omit<Model, 'provider'>[] }[];
  providers?: { id: string; models?: Omit<Model, 'provider'>[] }[];
  current?: ModelChoice;
  selected?: ModelChoice;
}
export interface Item {
  id: string;
  turnId: string;
  kind:
    | 'user'
    | 'assistant'
    | 'system'
    | 'error'
    | 'notice'
    | 'narration'
    | 'reasoning'
    | 'artifact'
    | 'usage'
    | 'unknown'
    | (string & {});
  text: string;
  inputPresentation?: AnnotationInputPresentation;
  reasoning?: string;
  reasoningEnded?: boolean;
  sourceSequence?: number;
  metadata?: Json;
  isVisible: boolean;
  isFinal: boolean;
  isProvisional: boolean;
  attachments?: Json[];
  time?: number;
}
export interface Tool {
  id: string;
  turnId: string;
  name: string;
  phase: string;
  arguments: Json;
  result?: Json;
  callView?: Json;
  resultView?: Json;
}
export interface Question {
  id: string;
  question: string;
  detail?: string;
  multiSelect?: boolean;
  allowCustom?: boolean;
  isSecret?: boolean;
  options?: { label: string }[];
}
export interface Actionable {
  id: string;
  revision: number;
  sessionId: string;
  kind: string;
  payload: {
    title?: string;
    description?: string;
    tool?: string;
    approvalId?: string;
    questions?: Question[];
  };
}
export interface View extends Address {
  run: {
    phase: string;
    canSubmit: boolean;
    canCancel: boolean;
    connection: { phase: string; message?: string; historyIsStale?: boolean };
    actionables: Actionable[];
    queue: { content?: { type: string; text?: string }[] }[];
    error?: string;
  };
  transcript?: {
    turns?: {
      id: string;
      status: string;
      input: string;
      startedAt?: number;
      endedAt?: number;
    }[];
    items: Item[];
    tools: Tool[];
    hasMoreBefore: boolean;
    isStale: boolean;
  };
}
