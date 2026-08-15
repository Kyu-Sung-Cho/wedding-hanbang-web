const PREFERENCE_FIELDS = Object.freeze([
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
  "toneStyle",
]);

function freezeChoices(choices) {
  return Object.freeze(choices.map((choice) => Object.freeze(choice)));
}

function freezeSection(section) {
  return Object.freeze({
    ...section,
    choices: freezeChoices(section.choices),
  });
}

export const AMORA_PERSONALIZATION_SETTING_SECTIONS = Object.freeze([
  freezeSection({
    field: "toneStyle",
    title: "아모라의 말투",
    description: "같은 내용도 내가 편하게 받아들일 수 있는 말투로 전해요.",
    choices: [
      {
        value: "adaptive",
        label: "상황에 맞게",
        description: "위로가 필요할 땐 부드럽게, 결정할 땐 분명하게 말해요.",
      },
      {
        value: "warm",
        label: "다정하고 편안하게",
        description: "서두르지 않고 마음을 살피며 이야기해요.",
      },
      {
        value: "calm_clear",
        label: "차분하고 명확하게",
        description: "감정을 부풀리지 않고 핵심과 다음 행동을 분명히 말해요.",
      },
      {
        value: "friendly_honest",
        label: "친근하고 솔직하게",
        description: "가깝게 이야기하되 필요한 말은 돌리지 않아요.",
      },
    ],
  }),
  freezeSection({
    field: "decisionStart",
    title: "결정을 시작할 때",
    description: "막막한 선택 앞에서 아모라가 무엇부터 보여줄지 정해요.",
    choices: [
      {
        value: "recommend_first",
        label: "추천안 하나부터",
        description: "지금 상황에 맞는 안 하나와 이유부터 봐요.",
      },
      {
        value: "compare_first",
        label: "선택지 비교부터",
        description: "두세 가지 선택 기준과 차이부터 봐요.",
      },
      {
        value: "ask_each_time",
        label: "그때마다 물어보기",
        description: "결정마다 원하는 시작 방식을 먼저 확인해요.",
      },
    ],
  }),
  freezeSection({
    field: "answerDetail",
    title: "설명 깊이",
    description: "답을 얼마나 짧게 또는 자세히 볼지 정해요.",
    choices: [
      {
        value: "brief",
        label: "짧고 핵심만",
        description: "결론과 다음 행동 위주로 간단히 봐요.",
      },
      {
        value: "adaptive",
        label: "필요한 만큼 자세히",
        description: "간단히 시작하고 중요한 부분만 더 설명해요.",
      },
      {
        value: "detailed",
        label: "처음부터 자세히",
        description: "근거와 선택 기준까지 충분히 살펴봐요.",
      },
    ],
  }),
  freezeSection({
    field: "supportOrder",
    title: "막혔을 때 도움 순서",
    description: "힘들거나 막막하다고 말했을 때 무엇부터 도울지 정해요.",
    choices: [
      {
        value: "listen_first",
        label: "먼저 들어주기",
        description: "바로 해결하기 전에 지금 상황과 마음을 한 번 정리해요.",
      },
      {
        value: "action_first",
        label: "바로 할 일부터",
        description: "지금 움직일 수 있는 한 가지부터 보여줘요.",
      },
      {
        value: "ask_each_time",
        label: "그때마다 물어보기",
        description: "들어줄지 해결할지 상황마다 먼저 확인해요.",
      },
    ],
  }),
  freezeSection({
    field: "workMode",
    title: "둘이 준비하는 방식",
    description: "조사와 확인을 둘이 어떻게 나눌지 제안하는 기준이에요.",
    choices: [
      {
        value: "together",
        label: "둘이 함께 확인",
        description: "중간 과정부터 두 사람이 같이 확인하는 흐름으로 제안해요.",
      },
      {
        value: "owner_led",
        label: "한 명이 먼저 정리",
        description: "한 사람이 후보를 좁히고 둘이 마지막에 확인하도록 제안해요.",
      },
      {
        value: "hybrid",
        label: "중요한 건 함께, 나머지는 나눠서",
        description: "되돌리기 어려운 결정은 함께 보고 나머지는 나눠요.",
      },
      {
        value: "ask_each_time",
        label: "그때마다 물어보기",
        description: "준비 항목마다 원하는 협업 방식을 먼저 확인해요.",
      },
    ],
  }),
  freezeSection({
    field: "familyOrder",
    title: "가족 의견을 다룰 때",
    description: "가족과 조율할 일이 생겼을 때 누구의 기준부터 확인할지 정해요.",
    choices: [
      {
        value: "couple_first",
        label: "우리 둘 기준 먼저",
        description: "두 사람의 기준을 맞춘 뒤 필요한 가족 의견을 확인해요.",
      },
      {
        value: "family_input_first",
        label: "관련된 의견부터 확인",
        description: "영향받는 가족의 조건부터 모으되 최종 결정으로 단정하지 않아요.",
      },
      {
        value: "case_by_case",
        label: "상황마다 정하기",
        description: "비용과 참석 여부처럼 이번 결정의 영향을 보고 순서를 정해요.",
      },
      {
        value: "ask_each_time",
        label: "그때마다 물어보기",
        description: "가족 조율이 필요한 결정마다 누구부터 확인할지 물어봐요.",
      },
    ],
  }),
]);

