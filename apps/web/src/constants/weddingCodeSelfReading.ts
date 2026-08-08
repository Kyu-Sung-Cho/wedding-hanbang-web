import type { WeddingCodeV06AxisKey } from "./weddingCodeV06";
import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

/**
 * 개인 결과 카피.
 *
 * ## 왜 필요했나
 *
 * v0.6/v0.7의 개인 결과는 사용자가 고른 문장 4개를 그대로 되돌려주는 것이 전부였다.
 * 상대가 답하기 전까지는 **아무것도 알게 되지 않는다.** 그래서 혼자 푼 사람은 링크를
 * 보낼 이유를 못 느꼈고, 「자신을 파악한다」는 약속이 화면에 없었다.
 *
 * ## 무엇을 말하고, 무엇을 말하지 않나
 *
 * - 말한다: **본인이 고른 16개 답의 집계와 인용.** 「네 장면 중 세 곳에서 금액을 먼저
 *   보는 답을 골랐다」는 판정이 아니라 방금 남긴 사실이다.
 * - 말한다: 그 사실을 상대에게 전할 **한 문장**과, 그 방향으로만 고를 때 **비는 확인 항목**.
 * - 말하지 않는다: 유형, 4글자 코드, 동물, 점수, 등급, 궁합, 관계 예측, 성격 단정.
 *
 * 그래서 이 파일의 카피에는 사실 문장이 없다. 숫자와 인용은 전부
 * `lib/weddingCode/scene/selfProfile.ts`가 실제 응답에서 만들고, 여기에는 **조언만** 둔다.
 * 카피가 사실을 지어내지 못하게 하려는 분리다.
 */

/** 한 선택지가 「무엇을 먼저 보는 답」인지 한 마디로. 축 이름이 아니라 확인 대상이다. */
export const WEDDING_CODE_CHECK_PHRASE = {
  costRisk: "돈이 얼마나 더 드는지",
  evidenceDecision: "적힌 내용이 사실인지",
  aestheticMood: "우리가 원하는 느낌인지",
  experienceMeaning: "우리에게 어떤 의미인지",
  coPreparation: "둘이 같이 보고 정하는 방법",
  roleOwnership: "한 사람이 맡아 정리하는 방법",
  coupleAutonomy: "우리 둘의 기준",
  familyIntegration: "가족과 하객의 사정",
  emotionalSupport: "먼저 마음을 듣는 쪽",
  executionSupport: "먼저 할 일을 정하는 쪽",
} as const satisfies Partial<Record<WeddingCodeConstructKey, string>>;

export type WeddingCodeReadableConstructKey = keyof typeof WEDDING_CODE_CHECK_PHRASE;

export type WeddingCodeSelfLean = "left" | "right" | "mixed";

export type WeddingCodeSelfReadingCopy = Readonly<{
  /** 카드 제목. 「…형이에요」가 아니라 「…했어요」 — 한 일에 대한 서술이다. */
  title: string;
  /** 그대로 상대에게 보낼 수 있는 1인칭 한 문장. */
  tellPartner: string;
  /** 이 방향으로만 고를 때 비는 확인 항목. 성격 지적이 아니라 절차 제안이다. */
  watchOut: string;
}>;

