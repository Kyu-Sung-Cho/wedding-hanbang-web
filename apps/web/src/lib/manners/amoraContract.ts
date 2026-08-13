/**
 * 예절 가이드에서 아모라로 넘길 수 있는 공개 URL 계약.
 *
 * URL에는 사용자가 읽던 본문, 출처 URL, 개인 상황을 넣지 않는다. 서버가 이 allowlist의
 * slug만 검증한 뒤 canonical corpus에서 필요한 문맥을 다시 읽어야 한다.
 */
export const MANNERS_AMORA_QUERY_PARAM = "manners_slug";

export const MANNERS_AMORA_ALLOWED_SLUGS = [
  "first-family-visit",
  "family-meeting",
  "gifts-and-traditions",
  "traditional-greetings",
  "money-home-conversation",
  "planning-conflicts",
  "planning-timeline",
  "invitation-sending",
  "shared-home-items",
  "honeymoon-preparation",
  "cost-saving",
  "small-wedding",
  "wedding-day",
  "religious-weddings",
  "guest-manners",
  "photo-manners",
  "gift-money",
  "congratulatory-speech",
  "return-gift",
  "post-honeymoon-thanks",
  "first-holiday",
  "housewarming",
  "family-address",
  "family-events",
  "digital-manners",
  "marriage-registration",
] as const;

export type MannersAmoraSlug = (typeof MANNERS_AMORA_ALLOWED_SLUGS)[number];

const ALLOWED_SLUGS = new Set<string>(MANNERS_AMORA_ALLOWED_SLUGS);

/** 외부 query 값을 exact allowlist slug로 좁힌다. 배열, 공백, 대소문자 변형은 허용하지 않는다. */
export function parseMannersAmoraSlug(value: unknown): MannersAmoraSlug | null {
  if (typeof value !== "string" || !ALLOWED_SLUGS.has(value)) return null;
  return value as MannersAmoraSlug;
}

/** 내부 링크도 allowlist를 통과시켜 corpus와 UI의 drift가 조용히 배포되지 않게 한다. */
export function buildMannersAmoraChatPath(slug: string): string {
  const safeSlug = parseMannersAmoraSlug(slug);
  if (!safeSlug) {
    throw new Error(`Unknown manners slug: ${slug}`);
  }

  return `/chat?${new URLSearchParams({ [MANNERS_AMORA_QUERY_PARAM]: safeSlug })}`;
}
