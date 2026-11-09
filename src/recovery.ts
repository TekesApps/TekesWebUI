export interface RecoveryOutcome {
  connectionEpoch: number;
  requestedSessionIds: string[];
  recoveredSessionIds: string[];
  unresolvedSessionIds: string[];
  notRetriedSessionIds: string[];
  error: string | null;
}
export interface RecoverySnapshot {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
  canRecover: boolean;
  outcome: RecoveryOutcome | null;
}
export interface RecoveryRequest {
  sessionId: string;
  connectionEpoch: number;
}
