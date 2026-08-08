import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import type {
  AmoraPersonalizationChanges,
  AmoraPersonalizationPreferences,
} from "@/lib/amora/personalization";
import {
  describeSelfAxisReading,
  type WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";

/**
 * 웨딩코드 → 아모라 도움 방식 **제안**.
 *
 * ## 왜 이 다리가 성립하나
 *
 * 아모라에는 이미 `amora_personalization_preferences`가 있고, 그 값이
 * `lib/ai/prompts.ts`에서 모델 지시문으로 내려간다. 그런데 기본값이 전부
 * `ask_each_time`이다 — **아무도 신호를 넣어주지 않기 때문**이다. 그래서 아모라는
 * 매번 「들어드릴까요, 같이 정할까요」를 다시 묻는다.
 *
 * 웨딩코드 축 셋은 그 설정과 **같은 질문을 다른 말로** 묻는다.
 *
 * | 웨딩코드 축 | 아모라 설정 | 관계 |
 * |---|---|---|
 * | 준비를 어떻게 나누나 | `workMode` | 같은 질문 |
 * | 누구까지 넣고 정하나 | `familyOrder` | 같은 질문 |
 * | 힘들 때 뭐부터 하나 | `supportOrder` | 같은 질문 |
 * | 정할 때 뭘 먼저 보나 | `decisionStart` | **추론**이라 약하다 |
 *
 * ## 이것이 성격 판정이 아닌 이유
 *
 * 아모라 프롬프트의 안전선은 「사용자가 화면에서 **직접 고른** 답변 방식」만 받는다.
 * 여기서 넘기는 것도 추정한 성향이 아니라 사용자가 16장면에서 직접 고른 답의 셈이고,
 * 근거 문장(`basis`)이 항상 함께 간다. 그리고 이 모듈은 **제안만 만든다** — 저장도,
 * 적용도, 네트워크 호출도 하지 않는다. 실제 반영은 사용자가 설정 화면에서 확인할 때만
 * 일어난다(CLAUDE.md: 사용자가 확인한 변경만 저장한다).
 *
 * ## 왜 균형(2:2)을 빈칸으로 두지 않나
 *
 * 2:2는 「모름」이 아니라 **장면마다 다르게 골랐다**는 관찰이다. 아모라 설정에는 그
 * 상태를 그대로 받는 값이 이미 있다(`hybrid`, `case_by_case`, `ask_each_time`).
 * 없는 확신을 만들지 않으면서 신호를 버리지도 않는다.
 */

export const WEDDING_CODE_AMORA_BRIDGE_VERSION = "wedding-code-amora-v1";

/**
 * 같은 질문을 옮기는 것(`direct`)과 추론하는 것(`indirect`)을 섞지 않는다.
 * 사람 검증에서 먼저 깨질 곳이 `indirect`이므로, 화면과 검증 계획이 둘을 구분해야 한다.
 */
export type WeddingCodeBridgeConfidence = "direct" | "indirect";

export type WeddingCodeAmoraProposal = Readonly<{
  field: keyof AmoraPersonalizationPreferences;
  value: AmoraPersonalizationPreferences[keyof AmoraPersonalizationPreferences];
  axis: WeddingCodeV06AxisKey;
  /** 설정 화면에 실제로 쓰여 있는 선택지 이름. 내부 값을 사용자에게 보이지 않는다. */
  choiceLabel: string;
  /** 아모라가 그래서 무엇을 다르게 하는지. 프롬프트 지시문과 같은 방향이어야 한다. */
  effect: string;
  /** 이 제안이 나온 근거 — 사용자의 응답 셈 문장 그대로. */
  basis: string;
  confidence: WeddingCodeBridgeConfidence;
  /** `indirect`일 때만. 왜 약한 제안인지 화면에서 그대로 알린다. */
  caution?: string;
}>;

type AxisMapping = Readonly<{
  field: keyof AmoraPersonalizationPreferences;
  confidence: WeddingCodeBridgeConfidence;
  caution?: string;
  values: Readonly<
    Record<
      "left" | "right" | "mixed",
      | Readonly<{
        value: AmoraPersonalizationPreferences[keyof AmoraPersonalizationPreferences];
        choiceLabel: string;
        effect: string;
      }>
      | null
    >
  >;
}>;

const AXIS_MAPPINGS: Readonly<Record<WeddingCodeV06AxisKey, AxisMapping>> = {
  preparationMode: {
    field: "workMode",
    confidence: "direct",
    values: {
      left: {
        value: "together",
        choiceLabel: "함께 보기",
        effect: "아모라가 초안을 낼 때 두 사람이 함께 확인할 지점을 같이 보여줘요.",
      },
      right: {
        value: "owner_led",
        choiceLabel: "담당자 중심",
        effect: "한 사람이 후보를 좁히고 둘이 최종 확인하는 구조를 먼저 제안해요.",
      },
      mixed: {
        value: "hybrid",
        choiceLabel: "섞어서",
        effect: "되돌리기 어려운 결정만 함께 보고 나머지는 나누는 구조를 제안해요.",
      },
    },
  },
  coordinationScope: {
    field: "familyOrder",
    confidence: "direct",
    values: {
      left: {
        value: "couple_first",
        choiceLabel: "둘의 기준 먼저",
        effect: "두 사람의 기준을 먼저 정리한 뒤 필요한 범위에서 가족 의견을 확인해요.",
      },
      right: {
        value: "family_input_first",
        choiceLabel: "관련된 사람 의견 먼저",
        effect: "결정에 실제 영향을 받는 사람의 조건을 먼저 모으는 순서를 제안해요.",
      },
      mixed: {
        value: "case_by_case",
        choiceLabel: "상황에 따라",
        effect: "비용 부담과 되돌리기 어려움을 기준으로 이번 결정의 순서를 정리해요.",
      },
    },
  },
  supportOrder: {
    field: "supportOrder",
    confidence: "direct",
    values: {
      left: {
        value: "listen_first",
        choiceLabel: "듣기 먼저",
        effect: "힘들다고 말하면 해결책부터 쏟지 않고 먼저 받아준 뒤 하나만 물어요.",
      },
      right: {
        value: "action_first",
        choiceLabel: "할 일 먼저",
        effect: "감정을 한 문장으로 짚은 뒤 지금 할 수 있는 행동 하나를 정리해요.",
      },
      // 2:2는 「그때그때 다르다」가 사실이고, 아모라도 그때 한 번만 묻는 값이 있다.
      mixed: {
        value: "ask_each_time",
        choiceLabel: "그때 물어보기",
        effect: "원하는 도움이 불분명할 때만 듣기와 정리 중 무엇이 필요한지 한 번 물어요.",
      },
    },
  },
  decisionCriteria: {
    field: "decisionStart",
    confidence: "indirect",
    caution:
      "이 항목만 응답에서 바로 옮긴 값이 아니라 추론이에요. 다르면 설정에서 바꾸세요.",
    values: {
      // 「적힌 내용이 사실인지」를 먼저 보는 답은 비교·근거 확인과 같은 행동이다.
      left: {
        value: "compare_first",
        choiceLabel: "비교 먼저",
        effect: "확인된 선택지가 있으면 2~3개의 핵심 차이를 먼저 비교한 뒤 추천해요.",
      },
      // 분위기·의미를 먼저 보는 것이 「추천안 하나를 원한다」는 뜻은 아니다.
      // 근거 없이 값을 만들지 않고 비워 둔다.
      right: null,
      mixed: null,
    },
  },
};

/**
 * 개인 결과에서 아모라 설정 제안을 만든다.
 *
 * 답하지 않은 축은 제안하지 않는다 — 빈 응답에서 나온 기본값을 사용자의 선택처럼
 * 저장하면, 그 순간 이 제품은 사용자가 고르지 않은 것을 고른 것으로 만드는 도구가 된다.
 */
export function buildWeddingCodeAmoraProposals(
  profile: WeddingCodeSelfProfile,
): readonly WeddingCodeAmoraProposal[] {
  const proposals: WeddingCodeAmoraProposal[] = [];
  for (const reading of profile.axes) {
    if (reading.answered === 0) continue;
    const mapping = AXIS_MAPPINGS[reading.axis];
    const target = mapping.values[reading.lean];
    if (!target) continue;
    proposals.push({
      field: mapping.field,
      value: target.value,
      axis: reading.axis,
      choiceLabel: target.choiceLabel,
      effect: target.effect,
      basis: describeSelfAxisReading(reading),
      confidence: mapping.confidence,
      ...(mapping.caution ? { caution: mapping.caution } : {}),
    });
  }
  // 같은 응답이면 언제 열어도 같은 순서·같은 제안이어야 한다.
  return proposals.sort((a, b) => a.field.localeCompare(b.field));
}

/** 설정 API에 그대로 넘길 수 있는 형태. 확인 절차는 호출하는 쪽 책임이다. */
export function weddingCodeProposalChanges(
  proposals: readonly WeddingCodeAmoraProposal[],
): AmoraPersonalizationChanges {
  const changes: Record<string, string> = {};
  for (const proposal of proposals) changes[proposal.field] = proposal.value;
  return changes as AmoraPersonalizationChanges;
}

export type WeddingCodeCoupleCombination = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  state: "aligned" | "split";
  firstTitle: string;
  secondTitle: string;
  /** 아모라가 이 조합에서 지켜야 할 행동. 갈린 축에서는 한쪽 편을 들지 않는다. */
  directive: string;
}>;

