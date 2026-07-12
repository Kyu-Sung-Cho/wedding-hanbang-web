export const WEDDING_CODE_V05_VERSION = "v0.5-candidate.10";
// candidate.10 replaces the former multi-construct weight map with four
// independently scored, scenario-level priority axes. Historical answers must
// never be reinterpreted under this contract.
export const WEDDING_CODE_V05_SCORING_VERSION = "v0.5-scoring.2";
export const WEDDING_CODE_V05_COMPATIBLE_VERSIONS = [WEDDING_CODE_V05_VERSION] as const;

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

export type WeddingCodeV05OptionValue = "A" | "B";
export type WeddingCodeV05AxisKey =
  | "decisionCriteria"
  | "preparationMode"
  | "coordinationScope"
  | "supportOrder";
export type WeddingCodeV05AxisSide = "left" | "right";

export type WeddingCodeV05EvidenceRef =
  | "TEST_DEVELOPMENT_METHOD"
  | "KCA_WEDDING_MARKET"
  | "COUPLE_DECISION_RESEARCH"
  | "KOREAN_WEDDING_DECISION_RESEARCH"
  | "DYADIC_COPING_RESEARCH"
  | "PRODUCT_HYPOTHESIS";

export interface WeddingCodeV05Option {
  value: WeddingCodeV05OptionValue;
  label: string;
  side: WeddingCodeV05AxisSide;
}

export interface WeddingCodeV05Question {
  key: WeddingCodeV05QuestionKey;
  axis: WeddingCodeV05AxisKey;
  title: string;
  question: string;
  options: readonly WeddingCodeV05Option[];
  evidenceRefs: readonly WeddingCodeV05EvidenceRef[];
  sourceReview: string;
  status: "candidate_pending_human_validation";
}

export interface WeddingCodeV05PublicAxis {
  key: WeddingCodeV05AxisKey;
  labelKo: string;
  descriptionKo: string;
  left: { labelKo: string };
  right: { labelKo: string };
}

export const WEDDING_CODE_V05_PUBLIC_AXES = [
  {
    key: "decisionCriteria",
    labelKo: "결정 시작점",
    descriptionKo: "가상 장면에서 조건과 원하는 모습 중 무엇을 먼저 하고 싶다고 골랐는지 봅니다.",
    left: { labelKo: "조건 먼저" },
    right: { labelKo: "장면 먼저" },
  },
  {
    key: "preparationMode",
    labelKo: "준비 시작점",
    descriptionKo: "가상 장면에서 같이 기준을 맞추는 일과 담당을 정하는 일 중 무엇을 먼저 하고 싶다고 골랐는지 봅니다.",
    left: { labelKo: "같이 맞춤" },
    right: { labelKo: "맡아 정리" },
  },
  {
    key: "coordinationScope",
    labelKo: "조율 시작점",
    descriptionKo: "가상 장면에서 둘의 기준과 가족·초대 손님의 조건 중 무엇을 먼저 확인하고 싶다고 골랐는지 봅니다.",
    left: { labelKo: "둘의 기준 먼저" },
    right: { labelKo: "주변 조건 먼저" },
  },
  {
    key: "supportOrder",
    labelKo: "도움 시작점",
    descriptionKo: "가상 장면에서 마음을 듣는 일과 할 일을 정리하는 일 중 무엇을 먼저 원한다고 골랐는지 봅니다.",
    left: { labelKo: "마음 먼저" },
    right: { labelKo: "할 일 먼저" },
  },
] as const satisfies readonly WeddingCodeV05PublicAxis[];

const SOURCE_REVIEW = "63_candidate10_evidence_based_rebuild_2026-07-11.md";

