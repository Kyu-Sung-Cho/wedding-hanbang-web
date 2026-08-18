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
    // 대괄호를 빼먹으면 `[수원] 헤움`과 `헤움_수원점`이 서로 다른 업체로 갈린다.
    // 같은 샵의 같은 지점인데 대행사마다 지역 표기 위치가 달라서 생기는 분열이다.
    .replace(/[\s·\-_,.()[\]]/g, "")
    .toLowerCase();
}

/**
 * 이름은 같지만 공식 채널이 서로 달라 별개 업체로 확인된 건들.
 * 합치면 다른 가게의 가격을 한 카드에 섞게 되므로 반드시 분리한다.
 *   랑게        전라 @langhe_gj(광주)     ↔ 서울 @langhe_official
 *   메이든스튜디오 서울 @maiden_studio       ↔ 경상 @maiden_daegu(대구)
 *   라망        전주 @lamantstudio_jeonju  ↔ 서울 @lamantstudio_official
 *
 * **중요**: 이 집합에 있는 이름이라도 `VERIFIED_VENDOR_IDENTITY_BY_SLUG`에 slug가
 * 등록된 행은 그 그룹으로 묶인다. 이름 전체를 분리하되 확인된 서울 행끼리는
 * 합치는 것이 가능해진다.
 */
export const SAME_NAME_DIFFERENT_BUSINESS: ReadonlySet<string> = new Set<string>([
  "studio|랑게",
  "studio|메이든스튜디오",
  "studio|라망",
]);

/**
 * **행 단위 검증 병합** — 이름 규칙으로 분리된 행 중 공식 채널로 같은 업체임이
 * 확인된 slug들을 묶는다. 이름 규칙보다 먼저 적용된다.
 *
 * 등재 기준:
 *   1. 양쪽 slug가 **각각 독립적으로** 같은 공식 채널(사이트·인스타)을 가리킨다.
 *   2. 같은 지역의 같은 업체임이 확인됐다.
 *   3. 다른 지역/지점 slug는 이 그룹에 넣지 않는다.
 *
 * 판정 근거: `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`
 * 원본 확인: `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md` (2026-07-30 행 단위 검증 병합)
 */
export const VERIFIED_VENDOR_IDENTITY_BY_SLUG: ReadonlyMap<string, string> = new Map<string, string>([
  // 랑게 서울 — 둘 다 @langhe_official
  ["studio-ingest-8b66b01259700071", "studio|verified-row|랑게서울"],
  ["studio-ingest-712748b50059a490", "studio|verified-row|랑게서울"],
  // 전라 slug(studio-ingest-ad55657917fc0fc8)는 @langhe_gj로 다른 업체이므로 여기 안 넣음

  // 라망 서울 — 둘 다 lamantstudio.co.kr, @lamantstudio_official
  ["studio-ingest-ee80fe60805b12d1", "studio|verified-row|라망서울"],
  ["studio-ingest-d0d04f7ed9330369", "studio|verified-row|라망서울"],
  // 전주 slug(studio-ingest-59a8e3a6c75781c0)는 @lamantstudio_jeonju로 다른 업체이므로 여기 안 넣음
]);

/**
 * slug로 행 단위 검증 그룹을 조회한다.
 * 등록된 slug면 그룹 ID를 반환하고, 아니면 null을 반환한다.
 */
export function verifiedVendorIdentityGroup(slug: string): string | null {
  return VERIFIED_VENDOR_IDENTITY_BY_SLUG.get(slug) ?? null;
}

/**
 * 같은 행 단위 검증 그룹에 속하는 slug 집합을 반환한다.
 * 상세 조회에서 형제 행을 찾을 때 사용한다.
 */