export const WEDDING_CODE_SELF_READING = {
  decisionCriteria: {
    left: {
      title: "금액과 조건부터 확인했어요",
      tellPartner:
        "나는 견적을 보면 총액이랑 따로 더 드는 돈부터 확인하고 싶어. 마음에 드는지는 그다음에 이야기하자.",
      watchOut:
        "계약 전에 “이건 우리가 원하던 느낌이 맞아?”를 한 번은 소리 내어 물어보세요. 조건만 맞춘 선택은 나중에 아쉬움으로 남을 수 있어요.",
    },
    right: {
      title: "분위기와 의미부터 확인했어요",
      tellPartner:
        "나는 이게 우리가 원하던 느낌인지부터 보게 돼. 금액이랑 조건은 네가 먼저 짚어주면 좋겠어.",
      watchOut:
        "계약 전에 총액 외 추가 금액과 취소했을 때 돌려받는 금액을 서면으로 받아 두세요. 느낌이 맞아도 이 두 가지는 따로 확인해야 해요.",
    },
    mixed: {
      title: "장면마다 먼저 보는 것이 달랐어요",
      tellPartner:
        "나는 상황마다 먼저 보는 게 달라. 이번 결정은 돈부터 볼지 느낌부터 볼지 시작할 때 정하고 가자.",
      watchOut:
        "먼저 볼 기준이 매번 바뀌면 상대는 미리 맞추기 어려워요. 결정 하나를 시작할 때 “이번엔 뭘 먼저 볼까”를 먼저 정해 보세요.",
    },
  },
  preparationMode: {
    left: {
      title: "둘이 같이 보는 방법을 골랐어요",
      tellPartner:
        "나는 준비를 같이 보고 같이 정할 때 안심이 돼. 큰 결정 전에는 시간을 맞춰서 같이 보자.",
      watchOut:
        "모든 걸 같이 보려면 일정이 밀리기 쉬워요. 둘 중 한 사람이 맡고 결과만 함께 확인할 일을 최소 하나 정해 보세요.",
    },
    right: {
      title: "각자 맡아 정리하는 방법을 골랐어요",
      tellPartner:
        "나는 분야를 나눠서 각자 맡고 결과를 공유하는 게 편해. 대신 최종 결정은 같이 확인하자.",
      watchOut:
        "나눠서 진행하더라도 “이건 꼭 같이 본다”는 항목을 최소 하나 정해 두세요. 맡긴 쪽만 아는 조건이 계약서에 남으면 나중에 되돌리기 어려워요.",
    },
    mixed: {
      title: "같이 볼 일과 맡길 일이 나뉘었어요",
      tellPartner:
        "나는 같이 볼 일과 맡길 일을 나누고 싶어. 남은 일을 적어놓고 어디까지 같이 볼지 표시하자.",
      watchOut:
        "경계가 정해져 있지 않으면 서로 상대가 하겠거니 하고 기다리다 밀려요. 남은 일 목록에 ‘같이’와 ‘맡김’을 표시해 두세요.",
    },
  },
  coordinationScope: {
    left: {
      title: "우리 둘의 기준을 먼저 뒀어요",
      tellPartner:
        "나는 우리 둘이 정한 기준을 먼저 지키고 싶어. 양가에 전할 말은 정리해서 같이 말하자.",
      watchOut:
        "부모님이 걱정하는 항목을 미리 물어 적어두세요. 결정을 마친 뒤에 나오는 걱정은 이미 계약한 조건을 되돌려야 하는 일이 됩니다.",
    },
    right: {
      title: "가족과 하객 사정을 먼저 봤어요",
      tellPartner:
        "나는 양가랑 하객 사정을 먼저 확인하고 싶어. 대신 우리 둘이 양보하지 않을 것 두 가지는 미리 정해두자.",
      watchOut:
        "양보하지 않을 조건 두 가지를 먼저 적어두세요. 조율할 여지를 다 열어두면 둘이 원했던 것이 무엇이었는지 남지 않아요.",
    },
    mixed: {
      title: "우리 기준과 가족 사정 사이에서 갈렸어요",
      tellPartner:
        "나는 우리끼리 정할 일과 양가에 먼저 물을 일을 나누고 싶어. 목록을 적어서 선을 긋자.",
      watchOut:
        "결정마다 기준이 바뀌면 양가에 전하는 말도 달라져요. 둘이 정할 범위와 양가에 물을 범위를 종이에 나눠 적어 보세요.",
    },
  },
  supportOrder: {
    left: {
      title: "먼저 마음을 듣는 쪽을 골랐어요",
      tellPartner:
        "나는 힘들다고 말할 때 해결책보다 먼저 들어주면 좋겠어. 해결은 그다음에 같이 하자.",
      watchOut:
        "마감이 걸린 일에는 “오늘은 하나만 정하자”를 함께 정해두세요. 마음을 먼저 듣다 보면 결정이 계속 다음으로 넘어갈 수 있어요.",
    },
    right: {
      title: "먼저 할 일을 정하는 쪽을 골랐어요",
      tellPartner:
        "나는 막막할 때 할 일을 하나 정하면 마음이 놓여. 대신 네가 힘들다고 하면 뭐가 필요한지 먼저 물어볼게.",
      watchOut:
        "상대가 힘들다고 하면 해결책 전에 “지금은 듣는 게 필요해, 같이 정하는 게 필요해?”를 먼저 물어보세요.",
    },
    mixed: {
      title: "그날에 따라 필요한 것이 달랐어요",
      tellPartner:
        "나는 그때그때 필요한 게 달라. 힘들다고 말할 때 뭐가 필요한지 내가 먼저 말할게.",
      watchOut:
        "필요한 것이 매번 달라 상대가 맞히기 어려워요. 힘들다고 말할 때 “오늘은 듣는 게 필요해”처럼 먼저 알려주세요.",
    },
  },
} as const satisfies Readonly<
  Record<WeddingCodeV06AxisKey, Readonly<Record<WeddingCodeSelfLean, WeddingCodeSelfReadingCopy>>>
>;
