export type AmoraActionFollowUpOutcome =
  | "completed"
  | "blocked"
  | "changed"
  | "not_sure";

export type AmoraActionFollowUpBlockerCode =
  | "time"
  | "partner_check"
  | "missing_info"
  | "other";

export type AmoraActionFollowUpRequestPaths = {
  mode: "scheduled_follow_up" | "explicit_action";
  cardPath: string;
  outcomePath: string;
};

export declare function buildActionFollowUpRequestPaths(
  preferredActionId: string | null | undefined,
): AmoraActionFollowUpRequestPaths | null;

export interface PreferredHomeActionPresentation {
  id: string;
  title: string;
  sourceRevision: number;
  selectionReason: string;
}

export declare function resolveActionFollowUpWhyNow(
  card: { title: string; sourceRevision: number; whyNow: string },
  requestedActionId: string | null,
  expectedAction: PreferredHomeActionPresentation | null | undefined,
): string;

export type AmoraActionFollowUpOutcomePresentation = {
  readonly label:
    | "끝냈어요"
    | "막혔어요"
    | "내용이 바뀌었어요"
    | "아직 모르겠어요";
  readonly requiresConfirmation: boolean;
};

export declare function getActionFollowUpOutcomePresentation(
  outcome: AmoraActionFollowUpOutcome,
): AmoraActionFollowUpOutcomePresentation;
export declare function getActionFollowUpOutcomePresentation(
  outcome: unknown,
): AmoraActionFollowUpOutcomePresentation | null;

export declare function getActionFollowUpBlockerPresentation(
  blockerCode: AmoraActionFollowUpBlockerCode,
): { readonly label: string };
export declare function getActionFollowUpBlockerPresentation(
  blockerCode: unknown,
): { readonly label: string } | null;

export declare function buildActionFollowUpPrivateRescueDraft(input: {
  actionTitle: unknown;
  outcome: unknown;
  blockerCode: unknown;
}): string | null;

export interface AmoraActionFollowUpCardIdentity {
  id: string;
  revision: number;
  sourceRevision: number;
  outcomeIdempotencyKey: string;
}

export interface AmoraActionFollowUpOutcomeBody {
  cardId: string;
  cardRevision: number;
  sourceRevision: number;
  outcome: AmoraActionFollowUpOutcome;
  blockerCode?: AmoraActionFollowUpBlockerCode;
  confirmed?: true;
  idempotencyKey: string;
}

export declare function buildActionFollowUpOutcomeBody(
  card: AmoraActionFollowUpCardIdentity,
  outcome: AmoraActionFollowUpOutcome,
  blockerCode: AmoraActionFollowUpBlockerCode | null | undefined,
  confirmed: boolean | null | undefined,
): AmoraActionFollowUpOutcomeBody | null;

export declare function matchCanonicalActionFollowUpReceipt<T>(
  posted: unknown,
  reread: T,
): T | null;

export declare function isReceiptForActionFollowUpRequest(
  receipt: unknown,
  request: AmoraActionFollowUpOutcomeBody,
): boolean;

export declare function isActionFollowUpCardAdvanced(
  previousCard: { id: string; sourceDigest: string },
  refreshed: {
    state: "ready" | "none" | "disabled" | "paused" | "daily_limit";
    card?: { id: string; sourceDigest: string };
  },
): boolean;

export declare function resolveActionFollowUpV2Surface(
  status: number,
  validatedState:
    | "ready"
    | "none"
    | "disabled"
    | "paused"
    | "daily_limit"
    | null,
): "ready" | "fallback" | "error";

export interface AmoraActionFollowUpContext {
  ownerUserId: string;
  coupleId: string;
  sessionGeneration: number;
}

export declare function isCurrentActionFollowUpContext(
  captured: unknown,
  current: unknown,
): boolean;

export declare function shouldRetainActionFollowUpReceipt(
  pinnedContext: unknown,
  currentContext: unknown,
  pinnedReleaseVersion: unknown,
  currentReleaseVersion: unknown,
): boolean;
