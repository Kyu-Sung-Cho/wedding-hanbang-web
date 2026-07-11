import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

export const WEDDING_CODE_V05_VERSION = "v0.5-candidate.9";
// Copy/form revisions may change without changing the weight map. Keep the
// scoring contract separate so stored answers are never evaluated under an
// unrecorded algorithm revision.
export const WEDDING_CODE_V05_SCORING_VERSION = "v0.5-scoring.1";
export const WEDDING_CODE_V05_COMPATIBLE_VERSIONS = [
  WEDDING_CODE_V05_VERSION,
  "v0.5-candidate.8",
  "v0.5-candidate.7",
  "v0.5-candidate.6",
  "v0.5-candidate.5",
  "v0.5-candidate.4",
  "v0.5-candidate.3",
  "v0.5-candidate.2",
  "v0.5-candidate.1",
] as const;

export type WeddingCodeV05QuestionKey =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "D1"
  | "D2"
  | "D3"
  | "D4";

export type WeddingCodeV05OptionValue = "A" | "B" | "C" | "D";

export interface WeddingCodeV05Weight {
  construct: WeddingCodeConstructKey;
  value: 1 | 2;
}

export interface WeddingCodeV05Option {
  value: WeddingCodeV05OptionValue;
  label: string;
  weights: readonly WeddingCodeV05Weight[];
}

export interface WeddingCodeV05Question {
  key: WeddingCodeV05QuestionKey;
  title: string;
  question: string;
  options: readonly WeddingCodeV05Option[];
  sourceReview: string;
  status: "candidate_pending_human_validation";
}

export interface WeddingCodeV05AxisSide {
  labelKo: string;
  constructs: readonly WeddingCodeConstructKey[];
}

export interface WeddingCodeV05PublicAxis {
  key: "decisionCriteria" | "preparationMode" | "coordinationScope" | "supportOrder";
  labelKo: string;
  left: WeddingCodeV05AxisSide;
  right: WeddingCodeV05AxisSide;
}

export const WEDDING_CODE_V05_NON_PUBLIC_CONSTRUCTS = [
  "decisionPaceRisk",
  "guidanceNeed",
] as const satisfies readonly WeddingCodeConstructKey[];

export const WEDDING_CODE_V05_EXPOSURE_MAX = {
  aestheticMood: 6,
  coupleAutonomy: 10,
  coPreparation: 19,
  costRisk: 11,
  decisionPaceRisk: 4,
  evidenceDecision: 14,
  executionSupport: 7,
  experienceMeaning: 9,
  emotionalSupport: 7,
  familyIntegration: 10,
  guidanceNeed: 3,
  roleOwnership: 12,
} as const satisfies Record<WeddingCodeConstructKey, number>;

export const WEDDING_CODE_V05_PUBLIC_AXES = [
  {
    key: "decisionCriteria",
    labelKo: "결정 기준",
    left: { labelKo: "조건 확인", constructs: ["costRisk", "evidenceDecision"] },
    right: { labelKo: "의미 상상", constructs: ["experienceMeaning", "aestheticMood"] },
  },
  {
    key: "preparationMode",
    labelKo: "준비 방식",
    left: { labelKo: "같이 맞춤", constructs: ["coPreparation"] },
    right: { labelKo: "맡아 정리", constructs: ["roleOwnership"] },
  },
  {
    key: "coordinationScope",
    labelKo: "조율 범위",
    left: { labelKo: "둘의 뜻", constructs: ["coupleAutonomy"] },
    right: { labelKo: "가족·초대 손님", constructs: ["familyIntegration"] },
  },
  {
    key: "supportOrder",
    labelKo: "지원 순서",
    left: { labelKo: "마음 먼저", constructs: ["emotionalSupport"] },
    right: { labelKo: "할 일 먼저", constructs: ["executionSupport"] },
  },
] as const satisfies readonly WeddingCodeV05PublicAxis[];