function hasExactPreferenceKeys(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return false;
  }
  const keys = Object.keys(preferences);
  return keys.length === PREFERENCE_FIELDS.length
    && PREFERENCE_FIELDS.every((field) => keys.includes(field));
}

export function getAmoraPersonalizationSettingsView(preferences) {
  if (!hasExactPreferenceKeys(preferences)) return null;

  const result = [];
  for (const section of AMORA_PERSONALIZATION_SETTING_SECTIONS) {
    const selectedValue = preferences[section.field];
    const selected = section.choices.find((choice) => choice.value === selectedValue);
    if (!selected) return null;
    result.push(Object.freeze({
      ...section,
      selectedValue,
      selectedLabel: selected.label,
    }));
  }
  return Object.freeze(result);
}

const SUMMARY_TONE = Object.freeze({
  adaptive: "상황에 맞게",
  warm: "다정하고 편안하게",
  calm_clear: "차분하고 명확하게",
  friendly_honest: "친근하고 솔직하게",
});
const SUMMARY_DECISION = Object.freeze({
  recommend_first: "추천안 하나부터",
  compare_first: "선택지 비교부터",
  ask_each_time: "원하는 시작 방식을 물어본 뒤",
});
const SUMMARY_DETAIL = Object.freeze({
  brief: "핵심만 짧게",
  adaptive: "필요한 만큼",
  detailed: "근거까지 자세히",
});
const SUMMARY_SUPPORT = Object.freeze({
  listen_first: "막히면 먼저 이야기를 듣고",
  action_first: "막히면 바로 할 일부터 보여주고",
  ask_each_time: "막히면 들어줄지 해결할지 먼저 묻고",
});
const SUMMARY_WORK = Object.freeze({
  together: "둘이 함께 확인하는 흐름",
  owner_led: "한 명이 먼저 정리하는 흐름",
  hybrid: "중요한 건 함께 보고 나머지는 나누는 흐름",
  ask_each_time: "준비 항목마다 협업 방식을 묻는 흐름",
});
const SUMMARY_FAMILY = Object.freeze({
  couple_first: "가족 조율은 우리 둘 기준부터 맞춰요.",
  family_input_first: "가족 조율은 관련된 의견부터 확인해요.",
  case_by_case: "가족 조율은 상황에 따라 순서를 정해요.",
  ask_each_time: "가족 조율 순서는 그때마다 확인해요.",
});

export function buildAmoraPersonalizationSummary(preferences) {
  if (!getAmoraPersonalizationSettingsView(preferences)) return null;
  return `${SUMMARY_TONE[preferences.toneStyle]} 말하고 ${SUMMARY_DECISION[preferences.decisionStart]} 시작해요. `
    + `${SUMMARY_SUPPORT[preferences.supportOrder]} ${SUMMARY_DETAIL[preferences.answerDetail]} 설명해요. `
    + `${SUMMARY_WORK[preferences.workMode]}으로 제안하고, ${SUMMARY_FAMILY[preferences.familyOrder]}`;
}

const HOME_DECISION_LABELS = Object.freeze({
  recommend_first: "추천 한 가지부터",
  compare_first: "선택지 비교부터",
  ask_each_time: "진행 방식 확인부터",
});

const HOME_DETAIL_LABELS = Object.freeze({
  brief: "핵심만",
  adaptive: "필요한 만큼",
  detailed: "근거까지 자세히",
});

const HOME_WORK_LABELS = Object.freeze({
  together: "둘이 함께",
  owner_led: "한 명이 먼저 정리",
  hybrid: "중요한 건 함께",
  ask_each_time: "일마다 맞춰서",
});

const HOME_CHAT_ACTION_LABELS = Object.freeze({
  intake: Object.freeze({
    recommend_first: "다음 한 가지 추천받기",
    compare_first: "선택지부터 비교하기",
    ask_each_time: "진행 방식부터 정하기",
  }),
  focus: Object.freeze({
    recommend_first: "아모라 추천도 보기",
    compare_first: "다른 선택도 비교하기",
    ask_each_time: "아모라와 이어보기",
  }),
});

export function buildAmoraHomePersonalization(preferences, chatIntent) {
  if (!getAmoraPersonalizationSettingsView(preferences)) return null;
  if (chatIntent !== "intake" && chatIntent !== "focus") return null;

  return Object.freeze({
    label: `내 방식: ${HOME_DECISION_LABELS[preferences.decisionStart]} · ${HOME_DETAIL_LABELS[preferences.answerDetail]} · ${HOME_WORK_LABELS[preferences.workMode]}`,
    chatActionLabel:
      HOME_CHAT_ACTION_LABELS[chatIntent][preferences.decisionStart],
  });
}
