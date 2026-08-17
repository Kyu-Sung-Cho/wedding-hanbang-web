export type PreparationTopicBudgetDecisionErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "read_failed"
  | "stale_context"
  | "timeout"
  | "cancelled";

export declare class PreparationTopicBudgetDecisionError extends Error {
  readonly code: PreparationTopicBudgetDecisionErrorCode;
  constructor(code: PreparationTopicBudgetDecisionErrorCode);
}

export interface PreparationTopicBudgetDecisionReadContext {
  readonly ownerId: string;
  readonly coupleId: string;
  readonly currentJourneyRevision: number;
  readonly signal: AbortSignal;
  readonly limit: 81;
}

export type PreparationTopicBudgetDecisionRowReader = (
  context: PreparationTopicBudgetDecisionReadContext,
) => Promise<unknown>;

export type PreparationTopicBudgetDecisionApiFetch = (
  path: string,
  init: Readonly<{
    method: "GET";
    signal: AbortSignal;
  }>,
) => Promise<unknown>;

export interface PreparationTopicBudgetDecisionVerification {
  readonly requestId: string;
  readonly status: "applied";
  readonly requiredCount: 1 | 2;
  readonly acceptedCount: 1 | 2;
  readonly summary: string;
  readonly surface: "/budget";
  readonly journey: Readonly<{
    coupleId: string;
    stateRevision: number;
    topicKey: string;
    topicSnapshot: unknown;
  }>;
}

export interface PreparationTopicBudgetDecisionReadResult {
  readonly budgetDecisionReceipts: readonly unknown[];
  readonly budgetDecisionVerifications: readonly PreparationTopicBudgetDecisionVerification[];
  readonly partial: boolean;
}

export declare function loadPreparationTopicBudgetDecisions(options: {
  ownerId: string;
  coupleId: string;
  currentJourneyRevision: number;
  progress: Readonly<Record<string, unknown>>;
  isCurrent: () => boolean;
  apiFetch: PreparationTopicBudgetDecisionApiFetch;
  readDecisionRows: PreparationTopicBudgetDecisionRowReader;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PreparationTopicBudgetDecisionReadResult>;