export const WEDDING_CODE_V05_QUESTIONS = [
  {
    key: "A1",
    title: "사진·드레스·메이크업 상담",
    question: "사진 촬영, 드레스, 메이크업을 한 곳에서 같이 준비하려고 상담받고 있어요. 제일 먼저 물어보고 싶은 것은?",
    sourceReview: "27_item_review_A1_quote_addons_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "우리가 쓸 수 있는 돈 안에서 가능한지", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "예시로 보여준 사진, 드레스, 메이크업이 마음에 드는지", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "처음 안내받은 가격에 들어 있는 것과 따로 내야 하는 돈", weights: [{ construct: "coPreparation", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "이곳을 이용한 사람들의 후기가 괜찮은지", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "guidanceNeed", value: 1 }] },
    ],
  },
  {
    key: "A2",
    title: "결혼식 영상·앨범 추가",
    question: "결혼식 영상을 찍거나 앨범을 더 만들면 돈이 더 들어요. 제일 먼저 어떤 생각이 드나요?",
    sourceReview: "28_item_review_A2_memory_option_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "나중에 다시 봤을 때 잘 선택했다고 느낄지", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "B", label: "추가로 내는 돈이 부담되지 않을지", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "더 적은 돈으로 필요한 장면만 남길 방법이 있는지", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "aestheticMood", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "우리 둘 다 나중에 보고 싶어 할 장면인지", weights: [{ construct: "coPreparation", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "A3",
    title: "예산보다 300만 원 더 드는 결혼식장",
    question: "마음에 드는 결혼식장이 처음 잡은 예산보다 300만 원 더 비싸요. 계속 볼지 정할 때 제일 중요한 것은?",
    sourceReview: "29_item_review_A3_venue_budget_gap_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "식사 비용까지 더한 최종 금액", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "이 결혼식장을 왜 마음에 들어 하는지", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "C", label: "초대할 사람들이 오기 쉽고 음식이 괜찮은지", weights: [{ construct: "familyIntegration", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "우리 둘 다 300만 원을 더 써도 괜찮은지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "costRisk", value: 1 }] },
    ],
  },
  {
    key: "A4",
    title: "사진은 좋은데 후기가 적음",
    question: "사진 촬영 업체의 예시 사진은 마음에 드는데, 이용한 사람들의 후기가 많지 않아요. 제일 먼저 확인하고 싶은 것은?",
    sourceReview: "30_item_review_A4_low_review_vendor_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "최근에 실제로 찍은 사진을 더 볼 수 있는지", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "B", label: "예시 사진이 우리가 좋아하는 사진과 가까운지", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "후기가 더 많은 다른 곳도 비교해볼지", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "evidenceDecision", value: 1 }, { construct: "aestheticMood", value: 1 }] },
      { value: "D", label: "후기가 적어도 둘 다 이곳이 괜찮다고 느끼는지", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "B1",
    title: "나만 먼저 마음에 든 곳",
    question: "마음에 드는 결혼 준비 업체나 결혼식 장소를 찾았어요. 그런데 상대는 아직 자세히 못 봤어요. 어떻게 공유하는 게 편한가요?",
    sourceReview: "32_item_review_B1_partner_unseen_place_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "같이 볼 시간을 먼저 잡는다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "좋았던 점과 아쉬운 점만 짧게 정리해서 보낸다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "가격, 위치, 사진처럼 같이 확인할 항목을 정한다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "내가 왜 마음에 들었는지 말하고 상대 생각을 듣는다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "B2",
    title: "준비가 한쪽에게 쏠릴 때",
    question: "요즘 둘 중 한 사람이 결혼 준비를 더 많이 하고 있는 것 같아요. 지금 가장 먼저 필요한 것은?",
    sourceReview: "33_item_review_B2_lopsided_preparation_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "지금까지 알아본 내용을 서로 공유한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "같이 정할 일과 각자 맡을 일을 나눈다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "roleOwnership", value: 1 }] },
      { value: "C", label: "누가 무엇을 언제까지 할지 다시 정한다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "어느 부분이 가장 힘들었는지 먼저 들어본다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "emotionalSupport", value: 1 }] },
    ],
  },
  {
    key: "B3",
    title: "중요하게 보는 점이 다를 때",
    question: "결혼 준비 업체나 장소를 고르는데, 두 사람이 중요하게 보는 점이 달라요. 어떤 방식이 편한가요?",
    sourceReview: "34_item_review_B3_different_lenses_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "가격·위치·사진처럼 각자 잘 보는 항목을 나눠 맡는다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "마지막으로 고를 곳은 둘이 같이 본다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "많이 알아본 사람이 먼저 2~3곳만 추려서 공유한다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "가격, 위치, 마음에 드는 점을 표에 적어 비교한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "B4",
    title: "볼 곳이 너무 많을 때",
    question: "알아볼 결혼 준비 업체나 장소가 너무 많아져서 고르기 어려워졌어요. 다음에 할 일로 가장 편한 것은?",
    sourceReview: "35_item_review_B4_candidate_overload_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "예산이나 위치가 안 맞는 곳부터 뺀다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "한 사람이 먼저 2~3곳만 추려서 공유한다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 가장 마음에 드는 곳 하나씩 골라온다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "오늘은 새로운 곳을 더 찾지 않고 쉰다", weights: [{ construct: "decisionPaceRisk", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C1",
    title: "부모님이 음식과 오는 길을 걱정할 때",
    question: "우리는 결혼식장이 마음에 드는데, 부모님은 음식과 오는 길을 걱정하세요. 제일 먼저 확인할 것은?",
    sourceReview: "36_item_review_C1_parent_guest_criteria_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "음식과 오는 길 중 무엇을 더 걱정하시는지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "우리가 이 장소를 좋아하는 이유", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }] },
      { value: "C", label: "식사 비용, 이동 시간, 주차 같은 실제 조건", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "장소는 유지하면서 바꿀 수 있는 시간대나 메뉴", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C2",
    title: "부모님께 처음 말할 때",
    question: "부모님께 우리가 원하는 결혼식 이야기를 처음 하려고 해요. 말하기 전에 제일 먼저 준비할 것은?",
    sourceReview: "37_item_review_C2_parent_direction_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 먼저 정해두고 싶은 한 가지", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "예산, 인원, 날짜처럼 이미 정한 내용", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "부모님이 궁금해하실 내용", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "대화를 시작할 첫 문장과 말할 순서", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C3",
    title: "전통 행사나 가족 선물을 간단히 하고 싶을 때",
    question: "결혼식 전후에 하는 전통 행사나 가족끼리 주고받는 선물을 간단히 하고 싶어요. 말하기 전에 제일 먼저 정리할 것은?",
    sourceReview: "38_item_review_C3_simplify_ceremony_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "간단히 하고 싶은 이유", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "가족이 중요하게 생각하는 부분이 있는지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "어떤 건 그대로 하고, 어떤 건 간단히 바꿀지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
      { value: "D", label: "간단히 하면 시간과 비용이 얼마나 달라지는지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C4",
    title: "초대 인원과 식장 예약 인원",
    question: "결혼식에 몇 명을 초대할지, 결혼식장에 최소 몇 명분을 예약해야 하는지 정해야 해요. 제일 먼저 확인할 것은?",
    sourceReview: "39_item_review_C4_guest_count_guarantee_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "실제로 올 것 같은 사람 수와 식장에 예약해야 하는 최소 인원의 차이", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "두 집안에서 먼저 챙기고 싶어 하는 사람들", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 감당할 수 있는 돈과 사람 수", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "친척, 친구, 직장 동료 중 어디까지 초대할지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "D1",
    title: "걱정을 말했는데 방법부터 나올 때",
    question: "걱정된다고 말했는데, 상대가 도와주려고 바로 해결 방법부터 말했어요. 그 순간 더 필요한 것은?",
    sourceReview: "40_item_review_D1_solution_first_support_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "왜 걱정되는지 먼저 들어주는 시간", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "짧게 공감한 뒤 같이 정리하는 시간", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "다음에 할 일을 바로 정하는 것", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "다음에는 먼저 들어주면 좋은지, 바로 정리하면 좋은지 말하는 시간", weights: [{ construct: "coPreparation", value: 1 }] },
    ],
  },
  {
    key: "D2",
    title: "준비 얘기만 하면 피곤할 때",
    question: "결혼 준비 이야기만 하면 둘 다 금방 지쳐요. 다시 이야기한다면 제일 먼저 할 일은?",
    sourceReview: "41_item_review_D2_tired_planning_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "오늘은 멈추고 다시 이야기할 시간만 정한다", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }] },
      { value: "B", label: "각자 무엇 때문에 지쳤는지 한 번씩 말한다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "오늘 정할 주제 하나만 고른다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "남은 일을 작게 나눠서 각자 맡는다", weights: [{ construct: "executionSupport", value: 1 }, { construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "D3",
    title: "준비 속도가 다르게 느껴질 때",
    question: "결혼 준비 속도가 서로 다르게 느껴져요. 지금 맞춘다면 가장 먼저 할 일은?",
    sourceReview: "42_item_review_D3_different_pace_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "각자 어느 부분에서 막혔는지 먼저 들어본다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "오늘 정할 것 하나만 고른다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 바로 할 수 있는 일을 하나씩 맡는다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "급한 일과 나중에 해도 되는 일을 나눈다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "roleOwnership", value: 1 }] },
    ],
  },
  {
    key: "D4",
    title: "오늘 예약 혜택을 들었을 때",
    question: "상담에서 '오늘 예약을 확정하면 할인이나 서비스를 더 드릴게요'라는 말을 들었어요. 마음도 많이 움직였어요. 이때 필요한 것은?",
    sourceReview: "43_item_review_D4_same_day_benefit_decision_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "하루 지나도 같은 마음인지 볼 시간", weights: [{ construct: "decisionPaceRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "좋았던 점과 걱정되는 점을 둘이 적어볼 시간", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "총금액, 추가 비용, 취소 조건을 확인할 시간", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "오늘 예약해도 괜찮은 이유가 분명한지", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV05Question[];
