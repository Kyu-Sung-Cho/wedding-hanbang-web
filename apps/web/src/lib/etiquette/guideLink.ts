import { CATEGORY_ETIQUETTE_MAP, ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";

/**
 * 준비 카테고리 → 읽을 예절 안내 한 곳.
 *
 * 2026-08-19에 레거시 25파트를 되살리면서 안내가 두 벌이 됐다. 카드를 두 개 그리면
 * 사용자는 "둘 중 뭐가 맞는 거지"를 먼저 묻게 되므로 **하나만 고른다.**
 *
 *   1순위 `/manners` — 출처·확인일·한계 표기 계약을 통과한 10파트.
 *   2순위 `/etiquette` — 그 계약이 없는 레거시 25파트.
 *
 * 순서를 이렇게 두는 이유는 품질이지 최신성이 아니다. 다만 manners가 덮는 카테고리는
 * 19개 중 10개뿐이라, 나머지 9개(상견례·예물·예단·함·한복·폐백·신혼여행·혼수·신혼집)는
 * 그동안 안내가 아예 없었다. 레거시는 19개를 모두 덮으므로 그 공백을 메운다.
 *
 * `kind`를 함께 돌려주는 건 화면에서 근거 표기 수준을 다르게 말하기 위해서다 —
 * 레거시 파트에는 출처가 없고, 그 사실을 카드에서 숨기지 않는다.
 */
export type CategoryGuideLink = {
  href: string;
  title: string;
  subtitle: string;
  /** `manners`는 출처 계약 통과, `legacy`는 미검증 레거시. */
  kind: "manners" | "legacy";
};

export function guideLinkForCategory(
  categoryKey: string | null | undefined,
): CategoryGuideLink | null {
  if (!categoryKey) return null;

  const manners = mannersPartForCategory(categoryKey);
  if (manners) {
    return {
      href: `/manners/${manners.slug}`,
      title: manners.title,
      subtitle: manners.subtitle,
      kind: "manners",
    };
  }

  const partNumber = CATEGORY_ETIQUETTE_MAP[categoryKey]?.[0];
  if (partNumber === undefined) return null;

  const part = ETIQUETTE_PARTS.find((candidate) => candidate.number === partNumber);
  if (!part) return null;

  return {
    href: `/etiquette?part=${part.number}`,
    title: part.title,
    subtitle: part.subtitle,
    kind: "legacy",
  };
}
