import { WEDDING_GUEST_COUNT_OPTIONS, WEDDING_STYLE_OPTIONS } from "@hanbang/shared";

export const WEDDING_TASTE_VERSION = "wedding-taste-v1" as const;
export const TASTE_DOMAIN_OPTIONS = [
  { value: "venue", label: "공간·장소" },
  { value: "photo", label: "사진" },
  { value: "attire", label: "입을 옷" },
  { value: "meal", label: "식사" },
  { value: "guests", label: "함께할 사람 수" },
  { value: "ceremony", label: "식순·연출" },
] as const;
export const TASTE_MOOD_OPTIONS = WEDDING_STYLE_OPTIONS;
export const TASTE_AVOID_OPTIONS = [
  { value: "long_travel", label: "긴 이동" },
  { value: "crowded_space", label: "붐비는 공간" },
  { value: "long_ceremony", label: "긴 식순" },
  { value: "heavy_decoration", label: "과한 장식" },
  { value: "repeated_poses", label: "정해진 자세를 반복하는 촬영" },
  { value: "uncomfortable_attire", label: "움직이기 불편한 옷" },
  { value: "meal_wait", label: "식사 대기" },
  { value: "unexplained_addons", label: "설명 없는 추가비용" },
] as const;
export const TASTE_NEGOTIABILITY_OPTIONS = [
  { value: "prefer_keep", label: "가능하면 지키고 싶어요" },
  { value: "open_to_options", label: "다른 안도 함께 볼 수 있어요" },
  { value: "undecided", label: "아직 정하지 못했어요" },
] as const;
export const TASTE_DOMAIN_QUESTIONS = {
  venue: { question: "어떤 공간에서 식을 올리거나 함께 식사하고 싶나요?", max: 1, options: [
    { value: "indoor", label: "실내" }, { value: "outdoor", label: "야외" }, { value: "both_spaces", label: "실내와 야외를 함께 쓰는 곳" },
  ] },
  photo: { question: "사진에는 어떤 모습을 남기고 싶나요?", max: 1, options: [
    { value: "candid", label: "자연스러운 순간" }, { value: "directed", label: "준비한 포즈와 장면" }, { value: "both_styles", label: "두 방식 모두" },
  ] },
  attire: { question: "입을 옷에서 원하는 모습은 어떤 쪽인가요?", max: 2, options: [
    { value: "simple", label: "간결한 선과 장식" }, { value: "flowing", label: "부드럽게 흐르는 형태" }, { value: "decorative", label: "눈에 띄는 장식" }, { value: "traditional", label: "전통 의복의 모습" },
  ] },
  meal: { question: "함께할 식사는 어떤 방식이면 좋겠나요?", max: 1, options: [
    { value: "buffet", label: "각자 고르는 뷔페" }, { value: "course", label: "순서대로 나오는 식사" }, { value: "shared_table", label: "한 상을 함께 나누는 식사" },
  ] },
  guests: { question: "내가 원하는 자리는 어느 정도 규모인가요?", max: 1, options: [
    { value: "no_guests", label: "둘만, 하객 없이" }, ...WEDDING_GUEST_COUNT_OPTIONS,
  ] },
  ceremony: { question: "어떤 진행을 하고 싶나요?", max: 2, options: [
    { value: "short", label: "핵심 순서로 짧게" }, { value: "our_story", label: "둘의 이야기와 인사 중심" }, { value: "participatory", label: "참여·공연이 있는 진행" }, { value: "traditional", label: "전통 절차를 포함한 진행" },
  ] },
} as const;
export const TASTE_STATUS_LABELS = {
  undecided: "아직 모르겠어요",
  no_preference: "어느 쪽도 괜찮아요",
  not_applicable: "이번 계획에는 없어요",
  skipped: "지금 답하지 않을게요",
} as const;
