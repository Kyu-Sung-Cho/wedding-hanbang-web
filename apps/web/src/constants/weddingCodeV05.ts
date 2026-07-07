import type { WeddingCodeConstructKey } from "@/lib/wedding-code/types";

export const WEDDING_CODE_V05_VERSION = "v0.5-candidate.1";

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
    left: { labelKo: "우리 기준", constructs: ["coupleAutonomy"] },
    right: { labelKo: "가족 조율", constructs: ["familyIntegration"] },
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
    question: "견적서를 받았는데, 금액도 항목도 사진 스타일도 한꺼번에 봐야 해요. 나는 먼저 -",
    sourceReview: "27_item_review_A1_quote_addons_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "포함된 것과 따로 낼 비용을 표시해본다", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "이 돈을 쓸 만큼 결과물이 마음에 드는지 본다", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "둘이 꼭 할 것과 줄일 것을 나눠본다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "비슷한 견적을 받은 사람들의 후기를 찾아본다", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "guidanceNeed", value: 1 }] },
    ],
  },
  {
    key: "A2",
    title: "오래 남을 옵션",
    question: "본식 영상이나 앨범처럼 나중에 다시 볼 것에 비용이 더 들어요. 나는 먼저 -",
    sourceReview: "28_item_review_A2_memory_option_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "시간이 지나도 우리에게 의미 있을지 생각한다", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "B", label: "전체 예산에서 감당되는 금액인지 본다", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "비슷하게 남길 다른 방법이 있는지 찾아본다", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "aestheticMood", value: 1 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "둘이 어떤 장면을 꼭 남기고 싶은지 얘기한다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "A3",
    title: "예산보다 300만 원 더 드는 예식장",
    question: "투어에서 마음에 든 예식장이 있는데, 우리가 생각한 예산보다 300만 원 정도 더 들어요. 나는 먼저 -",
    sourceReview: "29_item_review_A3_venue_budget_gap_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "보증인원·식대·대관료까지 총액을 다시 계산한다", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "이곳에서 하고 싶은 결혼식이 선명하게 그려지는지 본다", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "aestheticMood", value: 1 }] },
      { value: "C", label: "가족과 하객의 식사·교통·동선까지 같이 본다", weights: [{ construct: "familyIntegration", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "둘이 예산선과 포기 못할 기준을 다시 맞춘다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "costRisk", value: 1 }] },
    ],
  },
  {
    key: "A4",
    title: "포트폴리오는 좋은데 후기가 적음",
    question: "스튜디오 포트폴리오는 우리 취향인데, 실제 이용 후기가 많지 않아요. 나는 먼저 -",
    sourceReview: "30_item_review_A4_low_review_vendor_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "최근 실제 촬영본과 포함 조건을 더 확인한다", weights: [{ construct: "evidenceDecision", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "B", label: "우리가 원하는 색감·분위기와 얼마나 맞는지 다시 본다", weights: [{ construct: "aestheticMood", value: 2 }, { construct: "experienceMeaning", value: 1 }] },
      { value: "C", label: "비슷한 무드에 후기가 더 있는 곳도 같이 본다", weights: [{ construct: "guidanceNeed", value: 1 }, { construct: "evidenceDecision", value: 1 }, { construct: "aestheticMood", value: 1 }] },
      { value: "D", label: "후기 부족을 어디까지 감수할지 둘이 기준을 정한다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
  {
    key: "B1",
    title: "나만 먼저 마음에 든 곳",
    question: "마음에 드는 곳을 하나 찾았는데, 상대는 아직 자세히 볼 시간이 없었어요. 나는 먼저 -",
    sourceReview: "32_item_review_B1_partner_unseen_place_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "같이 볼 시간을 잡고 처음 느낌부터 맞춰본다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "B", label: "좋았던 점과 걸리는 점을 짧게 정리해 공유한다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "둘이 볼 기준을 몇 가지 정한 뒤 다시 본다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "왜 끌렸는지 먼저 말하고 상대 느낌을 들어본다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "experienceMeaning", value: 1 }] },
    ],
  },
  {
    key: "B2",
    title: "준비가 한쪽에게 쏠릴 때",
    question: "준비가 어느새 한쪽으로 조금 몰린 것 같아요. 우리는 먼저 -",
    sourceReview: "33_item_review_B2_lopsided_preparation_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "지금까지 본 것 중 중요한 것만 짧게 공유한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "같이 볼 결정과 맡아서 볼 일을 구분한다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "roleOwnership", value: 1 }] },
      { value: "C", label: "각자 맡을 범위와 마감을 다시 나눈다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "어디가 제일 부담됐는지 먼저 얘기한다", weights: [{ construct: "coPreparation", value: 1 }, { construct: "emotionalSupport", value: 1 }] },
    ],
  },
  {
    key: "B3",
    title: "서로 보는 기준이 다를 때",
    question: "후보를 비교하다 보니, 둘이 먼저 눈에 들어오는 기준이 조금 달라요. 우리라면 -",
    sourceReview: "34_item_review_B3_different_lenses_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "각자 먼저 보는 부분을 맡고 결과를 공유한다", weights: [{ construct: "roleOwnership", value: 2 }] },
      { value: "B", label: "중요한 후보는 둘이 같이 보며 기준을 맞춘다", weights: [{ construct: "coPreparation", value: 2 }] },
      { value: "C", label: "한 명이 후보를 줄이고 마지막은 함께 정한다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "서로 본 내용을 한 표에 모아 비교한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "B4",
    title: "후보가 너무 많을 때",
    question: "후보가 계속 늘어나서 선택이 더 어려워졌어요. 우리는 먼저 -",
    sourceReview: "35_item_review_B4_candidate_overload_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 먼저 뺄 기준을 정하고 후보를 줄인다", weights: [{ construct: "coPreparation", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "한 사람이 먼저 2~3개로 줄여서 함께 본다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 남길 후보를 하나씩 골라와 같이 비교한다", weights: [{ construct: "roleOwnership", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "오늘은 새 후보를 더 보지 않고 남은 것만 정리한다", weights: [{ construct: "decisionPaceRisk", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C1",
    title: "부모님은 음식과 교통을 볼 때",
    question: "예식장은 분위기가 마음에 드는데, 부모님은 음식과 교통도 중요하게 보세요. 나는 먼저 -",
    sourceReview: "36_item_review_C1_parent_guest_criteria_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "부모님이 중요하게 보는 점을 먼저 들어본다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "B", label: "우리 기준과 부모님 기준을 나란히 적어본다", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }] },
      { value: "C", label: "식대, 이동, 보증인원까지 실제 차이를 확인한다", weights: [{ construct: "familyIntegration", value: 1 }, { construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "원하는 분위기를 지키면서 조정할 기준을 정리한다", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C2",
    title: "우리 기준을 말해야 할 때",
    question: "부모님께 결혼식 방향을 처음 이야기하려고 해요. 나는 먼저 -",
    sourceReview: "37_item_review_C2_parent_direction_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 꼭 지키고 싶은 기준을 먼저 맞춘다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "예산, 인원, 일정처럼 확인된 내용을 정리한다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "C", label: "부모님이 궁금해하실 부분을 미리 생각한다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "D", label: "편하게 대화를 시작할 순서와 첫마디를 준비한다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
    ],
  },
  {
    key: "C3",
    title: "전통 절차를 줄이고 싶을 때",
    question: "예식 절차 중 몇 가지는 우리 상황에 맞게 간소화하고 싶어요. 나는 먼저 -",
    sourceReview: "38_item_review_C3_simplify_ceremony_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 왜 간소화하려는지 먼저 맞춘다", weights: [{ construct: "coupleAutonomy", value: 2 }] },
      { value: "B", label: "가족이 중요하게 여기실 절차가 있는지 들어본다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "그대로 할 것과 간소화할 것을 나눠본다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }] },
      { value: "D", label: "간소화했을 때 달라지는 점을 차분히 정리한다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "C4",
    title: "하객 수와 보증인원",
    question: "하객 수와 보증인원을 정해야 해서, 양가가 생각하는 초대 범위도 같이 봐야 해요. 나는 먼저 -",
    sourceReview: "39_item_review_C4_guest_count_guarantee_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "예상 참석 인원과 보증인원 차이를 먼저 계산한다", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "양가가 꼭 초대하고 싶은 범위와 이유를 들어본다", weights: [{ construct: "familyIntegration", value: 2 }] },
      { value: "C", label: "우리가 무리 없이 감당할 예산과 인원선을 맞춘다", weights: [{ construct: "coupleAutonomy", value: 2 }, { construct: "costRisk", value: 1 }] },
      { value: "D", label: "같은 기준으로 이야기할 초대 원칙을 정리한다", weights: [{ construct: "coupleAutonomy", value: 1 }, { construct: "familyIntegration", value: 1 }, { construct: "evidenceDecision", value: 1 }] },
    ],
  },
  {
    key: "D1",
    title: "걱정을 말했는데 방법부터 나올 때",
    question: "걱정된다고 말했는데, 상대가 바로 방법을 찾아주려 했어요. 그 순간 나에게 필요한 건 -",
    sourceReview: "40_item_review_D1_solution_first_support_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "왜 걱정되는지 잠깐 들어주는 것", weights: [{ construct: "emotionalSupport", value: 2 }] },
      { value: "B", label: "한마디로 알아주고, 그다음 같이 정리하는 것", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "다음에 뭘 하면 될지 바로 잡아주는 것", weights: [{ construct: "executionSupport", value: 2 }] },
      { value: "D", label: "다음엔 어떤 반응이 편한지 말해둘 시간", weights: [{ construct: "coPreparation", value: 1 }] },
    ],
  },
  {
    key: "D2",
    title: "준비 얘기만 하면 피곤할 때",
    question: "결혼 준비 얘기를 꺼내면 둘 다 금방 지쳐요. 다시 얘기한다면 우리는 먼저 -",
    sourceReview: "41_item_review_D2_tired_planning_talk_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "오늘은 여기서 멈추고, 다시 볼 시간만 정한다", weights: [{ construct: "emotionalSupport", value: 1 }, { construct: "executionSupport", value: 1 }] },
      { value: "B", label: "각자 어디서 지쳤는지 한 번씩만 말한다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "오늘 정할 한 가지 주제만 골라 짧게 얘기한다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "D", label: "남은 일을 작은 묶음으로 나눠 맡을 것부터 정한다", weights: [{ construct: "executionSupport", value: 1 }, { construct: "roleOwnership", value: 2 }] },
    ],
  },
  {
    key: "D3",
    title: "준비 속도가 다르게 느껴질 때",
    question: "결혼 준비 속도가 서로 다르게 느껴져요. 지금 맞춘다면 우리는 먼저 -",
    sourceReview: "42_item_review_D3_different_pace_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "어디서 막히는지 가볍게 들어본다", weights: [{ construct: "emotionalSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "B", label: "오늘 꼭 정할 한 가지만 같이 고른다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "coPreparation", value: 1 }] },
      { value: "C", label: "각자 바로 할 수 있는 것부터 작게 나눈다", weights: [{ construct: "roleOwnership", value: 2 }, { construct: "executionSupport", value: 1 }] },
      { value: "D", label: "급한 일과 조금 기다려도 되는 일을 나눠본다", weights: [{ construct: "executionSupport", value: 2 }, { construct: "roleOwnership", value: 1 }] },
    ],
  },
  {
    key: "D4",
    title: "당일 혜택이 있는 상담 후 결정",
    question: "상담에서 오늘 계약하면 혜택이 있다고 하고, 마음도 크게 움직였어요. 이럴 때 나에게 필요한 건 -",
    sourceReview: "43_item_review_D4_same_day_benefit_decision_v0.1.md",
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "하루 지나도 같은 마음인지 볼 여유", weights: [{ construct: "decisionPaceRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "B", label: "좋았던 점과 걸리는 점을 둘이 적어볼 시간", weights: [{ construct: "coPreparation", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
      { value: "C", label: "총액·추가금·취소 조건을 확인할 시간", weights: [{ construct: "costRisk", value: 2 }, { construct: "evidenceDecision", value: 1 }] },
      { value: "D", label: "마음이 선명할 때 놓치지 않는 결정", weights: [{ construct: "experienceMeaning", value: 2 }, { construct: "decisionPaceRisk", value: 1 }] },
    ],
  },
] as const satisfies readonly WeddingCodeV05Question[];
