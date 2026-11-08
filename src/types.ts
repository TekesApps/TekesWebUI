/** Read-only projections of the AgentKit public service contract. */
import type {
  AnnotationInputPresentation,
  ThreadPinPresentation,
  ThreadActivity,
  TranscriptLiveUsage,
  TranscriptReportedUsage,
  ThreadActionDefinition,
  QuestionCancellationOutcome,
  RunPresentation as AgentKitRunPresentation,
} from '@tekesagentkit/client-contract';
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Endpoint {
  id: string;
  kind: string;
  name: string;
  connection: 'ready' | 'connecting' | 'stopped' | { failed: string };
  canReconnect?: boolean;
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
  pin?: ThreadPinPresentation;
  activity?: ThreadActivity;
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
  responseAvailable?: boolean;
  cancelOutcome?: QuestionCancellationOutcome;
  payload: {
    title?: string;
    description?: string;
    tool?: string;
    approvalId?: string;
    questions?: Question[];
  };
}
export interface View extends Address {
  run: RunPresentation;
  transcript?: {
    turns?: {
      id: string;
      status: string;
      input: string;
      startedAt?: number;
      endedAt?: number;
      liveUsage?: TranscriptLiveUsage;
      reportedUsage?: TranscriptReportedUsage;
      footnoteActions?: ThreadActionDefinition[];
    }[];
    items: Item[];
    tools: Tool[];
    hasMoreBefore: boolean;
    isStale: boolean;
  };
}

export interface RunPresentation extends Pick<
  AgentKitRunPresentation,
  'connectionEpoch' | 'canUpdateQueue'
> {
  scope: { endpointId: string; threadId: string; sessionId: string };
  phase: string;
  canSubmit: boolean;
  canCancel: boolean;
  connection: {
    phase: string;
    canSubmit: boolean;
    historyIsStale: boolean;
    message?: string | null;
  };
  actionables: Actionable[];
  queue: {
    id?: string;
    placement?: string;
    message?: { content?: Json[] };
  }[];
  jobs: unknown[];
  error?: string | null;
}

/** AgentKit-owned family presentation returned by agent.familySnapshot. */
export interface FamilySnapshot {
  endpointId: string;
  parentSessionId: string;
  connectionEpoch: number;
  summary: {
    scope: { endpointId: string; threadId: string; sessionId: string };
    tasks: {
      id: string;
      name: string;
      status: string;
      kind: string;
      scope: { endpointId: string; threadId: string; sessionId: string };
    }[];
    subagents: {
      id: string;
      title: string;
      sessionId: string | null;
      status: string;
    }[];
    artifacts?: { id: string; source?: string | null }[];
    usage?: Json;
  };
  subagentCatalog: {
    entries: {
      kind: string;
      id: string;
      mode?: string | null;
      label?: string | null;
      reason?: string | null;
    }[];
    parentAvailable: boolean;
  } | null;
}
export interface ChildPane {
  handle: string;
  endpointId: string;
  parentSessionId: string;
  childId: string;
  connectionEpoch: number;
  layout: 'sameSession' | 'independentSessions';
  availability:
    'loading' | 'available' | 'oneShot' | 'parentUnavailable' | 'unavailable';
  mode?: string | null;
  transcript: NonNullable<View['transcript']>;
  run: RunPresentation;
}
export interface ChildViewFrame {
  handle: string;
  endpointId: string;
  parentSessionId: string;
  childId: string;
  connectionEpoch: number;
  transcript: NonNullable<View['transcript']>;
  run: RunPresentation;
}
