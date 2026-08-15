export declare const AMORA_SCHEDULE_CARE_FOLLOW_UP_CONTRACT_VERSION: 1;
export declare const AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY:
  "amora_schedule_care_follow_up_v1";
export declare const AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY:
  "amora_schedule_care_action_draft_v1";
export declare const AMORA_SCHEDULE_CARE_FOLLOW_UP_ANSWER_PREFIX: " ";

export interface AmoraScheduleCareFollowUpBinding {
  cardId: string;
  cardRevision: number;
  sourceRevision: number;
}

export interface AmoraScheduleCareFollowUpPreview {
  version: 1;
  state: "ready";
  recipientUserId: string;
  coupleId: string;
  binding: AmoraScheduleCareFollowUpBinding;
  expiresAt: string;
  prompt: string;
}

export interface AmoraScheduleCareActionDraft {
  version: 1;
  title: string;
  reason: string;
  completionCriterion: string;
}

export interface AmoraScheduleCareFollowUpPrivateMetadata {
  version: 1;
  card_id: string;
  card_revision: number;
  source_revision: number;
}

export type AmoraScheduleCareFollowUpValidationReason =
  | "invalid"
  | "version"
  | "owner"
  | "couple"
  | "state"
  | "binding"
  | "expired"
  | "prompt"
  | "draft";

export type AmoraScheduleCareFollowUpValidation<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: AmoraScheduleCareFollowUpValidationReason;
    };

export declare function validateAmoraScheduleCareFollowUpBinding(
  value: unknown,
): AmoraScheduleCareFollowUpValidation<AmoraScheduleCareFollowUpBinding>;

export declare function validateAmoraScheduleCareFollowUpPreview(
  value: unknown,
  expected: {
    recipientUserId: string;
    coupleId: string;
    nowMs: number;
  },
): AmoraScheduleCareFollowUpValidation<AmoraScheduleCareFollowUpPreview>;

export declare function validateAmoraScheduleCareActionDraft(
  value: unknown,
): AmoraScheduleCareFollowUpValidation<AmoraScheduleCareActionDraft>;

export declare function extractAmoraScheduleCareFollowUpAnswer(
  content: unknown,
  prompt: unknown,
): string | null;

export declare const splitAmoraScheduleCareFollowUpAnswer:
  typeof extractAmoraScheduleCareFollowUpAnswer;

export declare function buildAmoraScheduleCareFollowUpPrivateMetadata(
  binding: unknown,
): AmoraScheduleCareFollowUpPrivateMetadata | null;

export declare function parseAmoraScheduleCareFollowUpPrivateMetadata(
  value: unknown,
): AmoraScheduleCareFollowUpPrivateMetadata | null;
