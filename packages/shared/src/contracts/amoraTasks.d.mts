export type AmoraTaskKind =
  | 'hall_candidates'
  | 'sdm_candidates'
  | 'quote_compare'
  | 'todo_deadlines'
  | 'inquiry_letters'
  | 'reply_digest'
  | 'date_candidates';

export type AmoraTaskStatus =
  | 'offered'
  | 'queued'
  | 'searching'
  | 'organizing'
  | 'needs_review'
  | 'done'
  | 'cancelled'
  | 'expired';

export type AmoraTaskStage = 'searching' | 'organizing' | 'needs_review' | 'done';

export type AmoraTaskReviewReason =
  | 'daily_step_limit'
  | 'daily_search_limit'
  | 'background_budget'
  | 'task_step_limit'
  | 'gate_blocked'
  | 'needs_input'
  | 'source_unavailable'
  | 'failed'
  | 'stale';

export declare const AMORA_TASK_ID_PATTERN: RegExp;
export declare const AMORA_TASK_KINDS: readonly AmoraTaskKind[];
export declare const AMORA_TASK_KIND_LABELS: Readonly<Record<AmoraTaskKind, string>>;
export declare const AMORA_TASK_STATUSES: readonly AmoraTaskStatus[];
export declare const AMORA_TASK_STAGES: readonly AmoraTaskStage[];
export declare const AMORA_TASK_STAGE_LABELS: Readonly<Record<AmoraTaskStage, string>>;
export declare const AMORA_TASK_REVIEW_REASONS: readonly AmoraTaskReviewReason[];
export declare const AMORA_TASK_RESUMABLE_REASONS: readonly AmoraTaskReviewReason[];

export declare const AMORA_TASK_COPY: Readonly<{
  homeTitle: string;
  homeMore: string;
  offerTitle: string;
  offerBody: string;
  offerStart: string;
  offerStarting: string;
  offerStarted: string;
  offerOpen: string;
  offerExpired: string;
  offerUnavailable: string;
  startFailed: string;
  dailyTaskLimit: string;
  resultTableTitle: string;
  resultTableNote: string;
  resultSourcesTitle: string;
  resultCheckedOn: (ymd: string) => string;
  resultNextTitle: string;
  resultNextNote: string;
  resultNextButton: string;
  priceUnknown: string;
  cancel: string;
  cancelled: string;
  resume: string;
  back: string;
  empty: string;
  loadFailed: string;
  retry: string;
  actionFailed: string;
  stepsTitle: string;
  reviewReasons: Readonly<Record<AmoraTaskReviewReason, string>>;
}>;

export declare function amoraTaskStage(status: unknown): AmoraTaskStage | null;
export declare function formatKoreanYmd(ymd: unknown): string;
export declare function amoraTaskAppPath(taskId: unknown): string | null;
export declare function amoraTaskWebPath(taskId: unknown): string | null;
export declare function safeAmoraTaskSourceUrl(value: unknown): string | null;

export interface AmoraTaskSummary {
  id: string;
  kind: AmoraTaskKind;
  title: string;
  status: AmoraTaskStatus;
  stage: AmoraTaskStage | null;
  reviewReason: AmoraTaskReviewReason | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

export interface AmoraTaskResultSource {
  id: string;
  title: string;
  url: string | null;
  checkedOn: string | null;
}

export interface AmoraTaskResult {
  summary: string | null;
  columns: string[];
  rows: { cells: string[]; sourceIds: string[] }[];
  sources: AmoraTaskResultSource[];
  nextActions: { label: string; prompt: string }[];
}

export interface AmoraTaskDetail extends AmoraTaskSummary {
  steps: { label: string; at: string }[];
  result: AmoraTaskResult | null;
  resumable: boolean;
  cancellable: boolean;
}

export interface AmoraTaskOffer {
  taskId: string;
  kind: AmoraTaskKind;
  title: string;
  plan: string[];
  offerExpiresAt: string | null;
}

export declare function parseAmoraTaskList(payload: unknown): { visible: boolean; tasks: AmoraTaskSummary[] };
export declare function parseAmoraTaskDetail(payload: unknown): AmoraTaskDetail | null;
export declare function parseAmoraTaskOffer(toolOutput: unknown): AmoraTaskOffer | null;
