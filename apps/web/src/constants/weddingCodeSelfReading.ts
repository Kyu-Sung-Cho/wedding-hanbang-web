import type { WeddingCodeV06AxisKey } from "./weddingCodeV06";
import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

/**
 * 개인 결과 카피.
 *
 * ## 무엇을 말하고, 무엇을 말하지 않나
 *
 * - 제목은 이번 응답이 어느 쪽에 모였는지만 설명한다.
 * - 상대에게 전할 문장은 현재 원하는 방식을 직접 확인하는 질문이다.
 * - 상대에게 한 행동과 내가 받고 싶은 도움, 실제 진행 방식과 원하는 방식을 같다고 보지 않는다.
 * - 안내는 다음 확인 절차이며, 감정이나 관계의 미래 결과를 단정하지 않는다.
 *
 * 응답 수와 원문 인용은 `lib/weddingCode/scene/selfProfile.ts`에서 만든다.
 */

/** 한 선택지가 「무엇을 먼저 보는 답」인지 한 마디로. 축 이름이 아니라 확인 대상이다. */
export const WEDDING_CODE_CHECK_PHRASE = {
  costRisk: "돈이 얼마나 더 드는지",
  evidenceDecision: "적힌 내용이 사실인지",
  aestheticMood: "우리가 원하는 느낌인지",
  experienceMeaning: "우리에게 어떤 의미인지",
  coPreparation: "함께 확인하는 과정과 연락 경험",
  roleOwnership: "한 사람이 맡아 정리하는 방법",
  coupleAutonomy: "우리 둘의 기준",
  familyIntegration: "가족과 하객의 사정",
  emotionalSupport: "먼저 마음을 듣는 쪽",
  executionSupport: "먼저 할 일을 정하는 쪽",
} as const satisfies Partial<Record<WeddingCodeConstructKey, string>>;

export type WeddingCodeReadableConstructKey = keyof typeof WEDDING_CODE_CHECK_PHRASE;

export type WeddingCodeSelfLean = "left" | "right" | "mixed";

export type WeddingCodeSelfReadingCopy = Readonly<{
  /** 카드 제목. 실제 행동·마음이 아니라 고른 답을 설명한다. */
  title: string;
  /** 현재 원하는 방식을 함께 확인하기 위한 질문. */
  tellPartner: string;
  /** 이 방향으로만 고를 때 비는 확인 항목. 성격 지적이 아니라 절차 제안이다. */
  watchOut: string;
}>;

