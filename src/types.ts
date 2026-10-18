/** Read-only projections of the AgentKit public service contract. */
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
}
export interface Model {
  id: string;
  name?: string;
  provider: string;
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
  kind: 'user' | 'assistant' | 'system' | 'error' | 'notice';
  text: string;
  reasoning?: string;
  isVisible: boolean;
  isFinal: boolean;
  isProvisional: boolean;
  attachments?: Json[];
}
export interface Tool {
  id: string;
  turnId: string;
  name: string;
  phase: string;
  arguments: Json;
  result?: Json;
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
    items: Item[];
    tools: Tool[];
    hasMoreBefore: boolean;
    isStale: boolean;
  };
}
