import { WEDDING_GUEST_COUNT_OPTIONS, WEDDING_STYLE_OPTIONS } from "@hanbang/shared";

export const WEDDING_TASTE_V1_VERSION = "wedding-taste-v1" as const;
export const WEDDING_TASTE_VERSION = "wedding-taste-v2" as const;
export type WeddingTasteVersion = typeof WEDDING_TASTE_V1_VERSION | typeof WEDDING_TASTE_VERSION;
export function isWeddingTasteVersion(value: unknown): value is WeddingTasteVersion {
  return value === WEDDING_TASTE_V1_VERSION || value === WEDDING_TASTE_VERSION;
}
export const TASTE_DOMAIN_OPTIONS = [
  { value: "venue", label: "장소" },
  { value: "photo", label: "사진" },
  { value: "attire", label: "입을 옷" },
  { value: "meal", label: "식사" },
  { value: "guests", label: "하객 규모" },
  { value: "ceremony", label: "식순과 연출" },
] as const;
export const TASTE_MOOD_OPTIONS = WEDDING_STYLE_OPTIONS;
export const TASTE_AVOID_OPTIONS = [
  { value: "long_travel", label: "긴 이동 시간" },
  { value: "crowded_space", label: "붐비는 곳" },
  { value: "long_ceremony", label: "긴 식순" },
  { value: "heavy_decoration", label: "과한 장식" },
  { value: "repeated_poses", label: "정해진 포즈만 반복하는 촬영" },
  { value: "uncomfortable_attire", label: "움직이기 불편한 옷" },
  { value: "meal_wait", label: "오래 기다려야 하는 식사" },
  { value: "unexplained_addons", label: "설명 없이 붙는 추가 비용" },
] as const;
export const TASTE_NEGOTIABILITY_OPTIONS = [
  { value: "prefer_keep", label: "가능하면 지키고 싶어요" },
  { value: "open_to_options", label: "다른 안도 함께 볼 수 있어요" },
  { value: "undecided", label: "아직 정하지 못했어요" },
] as const;
const TASTE_NEGOTIABILITY_V2_OPTIONS = [
  { value: "prefer_keep", label: "지금 고른 취향 안에서 찾아보고 싶어요" },
  { value: "open_to_options", label: "다른 취향의 후보도 함께 비교하고 싶어요" },
  { value: "undecided", label: "아직 정하지 못했어요" },
] as const;

/** 예전 유지 선호를 새 판의 첫 후보 범위로 바꾸어 읽지 않는다. */
export function getWeddingTasteNegotiability(version: WeddingTasteVersion) {
  return version === WEDDING_TASTE_V1_VERSION ? {
    question: "둘의 생각이 다르면 어떻게 하고 싶나요?",
    hint: "앞에서 고른 주제만 물어볼게요. 다른 안도 볼 수 있다고 해서 양보하겠다는 뜻은 아니에요.",
    rowSuffix: " 의견이 다르면",
    options: TASTE_NEGOTIABILITY_OPTIONS,
    amoraLimit: "먼저 이야기하고 싶다고 고른 게 돈을 더 쓰겠다는 뜻은 아니에요. 다른 안도 볼 수 있다고 한 것도 양보하겠다는 말은 아니고요.",
  } : {
    question: "의견이 다르면, 먼저 어떤 후보부터 볼까요?",
    hint: "앞에서 고른 주제마다, 처음 살펴볼 후보를 골라 주세요. 다른 후보를 비교해도 그걸로 바꾸겠다는 뜻은 아니에요.",
    rowSuffix: " 의견이 다르면 먼저 볼 후보",
    options: TASTE_NEGOTIABILITY_V2_OPTIONS,
    amoraLimit: "먼저 이야기할 주제를 골라도 돈을 더 쓰겠다는 뜻은 아니에요. 다른 후보도 비교하고 싶다고 답했더라도, 그걸로 바꾸겠다는 약속은 아니에요.",
  };
}
export const TASTE_DOMAIN_QUESTIONS = {
  venue: { question: "식을 올리거나 식사할 곳은 실내와 야외 중 어디가 좋아요?", max: 1, options: [
    { value: "indoor", label: "실내" }, { value: "outdoor", label: "야외" }, { value: "both_spaces", label: "실내와 야외를 함께 쓰는 곳" },
  ] },
  photo: { question: "사진에는 어떤 모습을 남기고 싶나요?", max: 1, options: [
    { value: "candid", label: "자연스러운 순간" }, { value: "directed", label: "준비한 포즈와 장면" }, { value: "both_styles", label: "둘 다 골고루" },
  ] },
  attire: { question: "어떤 옷을 입고 싶나요?", max: 2, options: [
    { value: "simple", label: "깔끔하고 단순한 옷" }, { value: "flowing", label: "하늘하늘한 옷" }, { value: "decorative", label: "장식이 화려한 옷" }, { value: "traditional", label: "한복 같은 전통 혼례복" },
  ] },
  meal: { question: "식사는 어떻게 하면 좋겠어요?", max: 1, options: [
    { value: "buffet", label: "각자 고르는 뷔페" }, { value: "course", label: "한 접시씩 나오는 코스" }, { value: "shared_table", label: "한 상에 차려 나눠 먹는 식사" },
  ] },
  guests: { question: "하객은 몇 명쯤이면 좋겠어요?", max: 1, options: [
    { value: "no_guests", label: "둘만, 하객 없이" }, ...WEDDING_GUEST_COUNT_OPTIONS,
  ] },
  ceremony: { question: "결혼식 순서는 어떻게 하고 싶나요?", max: 2, options: [
    { value: "short", label: "꼭 필요한 순서만 짧게" }, { value: "our_story", label: "둘의 이야기와 감사 인사" }, { value: "participatory", label: "하객 참여와 축하 공연" }, { value: "traditional", label: "전통 순서도 넣은 식" },
  ] },
} as const;

export function getWeddingTasteDomainQuestion(version: WeddingTasteVersion, domain: keyof typeof TASTE_DOMAIN_QUESTIONS) {
  const config = TASTE_DOMAIN_QUESTIONS[domain];
  if (version === WEDDING_TASTE_V1_VERSION || domain !== "guests") return config;
  return { ...config, options: config.options.map(option =>
    option.value === "under50" ? { ...option, label: "1~49명" } : option,
  ) };
}
export const TASTE_STATUS_LABELS = {
  undecided: "아직 모르겠어요",
  no_preference: "어느 쪽도 괜찮아요",
  not_applicable: "이번 계획에는 없어요",
  skipped: "지금 답하지 않을게요",
} as const;
