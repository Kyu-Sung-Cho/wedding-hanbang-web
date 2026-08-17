export type PreparationTopicCatchUpRecordErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "read_failed"
  | "stale_context"
  | "timeout"
  | "cancelled";

export declare class PreparationTopicCatchUpRecordError extends Error {
  readonly code: PreparationTopicCatchUpRecordErrorCode;
  constructor(code: PreparationTopicCatchUpRecordErrorCode);
}

export interface PreparationTopicCatchUpRecordReadContext {
  readonly ownerId: string;
  readonly coupleId: string;
  readonly signal: AbortSignal;
  readonly limit: 61;
}

export interface PreparationTopicCatchUpRecordReadResult {
  readonly catchUpDecisionReceipts: readonly unknown[];
  readonly partial: boolean;
}

export declare function loadPreparationTopicCatchUpRecords(options: {
  ownerId: string;
  coupleId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  readDecisionRows: (
    context: PreparationTopicCatchUpRecordReadContext,
  ) => Promise<unknown>;
}): Promise<PreparationTopicCatchUpRecordReadResult>;
