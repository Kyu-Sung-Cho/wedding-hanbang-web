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

export interface FirstUseSharedActionDraft {
  action: string;
  reason: string;
  completionCriterion: string;
}

export interface GroundedFirstUseActionDraft extends FirstUseActionDraft {
  sourceRevision: number;
  criterionDecisionId?: string;
}

export function resolveAmoraChatEntry(
  value: string | string[] | null | undefined,
): AmoraChatEntry | null;

export function resolveAmoraFirstUseSessionResetScope(input: {
  entry: AmoraChatEntry | null;
  activeScope: AmoraEntryScope;
  consumedFirstUseEntryOwnerKey: string | null;
  currentUserId: string | null;
  currentCoupleId: string | null;
}): AmoraEntryScope;

export function extractFirstUseActionDraft(
  value: unknown,
): Readonly<FirstUseActionDraft> | null;

export function parseFirstUseSharedActionDraft(
  value: unknown,
): Readonly<FirstUseSharedActionDraft> | null;

export function isFirstUseSharedActionDraftText(value: unknown): value is string;

export function buildFirstUseSharedDraftPrivateCorrection(
  value: unknown,
): string | null;

export type FirstUseSharedDraftPrivateRecovery =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{ status: "private_occupied" }>
  | Readonly<{ status: "ready"; privateDraft: string }>;

export function planFirstUseSharedDraftPrivateRecovery(input: {
  sharedText: unknown;
  privateText: unknown;
}): FirstUseSharedDraftPrivateRecovery;

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

export interface ReviewedActionContinuationPresentation {
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  scopeCopy: string;
  promise: string;
}

export function getReviewedActionContinuationPresentation(): Readonly<ReviewedActionContinuationPresentation>;

export interface FirstUseActionContinuationPresentation extends ReviewedActionContinuationPresentation {
  stageLabel: string;
}

export function getFirstUseActionContinuationPresentation(): Readonly<FirstUseActionContinuationPresentation>;

export interface FirstUseSharedDraftPresentation {
  stageLabel: string;
  copy: string;
  accessibilityLabel: string;
  sendConfirmationCopy: string;
  composerOccupiedCopy: string;
  composerOccupiedActionLabel: string;
  draftChangedCopy: string;
  draftChangedActionLabel: string;
  privateComposerOccupiedCopy: string;
  privateComposerOccupiedActionLabel: string;
}

export function getFirstUseSharedDraftPresentation(): Readonly<FirstUseSharedDraftPresentation>;

export interface FirstUsePendingActionPresentation {
  stageLabel: string;
  prompt: string;
  applyLabel: string;
  accessibilityLabel: string;
  accessibilityHint: string;
}

export function getFirstUsePendingActionPresentation(input: {
  metadata: unknown;
  pendingAction: unknown;
}): Readonly<FirstUsePendingActionPresentation> | null;

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
