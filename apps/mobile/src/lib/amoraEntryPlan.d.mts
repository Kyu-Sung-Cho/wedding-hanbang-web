export type AmoraEntryScope = "private" | "shared";

export interface AmoraEntryStarter {
  id: "review_current_state" | "plan_this_week" | "prepare_conversation";
  label: string;
  prompt: string;
  recommended: boolean;
}

export interface AmoraEntryPlan {
  title: string;
  description: string;
  starters: readonly AmoraEntryStarter[];
}

export type AmoraChatEntry = "first_use";

export interface FirstUseActionDraft {
  action: string;
  reason: string;
  completionCriterion: string;
  assumptions: readonly string[];
  unknowns: readonly string[];
}

export interface GroundedFirstUseActionDraft extends FirstUseActionDraft {
  sourceRevision: number;
  criterionDecisionId?: string;
}

export function resolveAmoraChatEntry(
  value: string | string[] | null | undefined,
): AmoraChatEntry | null;

export function extractFirstUseActionDraft(
  value: unknown,
): Readonly<FirstUseActionDraft> | null;

export function extractFirstUseActionNarrative(
  value: unknown,
): string | null;

export function resolveFirstUseActionBubbleContent(input: {
  content: unknown;
  groundedDraft: unknown;
}): string | null;

export function selectPrivateActionDraftForBridge(input: {
  activeScope: AmoraEntryScope;
  senderType: string;
  isLatestPrivateAiMessage: boolean;
  isAlreadyPromoted: boolean;
  content: unknown;
  sourceRevision: unknown;
  grounding?: unknown;
  criterionDecisionId?: unknown;
}): Readonly<GroundedFirstUseActionDraft> | null;

export type FirstUseActionPromotionVerification =
  | "ready"
  | "stale"
  | "criterion_stale"
  | "identity_changed"
  | "unavailable";

export function verifyFirstUseActionPromotion(input: {
  expectedOwnerUserId: unknown;
  expectedCoupleId: unknown;
  sourceRevision: unknown;
  expectedCriterionDecisionId: unknown;
  readCurrentIdentity: () => Promise<{
    ownerUserId: unknown;
    coupleId: unknown;
  } | null>;
  readCurrentJourneyRevision: (coupleId: string) => Promise<unknown>;
  readCurrentCriterionDecisionId: (
    ownerUserId: string,
    coupleId: string,
  ) => Promise<{ loaded: boolean; decisionId: unknown }>;
}): Promise<FirstUseActionPromotionVerification>;

export function buildFirstUseCorrectionDraft(): string;

export function buildFirstUseCriterionCorrectionDraft(): string;

export interface FirstUseActionContinuationPresentation {
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  scopeCopy: string;
  promise: string;
}

export function getReviewedActionContinuationPresentation(): Readonly<FirstUseActionContinuationPresentation>;

export function buildFirstUseSharedActionDraft(
  value: FirstUseActionDraft | null | undefined,
): string | null;

export function buildAmoraEntryPlan(input: {
  activeScope: AmoraEntryScope;
  hasLinkedPartner: boolean;
}): AmoraEntryPlan | null;

export function buildAmoraHomeDraft(input: {
  intent: "focus" | "intake";
  priorityTitle: string;
  whyNow: string;
  evidenceLabel: string;
  coreCriterion?: string | null;
  useCoupleCriterion?: boolean;
}): string | null;
