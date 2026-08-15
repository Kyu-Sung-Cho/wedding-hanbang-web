import type {
  TodayOneCareV2BlockerCode,
  TodayOneCareV2Outcome,
} from "./todayOneCareV2";

export const AMORA_ACTION_OUTCOME_FEEDBACK_CONTRACT_VERSION: 1;

export interface AmoraActionOutcomeFeedback {
  outcomeId: string;
  actionId: string;
  actionTitle: string;
  sourceRevision: number;
  actionRevision: number;
  actionStatus: "open" | "done";
  outcome: TodayOneCareV2Outcome;
  blockerCode?: TodayOneCareV2BlockerCode;
  recordedAt: string;
  validUntil: string;
}

export type AmoraActionOutcomeFeedbackResponse =
  | {
      version: 1;
      state: "none";
      recipientUserId: string;
      coupleId: string;
    }
  | {
      version: 1;
      state: "ready";
      recipientUserId: string;
      coupleId: string;
      feedback: AmoraActionOutcomeFeedback;
    };

export type AmoraActionOutcomeFeedbackValidation =
  | { ok: true; value: AmoraActionOutcomeFeedbackResponse }
  | {
      ok: false;
      reason:
        | "invalid"
        | "version"
        | "owner"
        | "couple"
        | "state"
        | "feedback"
        | "expired";
    };

export function validateAmoraActionOutcomeFeedbackResponse(
  value: unknown,
  expectedRecipientUserId: string,
  expectedCoupleId: string,
  nowMs?: number,
): AmoraActionOutcomeFeedbackValidation;
