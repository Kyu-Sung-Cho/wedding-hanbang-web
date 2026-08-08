export const AMORA_DECISION_START_VALUES = [
  "recommend_first",
  "compare_first",
  "ask_each_time",
] as const;
export const AMORA_ANSWER_DETAIL_VALUES = [
  "brief",
  "detailed",
  "adaptive",
] as const;
export const AMORA_SUPPORT_ORDER_VALUES = [
  "listen_first",
  "action_first",
  "ask_each_time",
] as const;
export const AMORA_WORK_MODE_VALUES = [
  "together",
  "owner_led",
  "hybrid",
  "ask_each_time",
] as const;
export const AMORA_FAMILY_ORDER_VALUES = [
  "couple_first",
  "family_input_first",
  "case_by_case",
  "ask_each_time",
] as const;
export const AMORA_TONE_STYLE_VALUES = [
  "adaptive",
  "warm",
  "calm_clear",
  "friendly_honest",
] as const;
export type AmoraDecisionStart =
  (typeof AMORA_DECISION_START_VALUES)[number];
export type AmoraAnswerDetail =
  (typeof AMORA_ANSWER_DETAIL_VALUES)[number];
export type AmoraSupportOrder =
  (typeof AMORA_SUPPORT_ORDER_VALUES)[number];
export type AmoraWorkMode =
  (typeof AMORA_WORK_MODE_VALUES)[number];
export type AmoraFamilyOrder =
  (typeof AMORA_FAMILY_ORDER_VALUES)[number];
export type AmoraToneStyle = (typeof AMORA_TONE_STYLE_VALUES)[number];
export type AmoraPersonalizationPreferences = {
  decisionStart: AmoraDecisionStart;
  answerDetail: AmoraAnswerDetail;
  supportOrder: AmoraSupportOrder;
  workMode: AmoraWorkMode;
  familyOrder: AmoraFamilyOrder;
  toneStyle: AmoraToneStyle;
};

export type AmoraPersonalizationChanges =
  Partial<AmoraPersonalizationPreferences>;

export type AmoraPersonalizationProfile = {
  preferences: AmoraPersonalizationPreferences;
  revision: number;
  confirmedAt: string;
  updatedAt: string;
};

export const DEFAULT_AMORA_PERSONALIZATION: AmoraPersonalizationPreferences = {
  decisionStart: "ask_each_time",
  answerDetail: "adaptive",
  supportOrder: "ask_each_time",
  workMode: "ask_each_time",
  familyOrder: "ask_each_time",
  toneStyle: "adaptive",
};

export const AMORA_PERSONALIZATION_FIELD_NAMES = [
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
  "toneStyle",
] as const satisfies readonly (keyof AmoraPersonalizationPreferences)[];

export type AmoraQuickStartMode =
  | "recommendation"
  | "comparison"
  | "listen"
  | "action";

export type AmoraQuickStartOption = {
  mode: AmoraQuickStartMode;
  label: string;
  description: string;
  message: string;
  confirmation: string;
  changes: AmoraPersonalizationChanges;
};

