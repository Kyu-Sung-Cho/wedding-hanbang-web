export const WEDDING_STYLE_OPTIONS = [
  {
    value: "minimal",
    label: "간결한 분위기",
    description: "장식을 줄이고 깔끔하게",
  },
  {
    value: "classic",
    label: "정돈된 격식",
    description: "차분하고 격식 있게",
  },
  {
    value: "fancy",
    label: "눈에 띄는 연출",
    description: "장식과 색을 풍성하게",
  },
  {
    value: "natural",
    label: "편안한 분위기",
    description: "자연을 살려 편안하게",
  },
] as const;

export type WeddingStyleValue =
  (typeof WEDDING_STYLE_OPTIONS)[number]["value"];

export const WEDDING_PRIORITY_OPTIONS = [
  { value: "sdm", label: "사진 촬영·드레스·헤어·메이크업" },
  { value: "venue", label: "결혼식장" },
  { value: "rings", label: "결혼반지·가족 선물" },
  { value: "honeymoon", label: "신혼여행" },
  { value: "ceremony", label: "결혼식 진행·장식" },
  { value: "housing", label: "신혼집·가전·가구" },
] as const;

export type WeddingPriorityValue =
  (typeof WEDDING_PRIORITY_OPTIONS)[number]["value"];

export const WEDDING_BUDGET_TENDENCY_OPTIONS = [
  {
    value: "saving",
    label: "총액 우선",
    description: "전체 금액을 낮추는 것이 중요해요",
  },
  {
    value: "balanced",
    label: "항목별 조절",
    description: "중요한 곳에 더 쓰고 나머지는 줄여요",
  },
  {
    value: "premium",
    label: "원하는 결과 우선",
    description: "가격보다 원하는 결과를 우선해요",
  },
] as const;

export type WeddingBudgetTendencyValue =
  (typeof WEDDING_BUDGET_TENDENCY_OPTIONS)[number]["value"];

export const WEDDING_GUEST_COUNT_OPTIONS = [
  { value: "under50", label: "50명 미만" },
  { value: "50to100", label: "50~99명" },
  { value: "100to200", label: "100~199명" },
  { value: "200to300", label: "200~299명" },
  { value: "over300", label: "300명 이상" },
] as const;

export type WeddingGuestCountValue =
  (typeof WEDDING_GUEST_COUNT_OPTIONS)[number]["value"];
