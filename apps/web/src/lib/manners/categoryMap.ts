export type MannersPartLink = {
  slug: string;
  title: string;
  subtitle: string;
};

/**
 * 웨딩 준비 카테고리 → 예절 안내 파트.
 *
 * 각 체크리스트 카드가 가장 가까운 파트 하나를 바로 열 수 있게 한다.
 * 한 분야와 연결된 나머지 파트는 상세 체크리스트의 `relatedMannersSlugs`에서 제공한다.
 * 여러 서로 다른 상황을 묶은 `special_cases`에는 하나의 대표 파트를 억지로 붙이지 않는다.
 */
const CATEGORY_MANNERS_SLUG: Readonly<Record<string, string>> = {
  foundation: "planning-timeline",
  contracts: "cost-saving",
  meeting: "family-meeting",
  venue: "cost-saving",
  studio: "photo-manners",
  dress: "cost-saving",
  makeup: "cost-saving",
  ring: "cost-saving",
  hanbok: "cost-saving",
  yedan: "gifts-and-traditions",
  honeymoon: "honeymoon-preparation",
  houseware: "shared-home-items",
  housing: "money-home-conversation",
  invitation: "invitation-sending",
  snap: "photo-manners",
  shoes: "wedding-day",
  bouquet: "wedding-day",
  gift: "return-gift",
  mc: "congratulatory-speech",
  ham: "gifts-and-traditions",
  pyebaek: "traditional-greetings",
  guests: "invitation-sending",
  ceremony: "wedding-day",
  home_admin: "money-home-conversation",
  health_admin: "marriage-registration",
  aftercare: "post-honeymoon-thanks",
};

// 이 모듈은 체크리스트·라운지 클라이언트에서도 쓴다. 300KB가 넘는 본문 data.ts를
// import하지 않고 링크에 필요한 최소 정보만 둔다. 아래 테스트가 서버 정본과의 drift를 막는다.
const MANNERS_LINK_BY_SLUG: Readonly<Record<string, MannersPartLink>> = {
  "planning-timeline": {
    slug: "planning-timeline",
    title: "전체 준비 타임라인",
    subtitle: "고정 날짜표보다 의존 관계와 마감부터",
  },
  "cost-saving": {
    slug: "cost-saving",
    title: "결혼 비용 절약 가이드",
    subtitle: "깎기 전에, 새는 곳부터 막기",
  },
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
  "post-honeymoon-thanks": {
    slug: "post-honeymoon-thanks",
    title: "결혼식 뒤 감사와 마감",
    subtitle: "고마운 사람과 남은 일을 차분히 정리하기",
  },
  "honeymoon-preparation": {
    slug: "honeymoon-preparation",
    title: "신혼여행 출발 전 준비",
    subtitle: "예약보다 먼저 계약·입국·안전 조건을 함께 확인하기",
  },
  "shared-home-items": {
    slug: "shared-home-items",
    title: "혼수와 공동생활 물품",
    subtitle: "성별이 아니라 생활과 공간으로 고르기",
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
  "guest-manners": {
    slug: "guest-manners",
    title: "하객 매너",
    subtitle: "축하하는 마음이 잘 전해지도록",
  },
  "marriage-registration": {
    slug: "marriage-registration",
    title: "혼인신고와 법적 절차",
    subtitle: "법적으로 부부가 되는 과정",
  },
  "religious-weddings": {
    slug: "religious-weddings",
    title: "종교 예식 준비",
    subtitle: "종교 이름보다 실제 기관의 절차를 확인하기",
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