export const AMORA_QUICK_START_OPTIONS: readonly AmoraQuickStartOption[] = [
  {
    mode: "recommendation",
    label: "추천안 하나부터",
    description: "선택지가 많을 때 가장 현실적인 안을 먼저 봐요",
    message:
      "추천안 하나부터 보고 싶어요. 지금 제 결혼 준비에서 가장 먼저 정할 한 가지를 알려주세요.",
    confirmation: "앞으로 결정이 필요할 때 추천안 하나를 먼저 보여드릴까요?",
    changes: { decisionStart: "recommend_first" },
  },
  {
    mode: "comparison",
    label: "선택지 비교부터",
    description: "근거와 차이를 본 뒤 직접 결정해요",
    message:
      "선택지를 비교하면서 시작하고 싶어요. 지금 정할 만한 것을 2~3개 선택지로 보여주세요.",
    confirmation: "앞으로 결정이 필요할 때 선택지와 차이를 먼저 보여드릴까요?",
    changes: { decisionStart: "compare_first" },
  },
  {
    mode: "listen",
    label: "마음부터 정리",
    description: "바로 해결하기보다 지금 상황을 먼저 이야기해요",
    message:
      "먼저 제 상황을 들어주세요. 한 번에 질문 하나만 하고, 해결책은 제가 원할 때 제안해주세요.",
    confirmation: "앞으로 힘들다고 말할 때 해결책보다 이야기를 먼저 들어드릴까요?",
    changes: { supportOrder: "listen_first" },
  },
  {
    mode: "action",
    label: "이번 할 일부터",
    description: "지금 바로 할 수 있는 한 가지부터 정해요",
    message:
      "긴 설명보다 지금 할 수 있는 일 하나부터 정리해주세요. 필요한 정보가 있으면 질문은 하나만 해주세요.",
    confirmation: "앞으로 막막할 때 바로 할 수 있는 한 가지부터 보여드릴까요?",
    changes: { supportOrder: "action_first" },
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isAmoraPersonalizationChanges(
  value: unknown,
): value is AmoraPersonalizationChanges {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    !keys.every((key) =>
      (AMORA_PERSONALIZATION_FIELD_NAMES as readonly string[]).includes(key),
    )
  ) {
    return false;
  }

  return (
    (value.decisionStart === undefined ||
      includesValue(AMORA_DECISION_START_VALUES, value.decisionStart)) &&
    (value.answerDetail === undefined ||
      includesValue(AMORA_ANSWER_DETAIL_VALUES, value.answerDetail)) &&
    (value.supportOrder === undefined ||
      includesValue(AMORA_SUPPORT_ORDER_VALUES, value.supportOrder)) &&
    (value.workMode === undefined ||
      includesValue(AMORA_WORK_MODE_VALUES, value.workMode)) &&
    (value.familyOrder === undefined ||
      includesValue(AMORA_FAMILY_ORDER_VALUES, value.familyOrder)) &&
    (value.toneStyle === undefined ||
      includesValue(AMORA_TONE_STYLE_VALUES, value.toneStyle))
  );
}

export function mergeAmoraPersonalization(
  current: AmoraPersonalizationPreferences | null,
  changes: AmoraPersonalizationChanges,
): AmoraPersonalizationPreferences {
  return {
    ...(current ?? DEFAULT_AMORA_PERSONALIZATION),
    ...changes,
  };
}

export function parseAmoraPersonalizationPreferences(
  value: unknown,
): AmoraPersonalizationPreferences | null {
  if (
    !isRecord(value) ||
    !includesValue(AMORA_DECISION_START_VALUES, value.decisionStart) ||
    !includesValue(AMORA_ANSWER_DETAIL_VALUES, value.answerDetail) ||
    !includesValue(AMORA_SUPPORT_ORDER_VALUES, value.supportOrder) ||
    !includesValue(AMORA_WORK_MODE_VALUES, value.workMode) ||
    !includesValue(AMORA_FAMILY_ORDER_VALUES, value.familyOrder) ||
    !includesValue(AMORA_TONE_STYLE_VALUES, value.toneStyle)
  ) {
    return null;
  }

  return {
    decisionStart: value.decisionStart,
    answerDetail: value.answerDetail,
    supportOrder: value.supportOrder,
    workMode: value.workMode,
    familyOrder: value.familyOrder,
    toneStyle: value.toneStyle,
  };
}

export function parseAmoraPersonalizationProfile(
  value: unknown,
): AmoraPersonalizationProfile | null {
  if (!isRecord(value) || !isRecord(value.preferences)) return null;
  const preferences = parseAmoraPersonalizationPreferences(value.preferences);
  if (
    !preferences ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.confirmedAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    preferences: {
      decisionStart: preferences.decisionStart,
      answerDetail: preferences.answerDetail,
      supportOrder: preferences.supportOrder,
      workMode: preferences.workMode,
      familyOrder: preferences.familyOrder,
      toneStyle: preferences.toneStyle,
    },
    revision: value.revision as number,
    confirmedAt: value.confirmedAt,
    updatedAt: value.updatedAt,
  };
}

export function parseAmoraPersonalizationRow(
  value: unknown,
): AmoraPersonalizationProfile | null {
  if (!isRecord(value)) return null;
  return parseAmoraPersonalizationProfile({
    preferences: {
      decisionStart: value.decision_start,
      answerDetail: value.answer_detail,
      supportOrder: value.support_order,
      workMode: value.work_mode,
      familyOrder: value.family_order,
      toneStyle: value.tone_style,
    },
    revision: value.revision,
    confirmedAt: value.confirmed_at,
    updatedAt: value.updated_at,
  });
}