/**
 * 두 사람의 조합.
 *
 * 아모라 설정은 계정별(`owner_user_id`)이고 프롬프트도 「두 사람의 공동 합의가 아니다」라고
 * 못 박는다. 그래서 조합은 설정으로 저장하지 않고 **행동 지침**으로만 남긴다.
 * 특히 갈린 축에서 한 사람의 값으로 아모라를 맞추면, 아모라가 자동으로 한쪽 편이 된다.
 */
export function buildWeddingCodeCoupleCombination(
  first: WeddingCodeSelfProfile,
  second: WeddingCodeSelfProfile,
): readonly WeddingCodeCoupleCombination[] {
  const combinations: WeddingCodeCoupleCombination[] = [];
  for (const [index, firstReading] of first.axes.entries()) {
    const secondReading = second.axes[index];
    if (!secondReading) continue;
    if (firstReading.answered === 0 || secondReading.answered === 0) continue;
    const aligned = firstReading.lean === secondReading.lean;
    combinations.push({
      axis: firstReading.axis,
      axisLabel: firstReading.axisLabel,
      state: aligned ? "aligned" : "split",
      firstTitle: firstReading.title,
      secondTitle: secondReading.title,
      directive: aligned
        ? ALIGNED_DIRECTIVE[firstReading.axis]
        : SPLIT_DIRECTIVE[firstReading.axis],
    });
  }
  return combinations;
}