export const WEDDING_CODE_SELF_READING = {
  decisionCriteria: {
    left: {
      title: "금액과 조건 쪽 답을 더 골랐어요",
      tellPartner:
        "이번에는 총액과 조건부터 볼까, 원하는 분위기부터 볼까? 지금 먼저 확인할 것을 같이 정해보자.",
      watchOut:
        "이 장면에서 고른 답이 지금도 원하는 순서인지 확인해 보세요. 실제 계약에서는 총액·포함 항목·취소 조건과 원하는 분위기를 각각 확인하세요.",
    },
    right: {
      title: "분위기와 의미 쪽 답을 더 골랐어요",
      tellPartner:
        "이번에는 원하는 분위기부터 볼까, 총액과 조건부터 볼까? 각자 먼저 확인할 것을 하나씩 말해보자.",
      watchOut:
        "계약 전에 총액 외 추가 금액과 취소했을 때 돌려받는 금액을 서면으로 받아 두세요. 느낌이 맞아도 이 두 가지는 따로 확인해야 해요.",
    },
    mixed: {
      title: "두 기준의 답을 같은 수로 골랐어요",
      tellPartner:
        "이번 결정에서는 돈과 조건, 원하는 분위기 중 무엇부터 볼까? 같은 장면에서 서로 고른 답도 같이 보자.",
      watchOut:
        "답이 같은 수라는 사실만으로 원하는 순서가 정해지지는 않아요. 이번 결정에서 먼저 확인할 기준을 각자 말해 보세요.",
    },
  },
  preparationMode: {
    left: {
      title: "함께 확인하는 과정과 연락 경험에 관한 답이 더 많았어요",
      tellPartner:
        "이번 일은 함께 볼까, 분야를 나눠 맡을까? 지금 각자 가능한 시간부터 맞춰보자.",
      watchOut:
        "실제로 진행된 방식과 지금 원하는 방식은 다를 수 있어요. 남은 일에서 함께 볼 것과 맡길 것을 직접 확인해 보세요.",
    },
    right: {
      title: "담당자가 정리하는 쪽 답을 더 골랐어요",
      tellPartner:
        "이번 일은 분야를 나눠 맡을까, 함께 볼까? 후보를 정리할 사람과 최종 확인할 사람을 어떻게 나눌까?",
      watchOut:
        "후보 정리를 맡기는 것과 최종 결정을 맡기는 것은 달라요. 어디까지 맡기고 무엇을 함께 확인할지 정해 보세요.",
    },
    mixed: {
      title: "준비와 연락을 나누는 두 쪽 답을 같은 수로 골랐어요",
      tellPartner:
        "이번에 함께 볼 일과 맡길 일은 무엇일까? 남은 일을 놓고 각각 표시해보자.",
      watchOut:
        "답이 같은 수여도 맡기려는 일은 서로 다를 수 있어요. 같은 장면에서 고른 문장을 비교하고 담당과 확인 범위를 정해 보세요.",
    },
  },
  coordinationScope: {
    left: {
      title: "둘의 기준 쪽 답을 더 골랐어요",
      tellPartner:
        "이번 결정에서 둘이 정할 부분과 가족·하객 의견을 확인할 부분은 무엇일까?",
      watchOut:
        "이 장면의 답이 현재 상황에도 맞는지 확인하세요. 관련된 사람의 조건을 듣는 범위와 최종 결정 범위는 나누어 정해 보세요.",
    },
    right: {
      title: "가족과 하객 사정 쪽 답을 더 골랐어요",
      tellPartner:
        "이번에는 누구의 어떤 사정을 먼저 확인할까? 의견을 듣는 범위와 결정하는 범위를 따로 정해볼까?",
      watchOut:
        "의견을 듣는 것과 그 의견대로 결정하는 것은 달라요. 두 사람이 원하는 조건과 반영 가능한 범위를 따로 확인해 보세요.",
    },
    mixed: {
      title: "둘의 기준과 가족 사정 답을 같은 수로 골랐어요",
      tellPartner:
        "이번 일은 둘이 정할까, 관련된 사람의 의견을 먼저 들을까? 각자 그 순서를 고르는 이유도 말해보자.",
      watchOut:
        "두 쪽 답이 같은 수여도 실제로 의견을 들으려는 상황은 다를 수 있어요. 장면별 답과 현재 결정 범위를 함께 확인해 보세요.",
    },
  },
  supportOrder: {
    left: {
      title: "마음을 듣는 쪽 답을 더 골랐어요",
      tellPartner:
        "지금은 이야기를 들어주는 것과 할 일을 정리하는 것 중 어떤 도움이 필요할까? 서로 필요한 방식을 따로 말해보자.",
      watchOut:
        "상대에게 했던 행동과 내가 받고 싶은 도움은 다를 수 있어요. 지금 각자가 받을 도움을 직접 확인해 보세요.",
    },
    right: {
      title: "할 일을 정하는 쪽 답을 더 골랐어요",
      tellPartner:
        "지금은 할 일을 정리하는 것과 이야기를 들어주는 것 중 어떤 도움이 필요할까? 서로 필요한 방식을 따로 말해보자.",
      watchOut:
        "상대에게 했던 행동을 내가 원하는 도움으로 옮기지 말고, 지금 받을 도움을 직접 확인해 보세요.",
    },
    mixed: {
      title: "듣기와 할 일 정리 답을 같은 수로 골랐어요",
      tellPartner:
        "지금은 이야기를 들어주는 게 필요할까, 할 일을 함께 정리하는 게 필요할까? 각자 원하는 도움을 말해보자.",
      watchOut:
        "답이 같은 수라는 이유로 필요한 도움이 매번 바뀐다고 단정하지 않아요. 현재 원하는 도움과 상대에게 해줄 수 있는 도움을 따로 확인해 보세요.",
    },
  },
} as const satisfies Readonly<
  Record<WeddingCodeV06AxisKey, Readonly<Record<WeddingCodeSelfLean, WeddingCodeSelfReadingCopy>>>
>;
