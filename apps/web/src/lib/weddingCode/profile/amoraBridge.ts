import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import type { AmoraPersonalizationPreferences } from "@/lib/amora/personalization";
import type { WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import type { WeddingCodeV06GapMap } from "@/lib/weddingCode/v06/gap";

export const WEDDING_CODE_AMORA_BRIDGE_VERSION = "wedding-code-amora-confirmation-v2";

type PreferenceField = "decisionStart" | "workMode" | "familyOrder" | "supportOrder";
type ConfirmationQuestion = {
  [Field in PreferenceField]: Readonly<{
    field: Field;
    axis: WeddingCodeV06AxisKey;
    question: string;
    options: readonly Readonly<{
      value: AmoraPersonalizationPreferences[Field];
      label: string;
      effect: string;
    }>[];
  }>;
}[PreferenceField];
export type WeddingCodeAmoraProposal = ConfirmationQuestion & Readonly<{ basis: string }>;

// 장면의 선택은 과거 행동·받은 도움·상대에게 한 행동이 섞여 있다.
// 집계로 현재 원하는 설정을 정하지 않고, 미선택 상태의 직접 질문만 돌려준다.
const QUESTIONS: readonly ConfirmationQuestion[] = [
  {
    field: "decisionStart", axis: "decisionCriteria",
    question: "아모라와 결정할 때 무엇부터 보고 싶나요?",
    options: [
      { value: "recommend_first", label: "추천안 먼저", effect: "현실적인 안 하나를 먼저 보고 조정해요." },
      { value: "compare_first", label: "비교 먼저", effect: "선택지와 핵심 차이를 먼저 확인해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "원하는 방식이 불분명할 때 먼저 확인해요." },
    ],
  },
  {
    field: "workMode", axis: "preparationMode",
    question: "준비할 일을 어떤 구조로 제안받고 싶나요?",
    options: [
      { value: "together", label: "처음부터 함께", effect: "두 사람이 함께 확인할 지점을 포함해 제안해요." },
      { value: "owner_led", label: "담당자 중심", effect: "담당자가 좁힌 후보를 함께 최종 확인하는 구조를 제안해요." },
      { value: "hybrid", label: "섞어서", effect: "함께 결정할 일과 나눠 맡을 일을 구분해 제안해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "이번 일에 맞는 분담 방식을 먼저 물어요." },
    ],
  },
  {
    field: "familyOrder", axis: "coordinationScope",
    question: "가족 의견이 필요한 결정은 어떤 순서로 안내할까요?",
    options: [
      { value: "couple_first", label: "둘의 기준 먼저", effect: "둘의 기준을 정리한 뒤 필요한 가족 의견을 확인해요." },
      { value: "family_input_first", label: "관련된 사람 의견 먼저", effect: "영향을 받는 사람의 조건부터 확인하도록 제안해요." },
      { value: "case_by_case", label: "상황에 따라", effect: "이번 결정의 비용 부담과 제약에 맞춰 순서를 정리해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "이번에 어떤 순서가 필요한지 먼저 물어요." },
    ],
  },
  {
    field: "supportOrder", axis: "supportOrder",
    question: "내가 힘들다고 말하면 아모라가 무엇부터 해주면 좋을까요?",
    options: [
      { value: "listen_first", label: "마음 먼저", effect: "해결책보다 지금 상황을 먼저 들어요." },
      { value: "action_first", label: "실행 먼저", effect: "지금 할 수 있는 행동 하나부터 정리해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "듣기와 해결 중 필요한 도움을 먼저 확인해요." },
    ],
  },
];

export function buildWeddingCodeAmoraProposals(profile: WeddingCodeSelfProfile): readonly WeddingCodeAmoraProposal[] {
  return QUESTIONS.flatMap((question) => {
    const reading = profile.axes.find((item) => item.axis === question.axis);
    if (!reading || reading.answered === 0) return [];
    return [{ ...question, basis: `이 주제에서 ${reading.answered}장면에 답했어요. 장면 속 행동과 지금 원하는 도움은 다를 수 있어요.` }];
  });
}

export type WeddingCodeCoupleCombination = Readonly<{
  axis: WeddingCodeV06AxisKey;
  axisLabel: string;
  state: "same_answers" | "different";
  compared: number;
  identical: number;
  firstTitle: string;
  secondTitle: string;
  directive: string;
}>;

// 축별 합계가 같아도 서로 다른 장면을 답했거나 정반대 답이 상쇄됐을 수 있다.
// 비교는 반드시 둘 다 답한 동일 장면의 실제 선택으로만 한다.
export function buildWeddingCodeCoupleCombination(
  first: WeddingCodeSelfProfile,
  second: WeddingCodeSelfProfile,
  map: WeddingCodeV06GapMap,
): readonly WeddingCodeCoupleCombination[] {
  const all = [...map.identical, ...map.shared, ...map.splits];
  return first.axes.flatMap((reading) => {
    const other = second.axes.find((item) => item.axis === reading.axis);
    const sharedScenes = all.filter((item) => item.axis === reading.axis);
    if (!other || sharedScenes.length === 0) return [];
    const identical = sharedScenes.filter((item) => item.same).length;
    const different = sharedScenes.length - identical;
    return [{
      axis: reading.axis, axisLabel: reading.axisLabel,
      state: different > 0 ? "different" : "same_answers",
      compared: sharedScenes.length, identical,
      firstTitle: reading.title, secondTitle: other.title,
      directive: different > 0
        ? `함께 답한 ${sharedScenes.length}장면 중 ${different}곳에서 다른 문장을 골랐어요. 각자 그 답을 고른 이유부터 이야기해 보세요.`
        : `함께 답한 ${sharedScenes.length}장면에서 같은 문장을 골랐어요. 같은 답을 고른 이유와 지금도 원하는 방식인지는 서로 확인해 보세요.`,
    } satisfies WeddingCodeCoupleCombination];
  });
}
