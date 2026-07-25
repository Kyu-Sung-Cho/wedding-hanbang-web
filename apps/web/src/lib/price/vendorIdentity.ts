import type { PriceCategory } from "./catalog";

/**
 * 같은 업체가 여러 대행사에 걸쳐 있어도 한 곳으로 보여주기 위한 신원 규칙.
 *
 * 스드메 공시는 대행사별 xlsx다. 같은 샵을 여러 대행사가 취급하면 가격이 다르고,
 * 그 차이가 이 서비스가 보여줘야 할 핵심 정보다. 그런데 적재 RPC가 신원 키에
 * 지역을 넣어(vendors 조회 조건 + 슬러그 해시) 대행사 지역이 다르면 새 업체로
 * 생성됐다. 그 결과 같은 샵이 최대 5장까지 갈렸다(2026-07-26 실측: 157그룹).
 * 지역은 대행사의 것이지 샵의 것이 아니므로 신원 키에서 뺀다.
 *
 * 목록과 상세가 같은 규칙을 써야 "카드엔 대행사 4곳인데 눌러 보니 1곳"이 안
 * 생긴다. 그래서 규칙은 여기 한 곳에만 둔다.
 */
export function normalizeVendorName(value: string): string {
  return String(value ?? "")
    .replace(/\(주\)|주식회사|㈜/g, "")
    .replace(/[\s·\-_,.()]/g, "")
    .toLowerCase();
}

/**
 * 이름은 같지만 공식 채널이 서로 달라 별개 업체로 확인된 건들.
 * 합치면 다른 가게의 가격을 한 카드에 섞게 되므로 반드시 분리한다.
 *   랑게        전라 @langhe_gj(광주)     ↔ 서울 @langhe_official
 *   메이든스튜디오 서울 @maiden_studio       ↔ 경상 @maiden_daegu(대구)
 *   라망        한쪽만 공식 사이트 보유 — 동일 업체 근거 없음
 */
export const SAME_NAME_DIFFERENT_BUSINESS: ReadonlySet<string> = new Set<string>([
  "studio|랑게",
  "studio|메이든스튜디오",
  "studio|라망",
]);

export function isSameNameDifferentBusiness(
  category: string,
  normalizedName: string,
): boolean {
  return SAME_NAME_DIFFERENT_BUSINESS.has(`${category}|${normalizedName}`);
}

export function vendorIdentityKey(
  category: PriceCategory,
  vendorName: string,
  vendorSlug: string,
): string {
  const normalized = normalizeVendorName(vendorName);
  if (!normalized || isSameNameDifferentBusiness(category, normalized)) {
    // 이름만 같고 실제로는 다른 업체 — 슬러그를 그대로 써서 분리를 유지한다.
    return `slug:${vendorSlug}`;
  }
  return `${category}|${normalized}`;
}

const IDENTITY_LIKE_MAX_LENGTH = 40;

/**
 * 정규화 이름이 같은 형제 행을 DB에서 후보로 긁어오기 위한 ILIKE 패턴.
 *
 * 정규화는 공백·구두점을 지우는데("메이 스튜디오" = "메이스튜디오") SQL 쪽에
 * 같은 정규화 컬럼이 없다. 그래서 글자 사이에 %를 끼워 표기 차이를 흡수한 뒤,
 * 실제 판정은 normalizeVendorName으로 다시 한다 — 과매칭은 걸러지고 누락만
 * 없어진다. 실측 24개 그룹이 표기만 다른 형제였다(2026-07-26).
 */
export function vendorIdentityLikePattern(vendorName: string): string | null {
  const normalized = normalizeVendorName(vendorName);
  if (!normalized) return null;
  // 너무 긴 이름은 패턴이 커져 인덱스 없이 훑는 비용만 늘어난다. 앞부분만 써도
  // 후보를 좁히는 목적은 달성되고, 최종 판정은 JS 정규화 비교가 한다.
  const head = [...normalized].slice(0, IDENTITY_LIKE_MAX_LENGTH);
  const escaped = head.map((character) => character.replace(/([%_\\])/g, "\\$1"));
  return `%${escaped.join("%")}%`;
}
