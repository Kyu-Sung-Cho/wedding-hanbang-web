export type MannersPartLink = {
  slug: string;
  title: string;
  subtitle: string;
};

/**
 * 웨딩 준비 카테고리 → 예절 안내 파트.
 *
 * 2026-07-17 `84b54e9f`가 지운 과거 매핑의 자리를 대신한다. 2026-08-12 가족 영역
 * 6파트를 검증해 추가하면서 19개 준비 분야 중 18개를 직접 연결한다. 신혼여행은
 * 여행 뒤 가족 인사 가이드를 별도로 검증할 때까지 억지로 다른 글에 연결하지 않는다.
 */
const CATEGORY_MANNERS_SLUG: Readonly<Record<string, string>> = {
  meeting: "family-meeting",
  venue: "wedding-day",
  studio: "photo-manners",
  dress: "wedding-day",
  makeup: "wedding-day",
  ring: "gifts-and-traditions",
  hanbok: "traditional-greetings",
  yedan: "gifts-and-traditions",
  houseware: "money-home-conversation",
  housing: "money-home-conversation",
  invitation: "invitation-sending",
  snap: "photo-manners",
  shoes: "wedding-day",
  bouquet: "wedding-day",
  gift: "return-gift",
  mc: "congratulatory-speech",
  ham: "gifts-and-traditions",
  pyebaek: "traditional-greetings",
};

// 이 모듈은 체크리스트·라운지 클라이언트에서도 쓴다. 300KB가 넘는 본문 data.ts를
// import하지 않고 링크에 필요한 최소 정보만 둔다. 아래 테스트가 서버 정본과의 drift를 막는다.
const MANNERS_LINK_BY_SLUG: Readonly<Record<string, MannersPartLink>> = {
  "family-meeting": {
    slug: "family-meeting",
    title: "상견례 준비와 대화",
    subtitle: "양가가 처음 만나는 날의 부담을 줄이는 방법",
  },
  "wedding-day": {
    slug: "wedding-day",
    title: "본식 당일 예절",
    subtitle: "당일 동선과 인사를 미리 한 번 훑어보기",
  },
  "photo-manners": {
    slug: "photo-manners",
    title: "웨딩 촬영 매너",
    subtitle: "카메라 앞에서, 카메라 뒤에서",
  },
  "gifts-and-traditions": {
    slug: "gifts-and-traditions",
    title: "예물·예단·함을 정하는 법",
    subtitle: "관습을 의무가 아닌 선택지로 바꾸는 가족 대화",
  },
  "traditional-greetings": {
    slug: "traditional-greetings",
    title: "폐백과 전통 인사",
    subtitle: "누구나 편하게 참여할 수 있도록 순서를 고르는 법",
  },
  "money-home-conversation": {
    slug: "money-home-conversation",
    title: "가족 지원·예산·신혼집 이야기",
    subtitle: "금액보다 조건과 결정권을 먼저 확인하는 대화",
  },
  "invitation-sending": {
    slug: "invitation-sending",
    title: "청첩장 발송 예절",
    subtitle: "부담 주지 않고 소식을 전하는 법",
  },
  "return-gift": {
    slug: "return-gift",
    title: "이바지·답례품 예절",
    subtitle: "감사를 표현하는 방법",
  },
  "congratulatory-speech": {
    slug: "congratulatory-speech",
    title: "축사·축가 예절",
    subtitle: "결혼식을 빛내는 한마디",
  },
};

export const MAPPED_MANNERS_CATEGORY_KEYS = Object.keys(CATEGORY_MANNERS_SLUG);

export function categoryKeysForMannersPart(slug: string): string[] {
  return Object.entries(CATEGORY_MANNERS_SLUG)
    .filter(([, mappedSlug]) => mappedSlug === slug)
    .map(([categoryKey]) => categoryKey);
}

/**
 * 카테고리에 대응하는 파트를 찾는다. 매핑이 없거나 slug가 실제 파트를 가리키지
 * 않으면 `null` — 호출부는 카드를 그리지 않는다. 죽은 링크를 만드는 것보다 낫다.
 */
export function mannersPartForCategory(categoryKey: string | null | undefined) {
  if (!categoryKey) return null;
  const slug = CATEGORY_MANNERS_SLUG[categoryKey];
  if (!slug) return null;
  return MANNERS_LINK_BY_SLUG[slug] ?? null;
}