// The order is intentionally interleaved across axes. Within every axis, two
// items show the left option first and two show the right option first so a
// repeated first-button preference cannot manufacture one result direction.
export const WEDDING_CODE_V05_QUESTIONS = [
  {
    key: "A1",
    axis: "decisionCriteria",
    title: "사진 업체 두 곳 중 마지막 선택",
    question: "사진 업체 두 곳이 모두 괜찮아 보여 마지막으로 하나를 고르려 해요. 먼저 비교할 쪽은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KCA_WEDDING_MARKET", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "포함 항목·총금액·취소 조건 같은 계약 조건", side: "left" },
      { value: "B", label: "예시 사진이 우리가 원하는 느낌에 가까운지", side: "right" },
    ],
  },
  {
    key: "B1",
    axis: "preparationMode",
    title: "나만 먼저 알아본 곳",
    question: "내가 마음에 드는 업체를 먼저 찾았고, 상대는 아직 자세히 못 봤어요. 다음으로 더 편한 방식은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "COUPLE_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "내가 핵심만 추려 보내고, 상대가 본 뒤 함께 최종 확인한다", side: "right" },
      { value: "B", label: "둘이 볼 시간을 잡고, 처음부터 함께 보며 기준을 맞춘다", side: "left" },
    ],
  },
  {
    key: "C1",
    axis: "coordinationScope",
    title: "가족이 오는 길을 걱정할 때",
    question: "우리는 식장이 마음에 드는데, 가족은 찾아오기 불편할까 걱정해요. 다시 이야기할 때 먼저 확인할 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KOREAN_WEDDING_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 포기하고 싶지 않은 기준", side: "left" },
      { value: "B", label: "가족이 어떤 이동 조건을 가장 걱정하는지", side: "right" },
    ],
  },
  {
    key: "D1",
    axis: "supportOrder",
    title: "걱정을 꺼냈을 때",
    question: "걱정된다고 말했을 때, 상대에게 먼저 받고 싶은 도움은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "DYADIC_COPING_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "지금 바꿀 수 있는 한 가지를 같이 찾는 것", side: "right" },
      { value: "B", label: "무엇이 걱정되는지 끊지 않고 들어주는 것", side: "left" },
    ],
  },
  {
    key: "A2",
    axis: "decisionCriteria",
    title: "결혼식 영상을 더할 때",
    question: "결혼식 영상 촬영을 더할지 고민돼요. 결정을 시작할 때 먼저 답하고 싶은 질문은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KCA_WEDDING_MARKET", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "몇 년 뒤에도 다시 보고 싶은 장면인가?", side: "right" },
      { value: "B", label: "전체 예산에서 얼마까지 쓸 수 있나?", side: "left" },
    ],
  },
  {
    key: "B2",
    axis: "preparationMode",
    title: "할 일이 한꺼번에 늘었을 때",
    question: "해야 할 일이 한꺼번에 늘었어요. 시작 방식으로 더 편한 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "COUPLE_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "같이 목록을 보고 우선순위를 먼저 맞춘다", side: "left" },
      { value: "B", label: "각자 맡을 묶음을 먼저 정하고 담당자가 진행한다", side: "right" },
    ],
  },
  {
    key: "C2",
    axis: "coordinationScope",
    title: "초대 인원을 정할 때",
    question: "초대 인원을 정하려 해요. 첫 숫자를 잡을 때 더 편한 방식은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KOREAN_WEDDING_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "두 집안이 초대하고 싶은 범위를 먼저 모은다", side: "right" },
      { value: "B", label: "둘이 감당할 예산과 원하는 규모를 먼저 정한다", side: "left" },
    ],
  },
  {
    key: "D2",
    axis: "supportOrder",
    title: "할 일이 쌓여 지쳤을 때",
    question: "해야 할 일이 쌓여 지쳤을 때, 상대가 먼저 해주면 도움이 되는 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "DYADIC_COPING_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "지금 얼마나 벅찬지 물어보고 잠깐 들어주는 것", side: "left" },
      { value: "B", label: "오늘 끝낼 한 가지를 같이 골라주는 것", side: "right" },
    ],
  },
  {
    key: "A3",
    axis: "decisionCriteria",
    title: "예산보다 비싼 결혼식장",
    question: "마음에 드는 식장이 처음 정한 예산보다 비싸요. 계속 알아볼지 정할 때 먼저 확인할 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KCA_WEDDING_MARKET", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "식사·대관·추가 항목까지 합친 전체 금액", side: "left" },
      { value: "B", label: "이 장소에서만 얻을 경험이 우리에게 얼마나 중요한지", side: "right" },
    ],
  },
  {
    key: "B3",
    axis: "preparationMode",
    title: "서로 잘 보는 것이 다를 때",
    question: "한 사람은 가격을, 다른 사람은 사진을 더 잘 봐요. 알아볼 곳을 줄일 때 더 편한 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "COUPLE_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "각자 잘 보는 항목을 맡아 확인한 뒤 결과를 합친다", side: "right" },
      { value: "B", label: "같은 비교표를 함께 보며 하나씩 기준을 맞춘다", side: "left" },
    ],
  },
  {
    key: "C3",
    axis: "coordinationScope",
    title: "전통 행사를 조율할 때",
    question: "가족이 중요하게 생각하는 전통 행사를 간단히 하고 싶어요. 대화를 준비할 때 먼저 정리할 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KOREAN_WEDDING_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "둘이 하고 싶은 것과 간단히 하고 싶은 이유", side: "left" },
      { value: "B", label: "가족이 의미 있게 생각하는 부분과 그 이유", side: "right" },
    ],
  },
  {
    key: "D3",
    axis: "supportOrder",
    title: "준비가 늦어져 마음이 급할 때",
    question: "준비가 생각보다 늦어져 마음이 급할 때, 상대가 먼저 해주면 도움이 되는 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "DYADIC_COPING_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "급한 일과 맡을 일을 바로 나누는 것", side: "right" },
      { value: "B", label: "왜 마음이 급한지 먼저 들어주는 것", side: "left" },
    ],
  },
  {
    key: "A4",
    axis: "decisionCriteria",
    title: "더 마음에 드는 선택이 비쌀 때",
    question: "예산 안의 무난한 선택과, 조금 더 들지만 마음에 드는 선택이 남았어요. 대화를 시작할 때 먼저 꺼낼 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KCA_WEDDING_MARKET", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "더 마음에 드는 이유와 달라지는 장면", side: "right" },
      { value: "B", label: "더 드는 금액과 다른 예산에 미치는 영향", side: "left" },
    ],
  },
  {
    key: "B4",
    axis: "preparationMode",
    title: "바쁜 주에 준비를 이어갈 때",
    question: "이번 주는 둘 다 바빠 준비할 시간이 적어요. 그래도 일을 이어갈 때 더 편한 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "COUPLE_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "짧게라도 같이 확인할 시간을 정하고 그때 결정한다", side: "left" },
      { value: "B", label: "담당자가 진행하고, 상대 확인이 필요한 결정만 모아 공유한다", side: "right" },
    ],
  },
  {
    key: "C4",
    axis: "coordinationScope",
    title: "날짜 후보를 고를 때",
    question: "날짜 후보 둘 중 하나는 우리 일정에, 다른 하나는 가족 일정에 더 편해요. 먼저 볼 쪽은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "KOREAN_WEDDING_DECISION_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "가족이 참석하기 어려운 조건", side: "right" },
      { value: "B", label: "둘의 일정과 꼭 지키고 싶은 조건", side: "left" },
    ],
  },
  {
    key: "D4",
    axis: "supportOrder",
    title: "업체 일정이 갑자기 바뀌었을 때",
    question: "예약한 업체가 갑자기 일정을 바꿔 당황했어요. 상대가 먼저 해주면 도움이 되는 것은?",
    evidenceRefs: ["TEST_DEVELOPMENT_METHOD", "DYADIC_COPING_RESEARCH", "PRODUCT_HYPOTHESIS"],
    sourceReview: SOURCE_REVIEW,
    status: "candidate_pending_human_validation",
    options: [
      { value: "A", label: "당황한 상황과 마음을 차분히 들어주는 것", side: "left" },
      { value: "B", label: "가능한 날짜와 연락할 곳부터 같이 정리하는 것", side: "right" },
    ],
  },
] as const satisfies readonly WeddingCodeV05Question[];
