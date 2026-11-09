export interface GoalReference {
  id: string;
  revision: number;
}

export interface GoalSnapshot {
  endpointId: string;
  sessionId: string;
  connectionEpoch: number;
  goal: {
    ref: GoalReference;
    objective: string;
    phase: 'active' | 'paused' | 'blocked' | 'complete';
    activation: 'active' | 'inactive' | 'armed' | 'disarmed';
    maxGoalRounds?: number | null;
    roundsStarted?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    blockedReason: { code?: string; message: string } | null;
  } | null;
  capabilities: {
    canCreate: boolean;
    canEdit: boolean;
    canPause: boolean;
    canResume: boolean;
    canClear: boolean;
    canSetCreateBudget: boolean;
    createMayRun: boolean;
    resumeMayRun: boolean;
  };
}

export interface GoalAction {
  sessionId: string;
  connectionEpoch: number;
  action: 'create' | 'edit' | 'pause' | 'resume' | 'clear';
  ref?: GoalReference;
  objective?: string;
  maxGoalRounds?: number;
}
