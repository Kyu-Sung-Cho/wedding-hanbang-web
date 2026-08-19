import { mannersPartForCategory } from "@/lib/manners/categoryMap";

/**
 * 준비 카테고리 → 읽을 예절 안내 한 곳.
 *
 * 2026-08-19 오전까지는 안내가 두 벌이었다 — 출처 계약을 통과한 `/manners` 10편과
 * 레거시 `/etiquette` 25편. 그래서 이 함수가 "manners 먼저, 없으면 레거시"로 골라 줬다.
 *
 * 같은 날 레거시 25편을 `/manners` 스키마로 이관하면서 그 분기가 사라졌다. 이제
 * 안내는 한 벌이고 19개 카테고리를 전부 덮는다. 함수를 지우지 않고 남긴 이유는
 * 호출부(주차 카드·체크리스트 모달)가 쓰는 `{href, title, subtitle}` 모양을 유지하기
 * 위해서다 — `mannersPartForCategory`는 파트 객체를 그대로 돌려준다.
 */
export type CategoryGuideLink = {
  href: string;
  title: string;
  subtitle: string;
};

export function guideLinkForCategory(
  categoryKey: string | null | undefined,
): CategoryGuideLink | null {
  const part = mannersPartForCategory(categoryKey);
  if (!part) return null;

  return {
    href: `/manners/${part.slug}`,
    title: part.title,
    subtitle: part.subtitle,
  };
}
