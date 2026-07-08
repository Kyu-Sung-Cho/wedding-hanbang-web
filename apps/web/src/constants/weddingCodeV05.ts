import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

export const WEDDING_CODE_V05_VERSION = "v0.5-candidate.4";
export const WEDDING_CODE_V05_COMPATIBLE_VERSIONS = [
  WEDDING_CODE_V05_VERSION,
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
    right: { labelKo: "가족·하객", constructs: ["familyIntegration"] },
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
    title: "견적서 추가금",
    question: "스드메(스튜디오, 드레스, 메이크업) 견적서를 처음 받았다면 제일 먼저 확인할 것은?",
    sourceReview: "27_item_review_A1_quote_addons_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "예산 안에서 가능한 금액인지", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "사진 분위기가 우리 취향과 맞는지", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "드레스, 메이크업, 원본 사진 같은 항목이 포함되는지", weights: [{ construct: "coPreparation", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "실제로 진행한 사람들의 후기가 좋은지", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "guidanceNeed", value: 1 }] },
    ],
  },
  {
    key: "A2",
    title: "오래 남을 옵션",
    question: "본식 영상이나 앨범 옵션을 추가하면 비용이 더 들어요. 이때 가장 먼저 드는 생각은?",
    sourceReview: "28_item_review_A2_memory_option_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "나중에 다시 봐도 의미 있을까", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "B", label: "추가 비용이 부담되지는 않을까", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "비슷하게 남길 다른 방법은 없을까", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "aestheticMood", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "우리 둘 다 원하는 장면일까", weights: [{ construct: "coPreparation", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "A3",
    title: "예산보다 300만 원 더 드는 예식장",
    question: "마음에 든 예식장이 생각한 예산보다 300만 원 더 비싸요. 그래도 알아볼지 정할 때 제일 중요한 것은?",
    sourceReview: "29_item_review_A3_venue_budget_gap_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "식대까지 넣은 전체 금액", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "왜 이 예식장이 마음에 드는지", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "C", label: "하객이 오기 편하고 식사가 괜찮은지", weights: [{ construct: "familyIntegration", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "둘 다 이 금액을 감수할 마음이 있는지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "costRisk", value: 1 }] },
    ],
  },
  {
    key: "A4",
    title: "포트폴리오는 좋은데 후기가 적음",
    question: "스튜디오 사진은 마음에 드는데, 실제 후기가 많지 않아요. 가장 먼저 확인하고 싶은 것은?",
    sourceReview: "30_item_review_A4_low_review_vendor_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "최근에 찍은 실제 사진을 더 볼 수 있는지", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "B", label: "우리 취향과 얼마나 잘 맞는지", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "비슷한 느낌에 후기가 더 많은 곳이 있는지", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "evidenceDecision", value: 1 }, { construct: "aestheticMood", value: 1 }] },
      { value: "D", label: "후기가 적어도 선택해도 괜찮을지 둘이 동의하는지", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "B1",
    title: "나만 먼저 마음에 든 곳",
    question: "마음에 드는 업체나 장소를 찾았는데, 상대는 아직 자세히 못 봤어요. 어떻게 공유하는 게 편한가요?",
    sourceReview: "32_item_review_B1_partner_unseen_place_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "같이 볼 시간을 잡는다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "좋은 점과 걸리는 점을 짧게 정리해 보낸다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "가격, 위치, 사진처럼 같이 볼 항목을 정한다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "왜 마음에 들었는지 말하고 상대 느낌을 듣는다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "B2",
    title: "준비가 한쪽에게 쏠릴 때",
    question: "결혼 준비가 한쪽에게 몰린 것 같아요. 지금 가장 먼저 필요한 것은?",
    sourceReview: "33_item_review_B2_lopsided_preparation_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "지금까지 본 내용을 간단히 공유하는 것", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "같이 결정할 일과 각자 맡을 일을 나누는 것", weights: [{ construct: "coPreparation", value: 2 }, { construct: "roleOwnership", value: 1 }] },
      { value: "C", label: "누가 언제까지 할지 다시 정하는 것", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "어디가 제일 부담됐는지 먼저 듣는 것", weights: [{ construct: "coPreparation", value: 1 }, { construct: "emotionalSupport", value: 1 }] },
    ],
  },
  {
    key: "B3",
    title: "중요하게 보는 점이 다를 때",
    question: "업체나 장소를 비교하는데 둘이 중요하게 보는 점이 달라요. 어떤 방식이 편한가요?",
    sourceReview: "34_item_review_B3_different_lenses_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "각자 잘 보는 부분을 맡아본다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "중요한 곳은 둘이 같이 본다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "자료를 많이 본 사람이 2~3곳으로 좁혀온다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "가격, 위치, 분위기를 한 표에 적어 비교한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "B4",
    title: "업체나 장소가 너무 많을 때",
    question: "업체나 장소가 너무 많아 고르기 어려워졌어요. 다음에 할 일로 가장 편한 것은?",
    sourceReview: "35_item_review_B4_candidate_overload_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "예산이나 위치가 안 맞는 곳부터 제외한다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "한 사람이 먼저 2~3곳으로 좁혀온다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 가장 괜찮은 곳 하나씩 골라온다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "오늘은 새로운 곳을 더 보지 않는다", weights: [{ construct: "decisionPaceRisk", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C1",
    title: "부모님은 음식과 교통을 볼 때",
    question: "우리는 예식장 분위기가 마음에 드는데, 부모님은 음식과 교통을 걱정하세요. 제일 먼저 확인할 것은?",
    sourceReview: "36_item_review_C1_parent_guest_criteria_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "음식과 교통 중 무엇을 더 걱정하시는지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "우리가 이 분위기를 좋아하는 이유", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }] },
      { value: "C", label: "식대, 이동 시간, 보증인원 숫자", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "분위기는 지키고 바꿀 수 있는 시간대나 메뉴", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C2",
    title: "부모님께 처음 말할 때",
    question: "부모님께 우리가 원하는 결혼식을 처음 이야기하려고 해요. 말하기 전에 제일 먼저 준비할 것은?",
    sourceReview: "37_item_review_C2_parent_direction_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 양보하기 어려운 한 가지", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "예산, 인원, 일정처럼 이미 정한 내용", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "부모님이 궁금해하실 내용", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "대화를 시작할 첫마디와 순서", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C3",
    title: "전통 절차를 줄이고 싶을 때",
    question: "폐백, 주례, 예물처럼 예식 절차 몇 가지를 간단히 하고 싶어요. 이야기하기 전에 제일 먼저 정리할 것은?",
    sourceReview: "38_item_review_C3_simplify_ceremony_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "왜 간단히 하고 싶은지", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "가족이 중요하게 생각할 절차가 있는지", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "그대로 할 절차와 간단히 할 절차", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
      { value: "D", label: "간단히 하면 무엇이 달라지는지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C4",
    title: "하객 수와 보증인원",
    question: "하객 수와 보증인원(식장에서 최소로 계산하는 인원)을 정해야 해요. 가장 먼저 확인할 것은?",
    sourceReview: "39_item_review_C4_guest_count_guarantee_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "실제로 올 사람과 보증인원의 차이", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "양가가 꼭 초대하고 싶은 사람들", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 감당할 수 있는 예산과 인원", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "친척, 친구, 직장 중 어디까지 초대할지", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "D1",
    title: "걱정을 말했는데 방법부터 나올 때",
    question: "걱정된다고 말했는데, 상대가 바로 해결 방법부터 말했어요. 그 순간 더 필요한 것은?",
    sourceReview: "40_item_review_D1_solution_first_support_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "왜 걱정되는지 들어주는 시간", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "한마디 공감한 뒤 같이 정리하는 시간", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "다음에 할 일을 바로 잡아주는 것", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "다음엔 어떤 반응이 편한지 말하는 시간", weights: [{ construct: "coPreparation", value: 1 }] },
    ],
  },
  {
    key: "D2",
    title: "준비 얘기만 하면 피곤할 때",
    question: "결혼 준비 얘기만 하면 둘 다 금방 지쳐요. 다시 이야기한다면 가장 먼저 할 일은?",
    sourceReview: "41_item_review_D2_tired_planning_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "오늘은 멈추고 다시 볼 시간만 정한다", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }] },
      { value: "B", label: "각자 어디서 지쳤는지 한 번씩 말한다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "오늘 정할 주제 하나만 고른다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "남은 일을 작게 나눠 맡을 것을 정한다", weights: [{ construct: "executionSupport", value: 1 }, { construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "D3",
    title: "준비 속도가 다르게 느껴질 때",
    question: "결혼 준비 속도가 서로 다르게 느껴져요. 지금 맞춘다면 가장 먼저 할 일은?",
    sourceReview: "42_item_review_D3_different_pace_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "어디서 막히는지 가볍게 듣는다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "오늘 꼭 정할 한 가지만 고른다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 바로 할 수 있는 것부터 나눈다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "급한 일과 기다려도 되는 일을 나눈다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "roleOwnership", value: 1 }] },
    ],
  },
  {
    key: "D4",
    title: "당일 혜택이 있는 상담 후 결정",
    question: "상담에서 오늘 계약하면 혜택이 있다고 해요. 마음도 크게 움직였어요. 이때 필요한 것은?",
    sourceReview: "43_item_review_D4_same_day_benefit_decision_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "하루 지나도 같은 마음인지 볼 시간", weights: [{ construct: "decisionPaceRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "좋았던 점과 걸리는 점을 둘이 적어볼 시간", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "총액, 추가금, 취소 조건을 확인할 시간", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "오늘 결정해도 후회 없다는 확신", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV05Question[];
