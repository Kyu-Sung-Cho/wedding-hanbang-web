// 도움 방식의 값·문구·파서는 앱과 함께 쓰려고 `@hanbang/shared/amora-personalization` 으로 옮겼다
// (2026-09-18). 이 파일은 웹 import 경로를 지키려고 그대로 다시 내보내고, 웹 채팅에만 있는
// 빠른 시작 선택지만 여기에 남긴다.
import type { AmoraPersonalizationChanges } from "@hanbang/shared/amora-personalization";

export {
  AMORA_ANSWER_DETAIL_VALUES,
  AMORA_DECISION_START_VALUES,
  AMORA_FAMILY_ORDER_VALUES,
  AMORA_PERSONALIZATION_FIELD_NAMES,
  AMORA_PERSONALIZATION_SECTIONS,
  AMORA_SUPPORT_ORDER_VALUES,
  AMORA_TONE_STYLE_VALUES,
  AMORA_WORK_MODE_VALUES,
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  parseAmoraPersonalizationPreferences,
  parseAmoraPersonalizationProfile,
  parseAmoraPersonalizationRow,
} from "@hanbang/shared/amora-personalization";
export type {
  AmoraAnswerDetail,
  AmoraDecisionStart,
  AmoraFamilyOrder,
  AmoraPersonalizationChanges,
  AmoraPersonalizationChoice,
  AmoraPersonalizationFieldName,
  AmoraPersonalizationPreferences,
  AmoraPersonalizationProfile,
  AmoraPersonalizationSection,
  AmoraSupportOrder,
  AmoraToneStyle,
  AmoraWorkMode,
} from "@hanbang/shared/amora-personalization";

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