export function verifiedVendorIdentitySlugs(slug: string): ReadonlySet<string> | null {
  const groupId = VERIFIED_VENDOR_IDENTITY_BY_SLUG.get(slug);
  if (!groupId) return null;
  const slugs = new Set<string>();
  for (const [s, g] of VERIFIED_VENDOR_IDENTITY_BY_SLUG) {
    if (g === groupId) slugs.add(s);
  }
  return slugs;
}

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
  // 테레지아: 2026-07-30 재감사에서 제거됨. 강남 논현 @teresia_studio ↔ 천안 불당
  // @teresia_cheonan으로 서로 다른 지점이다.
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
  // 버드투블룸: 2026-07-30 재감사에서 제거됨. 근거 자체가 청담 본점과 인천 남동 지점을
  // 함께 인정하여 공시 행별 지점 귀속 확인 전 병합 불가.
  ["studio|헤이스스튜디오", "헤이스"], // 서초 내곡동
  ["studio|st정우스튜디오", "st정우"], // (주)에스티정우 청담 — region 충청은 대행사 지역
  // ── 4차 (2026-08-18): 공식 채널 독립 확인 병합 ────────────────────────────
  // 2026-07-27에 "지역 태그"로 잘못 분류된 쌍. 실제로는 패키지/결제 표기였고,
  // 공식 사이트에서 같은 업체임이 확인됐다.
  ["studio|st정우러블리슈가제이", "st정우"], // stjungwoo.co.kr에 LOVELY·SUGA J 둘 다 있음.
  // (주)에스티정우, 서울 강남구 청담동 22-9 / 선릉로148길 16-1, 02-511-0901
  ["dress|엔조최재훈샵결재", "엔조최재훈"], // choijaehoon.co.kr ENZO CHOIJAEHOON
  // [샵결재]는 요즘웨딩 결제 경로 표기. 서울 강남구 선릉로158길 14-3, 02-544-1272
  ["dress|메라키웨딩", "메라키"], // 강남 학동로 137-7
  ["dress|장다인웨딩", "장다인"], // 강남 선릉로135길 6 · 02-547-5568
  ["dress|폴라리스웨딩", "폴라리스"], // 강남 선릉로 731
  ["dress|플로렌스웨딩", "플로렌스"], // 청담

  // ── 3차 (2026-08-05): 원본 셀 문맥이 스스로 증명하는 표기 차이 ──────────────
  // 위 1·2차와 근거 종류가 다르다. 공식 채널이 아니라 **공시 원본 xlsx 자신이**
  // 두 표기를 같은 것으로 쓴 경우다. 채널 확인보다 약한 근거가 아니라 다른 축이며,
  // 반증 조건도 명확하다 — 한 파일이 두 표기를 각각 독립 행으로 올렸으면 다른 업체다.
  // 253파일 전수 스캔에서 아래 전부 동시게재 0건을 확인했다.
  // 판정 기록: docs/operations/VENDOR_IDENTITY_REVIEW_2026-08-05.md

  // 철자 흔들림(처/쳐, 조/죠). 같은 작성자가 한 파일 안에서 혼용한다.
  ["dress|시그니쳐엘리자베스", "시그니처엘리자베스"], // 케이트웨딩플랜 정책셀이 같은 상품을 '시그니처'로 적음
  ["dress|죠슈아벨브라이덜", "조슈아벨브라이덜"], // 플랜온웨딩이 한 파일에서 처/쳐·조/죠 혼용
  ["makeup|컬쳐앤네이쳐", "컬처앤네이처"], // 위와 같은 플랜온웨딩 파일 (근거 간접 — medium)

  // 로마자 병기·약칭. 괄호 안이 본체의 다른 표기일 뿐이다.
  ["makeup|로쉬rosh", "로쉬"], // 제이웨딩 셀 원문이 '로쉬\n(rosh)' — 줄바꿈 로마자 병기
  ["makeup|밈mimm", "밈"], // 아이웨딩 '밈mimm' · 레브웨딩 '밈(MIMM)' (1음절이라 medium)
  ["makeup|정남jungnam", "정남"], // 아이웨딩 770,000 = 케이트웨딩플랜 정남 본식 770,000
  ["studio|바로오늘이그날바오그", "바로오늘이그날"], // 베리굿웨딩이 '바오그스튜디오'를 같은 스펙·가격으로 단독 게재

  // 형제 지점이 없는 '본점'은 구분자가 아니라 주석이다.
  // (형제가 실재하는 꼼나나는 정반대로 분리 유지한다 — VENDOR_BRANCHES 참고.)
  ["makeup|알루본점", "알루"], // 알루 6행 중 라벨은 웨딩두잇 1행뿐, 나머지 5곳 전부 무표기

  // 상호 변경. 원본 셀에 "…에서 상호명 변경"이라고 적혀 있다(추론 아님).
  ["dress|레이첼웨딩", "르네아뜰리에"], // 다이렉트결혼준비 '르네아뜰리에 (레이첼웨딩에서 상호명 변경)'
  ["dress|마틴드아뜰리에", "마틴드마리에"], // 다이렉트결혼준비 '마틴드마리에 (마틴드아뜰리에서 상호명 변경)'
  ["dress|컬렉트비", "이브스더데이"], // 요즘웨딩 '이브스더데이 (구.컬렉트비)'

  // 같은 파일을 두 번 받은 사본. 원본과 **sha256이 완전히 같고**(0afd7d0a…) 추출
  // 결과도 문자 단위로 동일한데 유닛 2개로 세어져 예식장 카드가 두 장이 됐다.
  // 정본 스캐너에는 이걸 잡는 게이트(duplicate_source_content)가 있는데, 실제
  // 적재를 만든 임시 스크립트가 그 게이트 없이 돌았다.
  ["hall|셀레네하우스웨딩천안청주점1", "셀레네하우스웨딩천안청주점"],
]);

