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
    question: "아모라와 같이 고를 때 뭐부터 보고 싶어요?",
    options: [
      { value: "recommend_first", label: "추천안 먼저", effect: "추천안 하나를 먼저 보고, 거기서 고쳐 나가요." },
      { value: "compare_first", label: "비교 먼저", effect: "고를 만한 안이 있으면 뭐가 다른지부터 나란히 봐요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "추천과 비교 중 뭐가 필요한지 애매할 때만 먼저 물어봐요." },
    ],
  },
  {
    field: "workMode", axis: "preparationMode",
    question: "할 일을 아모라가 제안할 때, 둘이 어떻게 준비하는 게 좋아요?",
    options: [
      { value: "together", label: "처음부터 함께", effect: "후보를 찾을 때부터 둘이 같이 보게 도와줘요." },
      { value: "owner_led", label: "담당자가 먼저", effect: "한 사람이 후보를 줄여 오면, 마지막엔 둘이 같이 정하게 도와줘요." },
      { value: "hybrid", label: "상황에 따라 섞기", effect: "되돌리기 어려운 일은 같이 정하고, 나머지는 나눠서 하자고 제안해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "누가 맡을지 정해야 할 때만, 같이 할지 나눠서 할지 먼저 물어봐요." },
    ],
  },
  {
    field: "familyOrder", axis: "coordinationScope",
    question: "가족 의견이 필요한 일은 누구 얘기부터 들을까요?",
    options: [
      { value: "couple_first", label: "우리 둘 기준 먼저", effect: "둘이 원하는 걸 먼저 정하고, 필요하면 그다음에 가족 의견을 들어요." },
      { value: "family_input_first", label: "의견부터 모으기", effect: "이 일에 걸린 가족이나 하객 사정부터 들어요." },
      { value: "case_by_case", label: "상황마다", effect: "누가 돈을 내는지, 누구 사정이 걸렸는지 보고 순서를 정해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "누구 의견이 필요한지 애매할 때만 먼저 물어봐요." },
    ],
  },
  {
    field: "supportOrder", axis: "supportOrder",
    question: "내가 힘들다고 말하면 아모라가 뭐부터 해 주면 좋을까요?",
    options: [
      { value: "listen_first", label: "마음 먼저", effect: "해결책보다 지금 상황을 먼저 들어요." },
      { value: "action_first", label: "할 일 먼저", effect: "지금 바로 할 수 있는 일 하나부터 같이 정해요." },
      { value: "ask_each_time", label: "그때 물어보기", effect: "들어 주길 바라는지, 같이 방법을 찾길 바라는지 먼저 물어봐요." },
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
        ? `함께 답한 ${sharedScenes.length}장면 중 ${different}곳에서 고른 답이 달랐어요. 왜 그 답을 골랐는지부터 서로 얘기해 보세요.`
        : `함께 답한 ${sharedScenes.length}장면에서 같은 답을 골랐어요. 고른 이유도 같은지, 지금도 그렇게 하고 싶은지는 서로 물어보세요.`,
    } satisfies WeddingCodeCoupleCombination];
  });
}
