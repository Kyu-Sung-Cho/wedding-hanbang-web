export const AMORA_FIRST_USE_PROMOTION_PREVIEW_TIMEOUT_MS: 8000;

export interface FirstUsePromotionOperation {
  readonly sourceMessageId: string;
  readonly sessionGeneration: number;
  readonly controller: AbortController;
}

export interface FirstUsePromotionOperationGuard {
  start(sourceMessageId: unknown, sessionGeneration: unknown): FirstUsePromotionOperation | null;
  cancel(sourceMessageId: unknown): boolean;
  isCurrent(operation: FirstUsePromotionOperation | null): boolean;
  finish(operation: FirstUsePromotionOperation | null): boolean;
  current(): FirstUsePromotionOperation | null;
}

export function createFirstUsePromotionOperationGuard(): FirstUsePromotionOperationGuard;

export interface FirstUsePromotionSendRecovery {
  readonly message: string;
  readonly actionLabel: string;
  readonly recovery: "regenerate_first_use_action";
}

export function getFirstUsePromotionSendRecovery(value: {
  serverCode: unknown;
  retryPolicy: unknown;
}): Readonly<FirstUsePromotionSendRecovery> | null;

export type FirstUsePromotionBlockedStatus =
  | "source_pending"
  | "timeout"
  | "unavailable"
  | "identity_changed"
  | "stale"
  | "criterion_stale";

export type FirstUsePromotionPreview =
  | Readonly<{ status: FirstUsePromotionBlockedStatus }>
  | Readonly<{
      status: "ready";
      ownerUserId: string;
      coupleId: string;
      sourceMessageId: string;
      sourceRevision: number;
      criterionDecisionId: string | null;
      draft: Readonly<{
        action: string;
        reason: string;
        completionCriterion: string;
        sharedText: string;
      }>;
    }>
  | Readonly<{
      status: "already_shared";
      ownerUserId: string;
      coupleId: string;
      sourceMessageId: string;
      sharedMessageId: string;
    }>;

export interface FirstUseComposerBinding {
  readonly ownerUserId: string;
  readonly coupleId: string;
  readonly sourceMessageId: string;
  readonly sharedText: string;
}

export type FirstUsePromotionUiStatus =
  | "checking"
  | FirstUsePromotionBlockedStatus
  | "already_shared";

export interface FirstUsePromotionPresentation {
  readonly message: string;
  readonly actionLabel: string;
  readonly recovery: "none" | "retry" | "reload" | "correct" | "open_shared";
}

export function isPersistedFirstUseSourceMessageId(value: unknown): value is string;

export function loadAmoraFirstUsePromotionPreview(input: {
  expectedOwnerUserId: unknown;
  expectedCoupleId: unknown;
  sourceMessageId: unknown;
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: {
      method: "GET";
      headers: { Accept: "application/json" };
      signal: AbortSignal;
    },
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FirstUsePromotionPreview>;

export function createFirstUseComposerBinding(
  preview: unknown,
): Readonly<FirstUseComposerBinding> | null;

export function resolveFirstUseSourceMessageIdForSend(
  binding: unknown,
  context: {
    ownerUserId: unknown;
    coupleId: unknown;
    sharedText: unknown;
  },
): string | null;

export function reconcileFirstUseComposerBinding(
  binding: FirstUseComposerBinding | null,
  context: {
    ownerUserId: unknown;
    coupleId: unknown;
    sharedText: unknown;
  },
): FirstUseComposerBinding | null;

export function getFirstUsePromotionPresentation(
  status: FirstUsePromotionUiStatus,
): Readonly<FirstUsePromotionPresentation> | null;

export function validateFirstUsePromotionIngestReceipt(input: {
  requestedSourceMessageId: unknown;
  responseStatus: unknown;
  reused: unknown;
  reusedBy: unknown;
  messageMetadata: unknown;
}): boolean;