/**
 * 확인된 **지점**. 병합하지 않고 브랜드로 묶기만 한다.
 *
 * 지점을 합치면 안 된다는 건 데이터로 확인됐다 — 같은 대행사가 같은 base_spec으로
 * 올린 `바시움`(154만)과 `바시움 삼성점`(132만)이 22만원 다르다. 지점은 다른 샵이다.
 *
 * 그런데 지점 표기 **위치**가 대행사마다 달라서 같은 지점이 여러 장으로 갈렸다.
 * `[수원] 헤움`((주)레브웨딩)과 `헤움_수원점`(아이웨딩)이 그 예다. 정규화만으로는
 * `수원헤움` ≠ `헤움수원점`이라 안 묶인다. 그래서 (브랜드, 지점)을 신원 키로 쓴다.
 *
 * `regionCode`는 **샵 소재지**다. 목록은 카드 지역을 대행사 지역으로 채우는데,
 * 지점 라벨은 이 데이터셋에서 샵의 실제 위치를 알려주는 유일한 정보다
 * (레브웨딩 원본 시트는 카테고리 탭이고 지역 열이 없으며, 라벨행이 시트 끝에
 * 도시별로 붙은 부록 구조다 — 그 대행사의 지역 지사 공시는 원본 전체에 0건).
 * 이게 없으면 강원 필터를 고른 커플에게 강릉 소재 샵이 안 보인다.
 */
export type VendorBranch = {
  /** 지점을 뺀 브랜드 이름(정규화형). 신원 키와 형제 조회의 기준이다. */
  readonly brand: string;
  /** 지점 라벨. 같은 브랜드 안에서 지점을 가르는 값이다. */
  readonly branch: string;
  /** 샵 소재지. 지역명이 아닌 라벨(본점·힐튼점 등)은 null이다. */
  readonly regionCode: string | null;
};

