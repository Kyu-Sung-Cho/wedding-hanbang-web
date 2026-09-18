// 아모라 도움 방식(개인별 답변 표현·제안 순서) 계약. 웹 설정·채팅 지시문·API 와 앱 설정이 함께 쓴다.
// 2026-09-18 `apps/web/src/lib/amora/personalization.ts` 에서 옮겼다 — 앱 화면이 선택지와 문구를
// 따로 복사하면 두 벌이 갈라진다. 값·문구·판정은 옮기기 전과 한 글자도 다르지 않아야 한다.

const freezeAll = (values) => Object.freeze(values.map((value) => Object.freeze(value)));

export const AMORA_DECISION_START_VALUES = Object.freeze([
  "recommend_first",
  "compare_first",
  "ask_each_time",
]);
export const AMORA_ANSWER_DETAIL_VALUES = Object.freeze([
  "brief",
  "detailed",
  "adaptive",
]);
export const AMORA_SUPPORT_ORDER_VALUES = Object.freeze([
  "listen_first",
  "action_first",
  "ask_each_time",
]);
export const AMORA_WORK_MODE_VALUES = Object.freeze([
  "together",
  "owner_led",
  "hybrid",
  "ask_each_time",
]);
export const AMORA_FAMILY_ORDER_VALUES = Object.freeze([
  "couple_first",
  "family_input_first",
  "case_by_case",
  "ask_each_time",
]);
export const AMORA_TONE_STYLE_VALUES = Object.freeze([
  "adaptive",
  "warm",
  "calm_clear",
  "friendly_honest",
]);

export const DEFAULT_AMORA_PERSONALIZATION = Object.freeze({
  decisionStart: "ask_each_time",
  answerDetail: "adaptive",
  supportOrder: "ask_each_time",
  workMode: "ask_each_time",
  familyOrder: "ask_each_time",
  toneStyle: "adaptive",
});

export const AMORA_PERSONALIZATION_FIELD_NAMES = Object.freeze([
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
  "toneStyle",
]);

/** 설정 화면의 칸·선택지 문구. 웹 설정과 앱 설정이 이 한 벌을 그대로 그린다. */
export const AMORA_PERSONALIZATION_SECTIONS = Object.freeze([
  {
    key: "toneStyle",
    title: "아모라 말투",
    description: "어떤 느낌으로 답하면 편한지 골라주세요. 모두 존댓말로 답해요.",
    choices: freezeAll([
      {
        value: "adaptive",
        label: "상황에 맞게",
        description: "편한 대화는 부드럽게, 중요한 내용은 또렷하게 말해요.",
      },
      {
        value: "warm",
        label: "다정하고 편안하게",
        description: "서두르지 않고 마음을 살피며 이야기해요.",
      },
      {
        value: "calm_clear",
        label: "차분하고 또렷하게",
        description: "감정에 휩쓸리지 않고 핵심을 분명히 말해요.",
      },
      {
        value: "friendly_honest",
        label: "친근하고 솔직하게",
        description: "가깝게 말하되 필요한 이야기는 돌리지 않아요.",
      },
    ]),
  },
  {
    key: "decisionStart",
    title: "결정을 시작할 때",
    description: "여러 선택지 중 무엇부터 보여드릴지 정해요.",
    choices: freezeAll([
      {
        value: "recommend_first",
        label: "추천안 먼저",
        description: "현실적인 안 하나를 먼저 보고 조정해요.",
      },
      {
        value: "compare_first",
        label: "비교 먼저",
        description: "2~3개 선택지와 차이를 먼저 확인해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "상황마다 원하는 방식을 짧게 확인해요.",
      },
    ]),
  },
  {
    key: "answerDetail",
    title: "설명 분량",
    description: "아모라 답변의 기본 길이를 정해요.",
    choices: freezeAll([
      {
        value: "brief",
        label: "핵심만",
        description: "결론과 다음 행동을 짧게 봐요.",
      },
      {
        value: "detailed",
        label: "자세히",
        description: "근거와 주의점까지 충분히 봐요.",
      },
      {
        value: "adaptive",
        label: "상황에 맞게",
        description: "간단한 질문은 짧게, 중요한 결정은 자세히 봐요.",
      },
    ]),
  },
  {
    key: "supportOrder",
    title: "힘들다고 말했을 때",
    description: "공감과 실행 중 무엇을 먼저 할지 정해요.",
    choices: freezeAll([
      {
        value: "listen_first",
        label: "마음 먼저",
        description: "해결책보다 지금 상황을 먼저 들어요.",
      },
      {
        value: "action_first",
        label: "할 일 먼저",
        description: "바로 할 수 있는 한 가지부터 정리해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "들어줄지 해결할지 먼저 확인해요.",
      },
    ]),
  },
  {
    key: "workMode",
    title: "둘이 준비하는 방식",
    description: "할 일을 제안할 때의 기본 구조만 바꿔요.",
    choices: freezeAll([
      {
        value: "together",
        label: "처음부터 함께",
        description: "후보를 찾는 과정도 둘이 같이 확인해요.",
      },
      {
        value: "owner_led",
        label: "담당자가 먼저",
        description: "한 사람이 좁혀오고 둘이 최종 확정해요.",
      },
      {
        value: "hybrid",
        label: "상황에 따라 섞기",
        description: "중요한 결정만 함께 보고 나머지는 나눠요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "업무마다 함께할지 나눌지 확인해요.",
      },
    ]),
  },
  {
    key: "familyOrder",
    title: "가족·하객 의견이 있을 때",
    description: "누구의 생각을 먼저 확인할지 정할 뿐, 의무를 만들지 않아요.",
    choices: freezeAll([
      {
        value: "couple_first",
        label: "우리 둘 기준 먼저",
        description: "두 사람의 기준을 맞춘 뒤 필요한 의견을 들어요.",
      },
      {
        value: "family_input_first",
        label: "의견부터 모으기",
        description: "관련된 가족·하객 조건을 먼저 확인해요.",
      },
      {
        value: "case_by_case",
        label: "상황마다",
        description: "영향받는 사람과 비용에 따라 순서를 정해요.",
      },
      {
        value: "ask_each_time",
        label: "그때 물어보기",
        description: "가족 조율이 필요한지 먼저 확인해요.",
      },
    ]),
  },
].map((section) => Object.freeze(section)));

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includesValue(values, value) {
  return typeof value === "string" && values.includes(value);
}

export function isAmoraPersonalizationChanges(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    !keys.every((key) => AMORA_PERSONALIZATION_FIELD_NAMES.includes(key))
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

export function mergeAmoraPersonalization(current, changes) {
  return {
    ...(current ?? DEFAULT_AMORA_PERSONALIZATION),
    ...changes,
  };
}

export function parseAmoraPersonalizationPreferences(value) {
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

export function parseAmoraPersonalizationProfile(value) {
  if (!isRecord(value) || !isRecord(value.preferences)) return null;
  const preferences = parseAmoraPersonalizationPreferences(value.preferences);
  if (
    !preferences ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
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
    revision: value.revision,
    confirmedAt: value.confirmedAt,
    updatedAt: value.updatedAt,
  };
}

export function parseAmoraPersonalizationRow(value) {
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
