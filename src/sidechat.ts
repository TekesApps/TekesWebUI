/** Ephemeral pointer authority from AgentKit's shared SideChat controller. */
export interface SideChatScope {
  endpointId: string;
  threadId: string;
  sessionId: string;
}
export interface SideChat {
  handle: string;
  parent: SideChatScope;
  scope: SideChatScope;
  connectionEpoch: number;
  title: string;
  phase: 'ready' | 'closing' | 'unknown';
  error: string | null;
}
export interface SideChatState {
  endpointId: string;
  parentSessionId: string;
  connectionEpoch: number;
  supported: boolean;
  creating: boolean;
  unknownCreation: string | null;
  chats: SideChat[];
  /** Only confirmed discard/absence allows clearing that pointer's draft. */
  removedHandles?: string[];
}
export interface SideChatOperations {
  load: () => Promise<SideChatState>;
  create: (connectionEpoch: number, rpcId: string) => Promise<SideChatState>;
  close: (chat: SideChat, rpcId: string) => Promise<SideChatState>;
  reconcile: (connectionEpoch: number) => Promise<SideChatState>;
}