export const VENDOR_BRANCHES: ReadonlyMap<string, VendorBranch> = new Map<string, VendorBranch>([
  // 같은 지점인데 표기 위치가 달라 갈려 있던 것 — 아래 둘은 한 카드로 묶인다.
  ["makeup|수원헤움", { brand: "헤움", branch: "수원", regionCode: "gyeonggi" }],
  ["makeup|헤움수원점", { brand: "헤움", branch: "수원", regionCode: "gyeonggi" }],

  // 형제 지점이 실재해 맨이름이 어느 지점인지 알 수 없는 브랜드들.
  ["makeup|꼼나나본점", { brand: "꼼나나", branch: "본점", regionCode: null }],
  ["makeup|꼼나나청담", { brand: "꼼나나", branch: "청담", regionCode: null }],
  ["makeup|수원꼼나나", { brand: "꼼나나", branch: "수원", regionCode: "gyeonggi" }],
  ["studio|천안s스튜디오", { brand: "s스튜디오", branch: "천안", regionCode: "chungcheong" }],
  ["studio|s스튜디오울산", { brand: "s스튜디오", branch: "울산", regionCode: "ulsan" }],
  ["studio|바시움삼성점", { brand: "바시움", branch: "삼성", regionCode: null }],
  ["makeup|조이187인스타점", { brand: "조이187", branch: "인스타", regionCode: null }],
  ["makeup|조이187청담점", { brand: "조이187", branch: "청담", regionCode: null }],

  // (주)레브웨딩의 대괄호 지역 표기 — 전부 비서울이라 무표기 = 서울 기본이다.
  ["studio|천안아우라", { brand: "아우라", branch: "천안", regionCode: "chungcheong" }],
  ["studio|천안페레", { brand: "페레", branch: "천안", regionCode: "chungcheong" }],
  ["studio|청주비마이", { brand: "비마이", branch: "청주", regionCode: "chungcheong" }],
  ["studio|인천아우리", { brand: "아우리", branch: "인천", regionCode: "incheon" }],
  ["makeup|강릉더페트라", { brand: "더페트라", branch: "강릉", regionCode: "gangwon" }],
  ["makeup|강릉아틀리에도쿄", { brand: "아틀리에도쿄", branch: "강릉", regionCode: "gangwon" }],
  ["makeup|동해리원드블랑", { brand: "리원드블랑", branch: "동해", regionCode: "gangwon" }],
  ["makeup|동해오늘도예쁘다", { brand: "오늘도예쁘다", branch: "동해", regionCode: "gangwon" }],
  ["studio|강릉미유웨딩", { brand: "미유웨딩", branch: "강릉", regionCode: "gangwon" }],
  ["dress|강릉미유웨딩", { brand: "미유웨딩", branch: "강릉", regionCode: "gangwon" }],
  ["makeup|강릉미유웨딩", { brand: "미유웨딩", branch: "강릉", regionCode: "gangwon" }],
  ["dress|천안오브제웨딩", { brand: "오브제웨딩", branch: "천안", regionCode: "chungcheong" }],
  ["dress|천안제니브라이드", { brand: "제니브라이드", branch: "천안", regionCode: "chungcheong" }],
  ["dress|청주아델라브라이드", { brand: "아델라브라이드", branch: "청주", regionCode: "chungcheong" }],

  // 대행사가 붙인 지점명이지만 지역이 아닌 것.
  ["studio|아우라스튜디오천안점", { brand: "아우라스튜디오", branch: "천안", regionCode: "chungcheong" }],
]);

/**
 * 지점이 실재해서 **맨이름 카드가 어느 지점인지 알 수 없는** 브랜드.
 *
 * 실측: `꼼나나` 맨이름 4행 중 (주)블랑드봄은 본점 행과, 세인트플래닝은 청담 행과
 * 가격이 정확히 일치한다 — 즉 맨이름 행들의 귀속이 실제로 갈린다. 지금 화면의
 * `꼼나나 55만~178만`은 서로 다른 가게 가격을 한 범위로 합친 값이다.
 *
 * 합치지도 가르지도 못하는 상태이므로 화면에 그 사실을 드러내는 데 쓴다.
 * 판정이 아니라 관찰이라 "견적·시세에 판정 금지" 원칙과 어긋나지 않는다.
 */
export const VENDOR_BRANCH_AMBIGUOUS: ReadonlySet<string> = new Set<string>([
  "makeup|꼼나나",
  "makeup|조이187",
  "studio|s스튜디오",
  "studio|바시움",
  "makeup|헤움",
]);

export function vendorBranchOf(category: string, vendorName: string): VendorBranch | null {
  return VENDOR_BRANCHES.get(`${category}|${normalizeVendorName(vendorName)}`) ?? null;
}

