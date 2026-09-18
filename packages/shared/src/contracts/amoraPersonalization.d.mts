// 값 목록은 readonly 리터럴 튜플이고 필드 타입은 리터럴 유니온이다. 넓은 string 으로 풀려도
// 웹 타입 검사는 잡지 못한다 — `prompts.ts` 의 `{ ... }[helpPreference.decisionStart]` 는 객체
// 리터럴을 바로 인덱싱해서 string 키도 받아 준다(2026-09-18 에 넓혀서 웹 tsc 를 돌려 0 오류).
// 그래서 이 모양은 `__tests__/amoraPersonalization.types.ts` 가 shared tsc 에서 직접 붙잡는다.
export declare const AMORA_DECISION_START_VALUES: readonly [
  "recommend_first",
  "compare_first",
  "ask_each_time",
];
export declare const AMORA_ANSWER_DETAIL_VALUES: readonly [
  "brief",
  "detailed",
  "adaptive",
];
export declare const AMORA_SUPPORT_ORDER_VALUES: readonly [
  "listen_first",
  "action_first",
  "ask_each_time",
];
export declare const AMORA_WORK_MODE_VALUES: readonly [
  "together",
  "owner_led",
  "hybrid",
  "ask_each_time",
];
export declare const AMORA_FAMILY_ORDER_VALUES: readonly [
  "couple_first",
  "family_input_first",
  "case_by_case",
  "ask_each_time",
];
export declare const AMORA_TONE_STYLE_VALUES: readonly [
  "adaptive",
  "warm",
  "calm_clear",
  "friendly_honest",
];

export type AmoraDecisionStart = (typeof AMORA_DECISION_START_VALUES)[number];
export type AmoraAnswerDetail = (typeof AMORA_ANSWER_DETAIL_VALUES)[number];
export type AmoraSupportOrder = (typeof AMORA_SUPPORT_ORDER_VALUES)[number];
export type AmoraWorkMode = (typeof AMORA_WORK_MODE_VALUES)[number];
export type AmoraFamilyOrder = (typeof AMORA_FAMILY_ORDER_VALUES)[number];
export type AmoraToneStyle = (typeof AMORA_TONE_STYLE_VALUES)[number];

export type AmoraPersonalizationPreferences = {
  decisionStart: AmoraDecisionStart;
  answerDetail: AmoraAnswerDetail;
  supportOrder: AmoraSupportOrder;
  workMode: AmoraWorkMode;
  familyOrder: AmoraFamilyOrder;
  toneStyle: AmoraToneStyle;
};

export type AmoraPersonalizationChanges = Partial<AmoraPersonalizationPreferences>;

export type AmoraPersonalizationProfile = {
  preferences: AmoraPersonalizationPreferences;
  revision: number;
  confirmedAt: string;
  updatedAt: string;
};

export type AmoraPersonalizationFieldName = keyof AmoraPersonalizationPreferences;

export declare const DEFAULT_AMORA_PERSONALIZATION: AmoraPersonalizationPreferences;

export declare const AMORA_PERSONALIZATION_FIELD_NAMES: readonly [
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
  "toneStyle",
];

export type AmoraPersonalizationChoice = {
  readonly value: string;
  readonly label: string;
  readonly description: string;
};

export type AmoraPersonalizationSection = {
  readonly key: AmoraPersonalizationFieldName;
  readonly title: string;
  readonly description: string;
  readonly choices: readonly AmoraPersonalizationChoice[];
};

export declare const AMORA_PERSONALIZATION_SECTIONS: readonly AmoraPersonalizationSection[];

export declare function isAmoraPersonalizationChanges(
  value: unknown,
): value is AmoraPersonalizationChanges;

export declare function mergeAmoraPersonalization(
  current: AmoraPersonalizationPreferences | null,
  changes: AmoraPersonalizationChanges,
): AmoraPersonalizationPreferences;

export declare function parseAmoraPersonalizationPreferences(
  value: unknown,
): AmoraPersonalizationPreferences | null;

export declare function parseAmoraPersonalizationProfile(
  value: unknown,
): AmoraPersonalizationProfile | null;

export declare function parseAmoraPersonalizationRow(
  value: unknown,
): AmoraPersonalizationProfile | null;
