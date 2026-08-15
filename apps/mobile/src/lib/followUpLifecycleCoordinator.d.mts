export type FollowUpLifecycleContext = {
  ownerUserId: string;
  coupleId: string;
  sessionGeneration: number;
};

export type FollowUpLifecycleOperation = {
  kind: "load" | "outcome";
  context: FollowUpLifecycleContext;
  id: number;
  signal: AbortSignal;
};

export type FollowUpLifecycleStageResult<T> =
  | { status: "current"; value: T }
  | { status: "stale" };

export type FollowUpLifecycleCoordinator = {
  updateExpected: (ownerUserId: string | null, coupleId: string | null) => boolean;
  updateAuthenticatedUser: (userId: string | null) => boolean;
  adoptAuthenticatedUser: (userId: string | null) => boolean;
  capture: () => FollowUpLifecycleContext | null;
  beginLoad: () => FollowUpLifecycleOperation | null;
  beginOutcome: (
    expectedContext: FollowUpLifecycleContext | null,
  ) => FollowUpLifecycleOperation | null;
  isCurrent: (operation: FollowUpLifecycleOperation | null) => boolean;
  runStage: <T>(
    operation: FollowUpLifecycleOperation,
    stage: (signal: AbortSignal) => Promise<T>,
  ) => Promise<FollowUpLifecycleStageResult<T>>;
  finish: (operation: FollowUpLifecycleOperation | null) => void;
  cancelAll: () => void;
  hasOutcomeInFlight: () => boolean;
};

export function createFollowUpLifecycleCoordinator(): FollowUpLifecycleCoordinator;
