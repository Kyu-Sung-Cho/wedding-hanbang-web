export const AMORA_FIRST_USE_PROMOTION_CONTRACT_VERSION: 1;

export interface AmoraFirstUseCanonicalDraft {
  action: string;
  reason: string;
  completionCriterion: string;
  sharedText: string;
}

export type AmoraFirstUsePromotionPreviewResponse =
  | {
      version: 1;
      state: "ready";
      ownerUserId: string;
      coupleId: string;
      sourceMessageId: string;
      sourceRevision: number;
      criterionDecisionId: string | null;
      canonicalDraft: AmoraFirstUseCanonicalDraft;
    }
  | {
      version: 1;
      state: "already_shared";
      ownerUserId: string;
      coupleId: string;
      sourceMessageId: string;
      sharedMessageId: string;
    };

export type AmoraFirstUsePromotionPreviewValidation =
  | { ok: true; value: AmoraFirstUsePromotionPreviewResponse }
  | {
      ok: false;
      reason: "invalid" | "version" | "owner" | "couple" | "source" | "state";
    };

export function buildAmoraFirstUseSharedDraft(input: {
  action: string;
  reason: string;
  completionCriterion: string;
}): string | null;

export function extractAmoraFirstUseActionDraft(
  value: unknown,
): Readonly<Pick<
  AmoraFirstUseCanonicalDraft,
  "action" | "reason" | "completionCriterion"
>> | null;

export function validateAmoraFirstUsePromotionPreviewResponse(
  value: unknown,
  expectedOwnerUserId: string,
  expectedCoupleId: string,
  expectedSourceMessageId: string,
): AmoraFirstUsePromotionPreviewValidation;
