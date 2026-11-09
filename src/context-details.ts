export interface ContextUsage {
  usedTokens: number | null;
  contextWindow: number | null;
  basis: 'reported' | 'estimated' | 'upperBound' | 'unknown';
  provider?: string | null;
  model?: string | null;
}
export interface ContextRow {
  id: string;
  category: string;
  title: string;
  role: 'occupied' | 'reserved' | 'available' | 'deferred' | 'inventory';
  tokens?: {
    value: number;
    basis: string;
    accountingID?: string | null;
  } | null;
  itemCount?: { value: number; coverage: string } | null;
  children?: ContextRow[];
}
export interface ContextSnapshot {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
  usage: ContextUsage | null;
  details: {
    revision: string;
    coverage: string;
    relation: 'reconciled' | 'independentEstimate' | 'unknown';
    evidence: {
      scope: string;
      sourceKey: string;
      requestID?: string | null;
      observedAt?: string | null;
    };
    usage?: ContextUsage | null;
    rows: ContextRow[];
    unavailableReason?: string | null;
  } | null;
  usageSequence: number | null;
  detailsSequence: number | null;
  notices: string[];
  billing: {
    supported: boolean;
    summary: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    } | null;
    cacheAttribution:
      | {
          dialectId: string;
          modelProfileId: string;
          exactSku: string;
          attempts: number;
          inputTokens: string;
          outputTokens: string;
          cacheReadTokens: string;
        }[]
      | null;
  };
}
