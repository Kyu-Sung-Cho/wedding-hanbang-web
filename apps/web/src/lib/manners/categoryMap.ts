import { MANNERS_PARTS } from "./data";

/**
 * 웨딩 준비 카테고리 → 예절 안내 파트.
 *
 * 2026-07-17 `84b54e9f`가 지운 `CATEGORY_ETIQUETTE_MAP`(카테고리 → 파트 번호)의
 * 자리를 대신한다. 그때는 25파트가 있어 19개 카테고리를 전부 덮었지만 지금은
 * 1단계 10파트뿐이라 **덮이는 카테고리가 10개다.** 나머지 9개는 여기 넣지 않는다 —
 * 없는 파트를 억지로 이어 붙이면 "임박한 준비에 맞는 안내"라는 카드의 약속이 깨진다.
 *
 * 덮이지 않는 카테고리(2단계 집필 대상): meeting(첫인사·상견례),
 * ring·yedan·ham(예물·예단·함), hanbok·pyebaek(폐백), honeymoon(신혼여행 후 인사),
 * houseware(혼수), housing(신혼집).
 */
const CATEGORY_MANNERS_SLUG: Readonly<Record<string, string>> = {
  venue: "wedding-day",
  studio: "photo-manners",
  dress: "wedding-day",
  makeup: "wedding-day",
  invitation: "invitation-sending",
  snap: "photo-manners",
  shoes: "wedding-day",
  bouquet: "wedding-day",
  gift: "return-gift",
  mc: "congratulatory-speech",
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
  return MANNERS_PARTS.find((part) => part.slug === slug) ?? null;
}
