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

/**
 * 표기만 다른 **같은 업체** — 근거로 확인된 것만 넣는다. 값은 대표(정규화) 이름.
 *
 * 정규화는 `(주)`와 공백·구두점만 지우므로 `"가을"`과 `"가을스튜디오"`처럼 대행사가
 * 카테고리 접미를 붙여 적은 경우 서로 다른 업체로 갈린다(2026-07-27 실측 79쌍).
 * 접미를 자동으로 떼면 `"스튜디오고유"`처럼 접미가 이름의 일부인 업체가 깨지고
 * 실제로 `"스튜디오"`라는 이름의 업체가 1곳 있어 과매칭이 폭발한다. 그래서
 * 자동 규칙이 아니라 **건별 확인 목록**으로 둔다.
 *
 * 등재 기준(전부 충족해야 한다):
 *   1. 양쪽 행이 **각각 독립적으로** 같은 공식 채널(사이트·인스타)로 확인됐다.
 *      한쪽만 채널이 있거나 이름 유사성만으로 배정된 건은 넣지 않는다.
 *   2. 확인 근거에 주소·전화·사이트 타이틀 같은 **업체 식별 정보**가 있다.
 *   3. 같은 브랜드라도 **지역이 다른 지점은 넣지 않는다** — 다른 샵이고 가격도
 *      다르다(`지니어스` 서울 ↔ 강릉 지점은 그래서 제외했다. `[천안] 아우라`류
 *      대괄호 지역 표기를 분리 유지하는 것과 같은 원칙이다).
 *
 * 판정 근거와 미결 목록: `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`
 * 후보 재확인: `pnpm audit:vendor-merge`
 */
export const SAME_BUSINESS_DIFFERENT_NAME: ReadonlyMap<string, string> = new Map<string, string>([
  ["studio|가을스튜디오", "가을"],
  ["studio|디하우스스튜디오", "디하우스"],
  ["studio|라뮤즈스튜디오", "라뮤즈"],
  ["studio|메종드힐스튜디오", "메종드힐"],
  ["studio|박개인주의스튜디오", "박개인주의"],
  ["studio|온뜰에피움스튜디오", "온뜰에피움"],
  ["studio|클레브스튜디오", "클레브"],
  ["studio|타임포유스튜디오", "타임포유"],
  ["studio|탱자스튜디오", "탱자"],
  ["studio|테레지아스튜디오", "테레지아"],
  ["dress|루비나엘웨딩", "루비나엘"],
  ["dress|르블랑웨딩", "르블랑"],
  ["dress|마이도터스웨딩", "마이도터스"],
  ["dress|보네르웨딩", "보네르"],
  ["dress|아비가일웨딩", "아비가일"],
  ["dress|클라라웨딩", "클라라"],
  // 2차: 1차 리서치 원본 결과에서 양쪽이 **각각 high 확신으로** 같은 공식 채널을
  // 가리킨 건들. URL 게시는 다른 사유(죽은 modoo 플랫폼·로고 게이트·인증서 만료)로
  // 막혔지만 신원 근거로는 유효하다 — 양쪽 근거에 같은 주소가 적혀 있다.
  ["studio|구호스튜디오", "구호"], // 성동구 성수동2가 280-18
  ["studio|더청담스튜디오", "더청담"], // 청담동 49-5 · 02-3444-4155
  ["studio|바시움스튜디오", "바시움"], // 강남구 봉은사로51길 26
  ["studio|버드투블룸스튜디오", "버드투블룸"], // 청담동 본점(양쪽 근거 모두 청담)
  ["studio|헤이스스튜디오", "헤이스"], // 서초 내곡동
  ["studio|st정우스튜디오", "st정우"], // (주)에스티정우 청담 — region 충청은 대행사 지역
  ["dress|메라키웨딩", "메라키"], // 강남 학동로 137-7
  ["dress|장다인웨딩", "장다인"], // 강남 선릉로135길 6 · 02-547-5568
  ["dress|폴라리스웨딩", "폴라리스"], // 강남 선릉로 731
  ["dress|플로렌스웨딩", "플로렌스"], // 청담
]);

/**
 * 그룹 판정에 쓸 대표 이름. 표기 차이를 흡수한 뒤의 정규화 이름이다.
 *
 * 목록·상세·형제 조회가 **모두** 이 함수를 거쳐야 한다. 한 곳만 빠지면
 * "카드엔 대행사 4곳인데 눌러 보니 1곳"이 다시 생긴다.
 */
export function canonicalVendorName(category: string, vendorName: string): string {
  const normalized = normalizeVendorName(vendorName);
  if (!normalized) return normalized;
  return SAME_BUSINESS_DIFFERENT_NAME.get(`${category}|${normalized}`) ?? normalized;
}

export function vendorIdentityKey(
  category: PriceCategory,
  vendorName: string,
  vendorSlug: string,
): string {
  const canonical = canonicalVendorName(category, vendorName);
  if (!canonical || isSameNameDifferentBusiness(category, canonical)) {
    // 이름만 같고 실제로는 다른 업체 — 슬러그를 그대로 써서 분리를 유지한다.
    return `slug:${vendorSlug}`;
  }
  return `${category}|${canonical}`;
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
export function vendorIdentityLikePattern(
  vendorName: string,
  category?: string,
): string | null {
  // 대표 이름으로 패턴을 만든다. 방문한 이름이 긴 쪽("가을스튜디오")이면 그것으로
  // 만든 패턴은 짧은 형제("가을")를 못 잡아 한 방향만 병합되는 상태가 된다.
  const normalized = category === undefined
    ? normalizeVendorName(vendorName)
    : canonicalVendorName(category, vendorName);
  if (!normalized) return null;
  // 너무 긴 이름은 패턴이 커져 인덱스 없이 훑는 비용만 늘어난다. 앞부분만 써도
  // 후보를 좁히는 목적은 달성되고, 최종 판정은 JS 정규화 비교가 한다.
  const head = [...normalized].slice(0, IDENTITY_LIKE_MAX_LENGTH);
  const escaped = head.map((character) => character.replace(/([%_\\])/g, "\\$1"));
  return `%${escaped.join("%")}%`;
}