/** 맨이름 카드가 어느 지점인지 확인되지 않았는가. 화면 표기용. */
export function hasUnverifiedBranch(category: string, vendorName: string): boolean {
  const normalized = normalizeVendorName(vendorName);
  if (VENDOR_BRANCHES.has(`${category}|${normalized}`)) return false;
  return VENDOR_BRANCH_AMBIGUOUS.has(`${category}|${canonicalVendorName(category, vendorName)}`);
}

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

/**
 * 같은 묶음인지 판정하는 **유일한** 기준.
 *
 * 목록(`vendorIdentityKey`)·상세 형제 조회(`loadVendorIdentityRows`)가 전부 이걸
 * 거쳐야 한다. 한 곳만 다른 규칙을 쓰면 "카드엔 대행사 4곳인데 눌러 보니 1곳"이
 * 다시 생긴다 — 지점 키를 목록에만 넣고 상세를 안 고치면 정확히 그 상태가 된다.
 */
export function vendorIdentityGroup(category: string, vendorName: string): string {
  // 확인된 지점은 브랜드가 같아도 다른 샵이다(같은 대행사·같은 base_spec인 바시움
  // 154만 ↔ 삼성점 132만). 반대로 지점 표기 **위치**는 대행사마다 달라서
  // 정규화만으로는 같은 지점끼리도 안 묶인다(`[수원] 헤움` ↔ `헤움_수원점`).
  const branch = vendorBranchOf(category, vendorName);
  if (branch) return `${branch.brand}#${branch.branch}`;
  return canonicalVendorName(category, vendorName);
}

export function vendorIdentityKey(
  category: PriceCategory,
  vendorName: string,
  vendorSlug: string,
): string {
  // 1. 행 단위 검증 그룹이 있으면 그것을 우선 사용한다.
  //    이름 규칙으로 분리된 행도 공식 채널로 같은 업체임이 확인된 slug끼리는 묶인다.
  const verifiedGroup = verifiedVendorIdentityGroup(vendorSlug);
  if (verifiedGroup) return verifiedGroup;

  // 2. 이름만 같고 실제로는 다른 업체 — 슬러그를 그대로 써서 분리를 유지한다.
  const canonical = canonicalVendorName(category, vendorName);
  if (!canonical || isSameNameDifferentBusiness(category, canonical)) {
    return `slug:${vendorSlug}`;
  }

  // 3. 일반적인 이름 기반 그룹
  return `${category}|${vendorIdentityGroup(category, vendorName)}`;
}

/**
 * 카드에 쓸 지역. 지점 라벨이 있으면 **샵 소재지**가 대행사 지역을 이긴다.
 *
 * 목록은 카드 지역을 offer(=대행사)의 지역으로 채운다. 지역은 대행사의 것이지
 * 샵의 것이 아니라서, 이름에 `[강릉]`이 붙은 샵이 서울로 잡혀 강원 필터에서
 * 사라진다. 라벨이 있는 건 그것을 쓴다.
 */
export function vendorRegionCodeOverride(
  category: string,
  vendorName: string,
): string | null {
  return vendorBranchOf(category, vendorName)?.regionCode ?? null;
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
  // 지점은 **브랜드**로 만든다 — `[수원] 헤움`으로 만든 패턴 `%수%원%헤%움%`은
  // 글자 순서 때문에 `헤움_수원점`을 못 잡는다. 후보를 넓게 긁고 최종 판정은
  // `vendorIdentityGroup`이 한다.
  const branch = category === undefined ? null : vendorBranchOf(category, vendorName);
  const normalized = branch
    ? branch.brand
    : (category === undefined
      ? normalizeVendorName(vendorName)
      : canonicalVendorName(category, vendorName));
  if (!normalized) return null;
  // 너무 긴 이름은 패턴이 커져 인덱스 없이 훑는 비용만 늘어난다. 앞부분만 써도
  // 후보를 좁히는 목적은 달성되고, 최종 판정은 JS 정규화 비교가 한다.
  const head = [...normalized].slice(0, IDENTITY_LIKE_MAX_LENGTH);
  const escaped = head.map((character) => character.replace(/([%_\\])/g, "\\$1"));
  return `%${escaped.join("%")}%`;
}
