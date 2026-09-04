import { MANNERS_GUIDE_BY_CATEGORY } from "@hanbang/shared/constants";

import { MANNERS_PARTS } from "./data";

/**
 * 웨딩 준비 카테고리 → 예절 안내 파트.
 *
 * 2026-07-17 `84b54e9f`가 지운 `CATEGORY_ETIQUETTE_MAP`(카테고리 → 파트 번호)의
 * 자리를 대신한다. 한동안 10파트뿐이라 19개 카테고리 중 10개만 덮였고, 나머지 9개는
 * 모달 하단이 "아모라에게 물어보기"로 떨어졌다.
 *
 * 2026-08-19에 레거시 25편을 이 스키마로 이관하면서 **19개 전부 덮인다.** 비어 있던
 * 9개가 각각 이렇게 채워졌다 — meeting→상견례, ring·yedan·ham→예물·예단·함,
 * hanbok·pyebaek→폐백, honeymoon→신혼여행 후 인사, houseware→혼수, housing→신혼집.
 *
 * 여전히 없는 파트를 억지로 이어 붙이지는 않는다. 매핑이 없으면 `null`을 돌려주고
 * 호출부가 카드를 안 그린다 — 죽은 링크보다 낫다.
 */
/**
 * 지도의 정본은 **shared 다.**
 *
 * 2026-09-04 까지 이 목록이 여기 손으로 적혀 있었다. 그런데 모바일 체크리스트도
 * 같은 버튼(「…예절 보기」)을 그려야 했고, 모바일은 이 파일을 못 읽는다(예절 본문이
 * 웹 전용이라 번들에 넣을 수 없다). 사본을 하나 더 만드는 대신 **지도를 shared 로
 * 올리고 여기서 slug 만 꺼내 쓴다** — 두 벌을 두면 반드시 한쪽이 낡는다.
 *
 * 편의 **내용**은 여전히 웹의 `data.ts` 가 정본이다. shared 가 아는 것은 어느 편으로
 * 가는가와 그 편의 제목뿐이고, 그 제목이 `data.ts` 와 어긋나지 않는지는
 * `scripts/tests/manners-guide-map-matches-parts.test.mjs` 가 지킨다.
 */
const CATEGORY_MANNERS_SLUG: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MANNERS_GUIDE_BY_CATEGORY).map(([categoryKey, target]) => [
    categoryKey,
    target.slug,
  ]),
);

export const MAPPED_MANNERS_CATEGORY_KEYS = Object.keys(CATEGORY_MANNERS_SLUG);

/**
 * 파트 → 그 파트가 여는 대표 카테고리.
 *
 * 한 파트를 여러 카테고리가 가리킬 때, 호출부는 그냥 첫 번째를 집었다. 그 "첫 번째"가
 * 객체 리터럴의 선언 순서였던 탓에 **「폐백 예절」이 '한복' 체크리스트를 열었다** —
 * `hanbok`이 `pyebaek`보다 위에 적혀 있었기 때문이다(2026-08-19 실측).
 *
 * 순서를 바꿔 고치면 다음에 키를 한 줄 추가할 때 같은 사고가 반복된다. 그래서 대표를
 * 여기서 이름으로 못 박는다. 여기 없는 파트는 종전대로 첫 번째를 쓴다.
 */
const PRIMARY_CATEGORY_FOR_PART: Readonly<Record<string, string>> = {
  "traditional-greetings": "pyebaek",
  "gifts-and-traditions": "yedan",
  "wedding-day": "venue",
  "photo-manners": "studio",
};

export function categoryKeysForMannersPart(slug: string): string[] {
  const keys = Object.entries(CATEGORY_MANNERS_SLUG)
    .filter(([, mappedSlug]) => mappedSlug === slug)
    .map(([categoryKey]) => categoryKey);

  const primary = PRIMARY_CATEGORY_FOR_PART[slug];
  if (!primary || !keys.includes(primary)) return keys;
  return [primary, ...keys.filter((key) => key !== primary)];
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
