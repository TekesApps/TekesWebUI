export type FeedbackRating = 'positive' | 'negative';
export interface FeedbackRecord {
  messageId: string;
  rating: FeedbackRating;
  version: string;
  note?: string | null;
  updatedAtMilliseconds?: number | null;
}
export interface FeedbackTarget {
  itemId: string;
  turnId: string;
  messageId: string;
  /** Displayed-response consistency witness; not a feedback CAS version. */
  responseRevision: string;
}
export interface FeedbackSnapshot {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
  target: FeedbackTarget | null;
  feedback: FeedbackRecord | null;
  canPut: boolean;
  canDelete: boolean;
}
export interface FeedbackAction {
  sessionId: string;
  connectionEpoch: number;
  itemId: string;
  messageId: string;
  responseRevision: string;
  ifVersion: string | null;
  change:
    | { kind: 'toggleRating'; rating: FeedbackRating }
    | { kind: 'setRating'; rating: FeedbackRating | null }
    | { kind: 'setNote'; note: string | null };
}
