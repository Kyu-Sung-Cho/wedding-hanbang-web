export type AmoraDecisionStart =
  | "recommend_first"
  | "compare_first"
  | "ask_each_time";
export type AmoraAnswerDetail = "brief" | "detailed" | "adaptive";
export type AmoraSupportOrder =
  | "listen_first"
  | "action_first"
  | "ask_each_time";
export type AmoraWorkMode =
  | "together"
  | "owner_led"
  | "hybrid"
  | "ask_each_time";
export type AmoraFamilyOrder =
  | "couple_first"
  | "family_input_first"
  | "case_by_case"
  | "ask_each_time";
export type AmoraToneStyle =
  | "adaptive"
  | "warm"
  | "calm_clear"
  | "friendly_honest";

export interface AmoraPersonalizationPreferences {
  decisionStart: AmoraDecisionStart;
  answerDetail: AmoraAnswerDetail;
  supportOrder: AmoraSupportOrder;
  workMode: AmoraWorkMode;
  familyOrder: AmoraFamilyOrder;
  toneStyle: AmoraToneStyle;
}

export interface AmoraPersonalizationProfile {
  preferences: AmoraPersonalizationPreferences;
  revision: number;
  confirmedAt: string;
  updatedAt: string;
}

export const DEFAULT_AMORA_PERSONALIZATION_PREFERENCES:
  Readonly<AmoraPersonalizationPreferences>;

export type AmoraPersonalizationPreferenceField =
  | "decisionStart"
  | "answerDetail"
  | "supportOrder"
  | "workMode"
  | "familyOrder"
  | "toneStyle";

export type AmoraPersonalizationPreferenceValue =
  | AmoraDecisionStart
  | AmoraAnswerDetail
  | AmoraSupportOrder
  | AmoraWorkMode
  | AmoraFamilyOrder
  | AmoraToneStyle;

export function parseAmoraPersonalizationEnvelope(value: unknown): Readonly<{
  profile: Readonly<AmoraPersonalizationProfile> | null;
}> | null;

export function parseAmoraPersonalizationResetEnvelope(value: unknown): Readonly<{
  deleted: true;
  profile: null;
}> | null;

export function parseAmoraPersonalizationConflict(value: unknown): Readonly<{
  current: Readonly<AmoraPersonalizationProfile> | null;
}> | null;

export function loadOwnerAmoraPersonalization(
  ownerUserId: string,
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: {
      method: "GET";
      headers: { Accept: "application/json" };
    },
  ) => Promise<{
    ok: boolean;
    json(): Promise<unknown>;
  }>,
): Promise<Readonly<AmoraPersonalizationPreferences> | null>;

export function buildAmoraPersonalizationResetBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
): Readonly<{
  expectedRevision: number;
}> | null;

export function buildSinglePersonalizationPreferenceSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    field: AmoraPersonalizationPreferenceField;
    value: AmoraPersonalizationPreferenceValue;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildProgressivePersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    supportOrder: AmoraSupportOrder;
    answerDetail: AmoraAnswerDetail;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildBlockedOutcomePersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    outcome: "blocked";
    supportOrder: AmoraSupportOrder;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildUncertainOutcomePersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    outcome: "not_sure";
    decisionStart: AmoraDecisionStart;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildChangedOutcomePersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    outcome: "changed";
    answerDetail: AmoraAnswerDetail;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildCompletedOutcomePersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    outcome: "completed";
    workMode: AmoraWorkMode;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function buildFamilyMomentPersonalizationSaveBody(
  current: Readonly<AmoraPersonalizationProfile> | null | undefined,
  selection: Readonly<{
    momentType: "sanggyeonrye" | "family_greeting";
    attentionWindow: "d3" | "d1";
    familyOrder: AmoraFamilyOrder;
  }>,
): Readonly<{
  expectedRevision: number | null;
  preferences: Readonly<AmoraPersonalizationPreferences>;
}> | null;

export function canOfferFamilyMomentPersonalization(
  momentType: unknown,
  attentionWindow: unknown,
): boolean;