const ALIGNED_DIRECTIVE: Readonly<Record<WeddingCodeV06AxisKey, string>> = {
  decisionCriteria:
    "두 사람이 먼저 보는 기준이 같아요. 이 순서로 확인하면 대화가 빨라져요.",
  preparationMode:
    "준비를 나누는 방식이 같아요. 남은 일 목록에 그 방식대로 담당을 적어두면 돼요.",
  coordinationScope:
    "가족·하객을 넣는 범위가 같아요. 양가에 전할 말을 한 번에 정리해도 어긋나지 않아요.",
  supportOrder:
    "힘들 때 필요한 것이 같아요. 서로에게 기대하는 첫 반응이 어긋날 일이 적어요.",
};

const SPLIT_DIRECTIVE: Readonly<Record<WeddingCodeV06AxisKey, string>> = {
  decisionCriteria:
    "먼저 보는 기준이 서로 달라요. 어느 쪽이 옳은 게 아니라, 결정 하나마다 무엇을 먼저 볼지 시작할 때 정하면 돼요.",
  preparationMode:
    "준비를 나누는 방식이 서로 달라요. 함께 볼 일과 맡길 일을 목록에 나눠 적는 것이 먼저예요.",
  coordinationScope:
    "가족을 넣는 범위가 서로 달라요. 둘이 정할 범위와 양가에 물을 범위를 먼저 나눠 적어야 양가에 전하는 말이 어긋나지 않아요.",
  supportOrder:
    "힘들 때 필요한 것이 서로 달라요. 상대에게 필요한 첫 반응이 나와 다르므로, 말을 꺼낼 때 무엇이 필요한지 먼저 알려주면 돼요.",
};
