import { describe, expect, it } from "vitest";

import {
  SAME_BUSINESS_DIFFERENT_NAME,
  SAME_NAME_DIFFERENT_BUSINESS,
  VERIFIED_VENDOR_IDENTITY_BY_SLUG,
  canonicalVendorName,
  normalizeVendorName,
  vendorIdentityKey,
  vendorIdentityLikePattern,
  verifiedVendorIdentityGroup,
  verifiedVendorIdentitySlugs,
} from "@/lib/price/vendorIdentity";

/**
 * 표기만 다른 같은 업체를 한 카드로 묶는 대응표.
 *
 * 정규화는 `(주)`와 공백·구두점만 지우므로 대행사가 카테고리 접미를 붙여 적은
 * `"가을"` ↔ `"가을스튜디오"`가 서로 다른 업체로 갈린다(2026-07-27 실측 79쌍).
 * 접미를 자동으로 떼는 규칙은 `"스튜디오고유"`처럼 접미가 이름의 일부인 업체를
 * 깨뜨리고 `"스튜디오"`라는 이름의 업체(실재 1곳) 때문에 과매칭이 폭발한다.
 * 그래서 근거로 확인한 건만 목록에 넣고, 그 목록이 지켜야 할 성질을 여기서 잠근다.
 */
describe("SAME_BUSINESS_DIFFERENT_NAME 대응표", () => {
  it("키는 정규화된 형태여야 한다 — 아니면 조회가 영원히 빗나간다", () => {
    for (const [key, canonical] of SAME_BUSINESS_DIFFERENT_NAME) {
      const [category, variant] = key.split("|");
      expect(category, `카테고리 없음: ${key}`).toBeTruthy();
      expect(
        normalizeVendorName(variant),
        `키가 정규화형이 아니다: ${key} — canonicalVendorName이 절대 못 찾는다`,
      ).toBe(variant);
      expect(
        normalizeVendorName(canonical),
        `대표 이름이 정규화형이 아니다: ${canonical}`,
      ).toBe(canonical);
      expect(variant, `자기 자신을 가리킨다: ${key}`).not.toBe(canonical);
    }
  });

  it("대표 이름이 다시 다른 이름으로 매핑되지 않는다 (한 단계만)", () => {
    // 체인이 생기면 방향에 따라 결과가 갈린다.
    for (const [key, canonical] of SAME_BUSINESS_DIFFERENT_NAME) {
      const category = key.split("|")[0];
      expect(
        SAME_BUSINESS_DIFFERENT_NAME.has(`${category}|${canonical}`),
        `체인: ${key} → ${canonical} → ...`,
      ).toBe(false);
    }
  });

  it("'이름만 같은 다른 업체'와 겹치지 않는다", () => {
    // 겹치면 한쪽은 합치라 하고 다른 쪽은 나누라 한다 — 판정이 모순된다.
    for (const [key, canonical] of SAME_BUSINESS_DIFFERENT_NAME) {
      const category = key.split("|")[0];
      expect(SAME_NAME_DIFFERENT_BUSINESS.has(key), `모순: ${key}`).toBe(false);
      expect(
        SAME_NAME_DIFFERENT_BUSINESS.has(`${category}|${canonical}`),
        `대표 이름이 분리 대상이다: ${category}|${canonical}`,
      ).toBe(false);
    }
  });

  it("확인된 37쌍이 실제로 한 그룹으로 묶인다", () => {
    // 목록 카드의 그룹 키가 같아야 한 장으로 나온다.
    const pairs: Array<[string, string, string]> = [
      ["studio", "가을", "가을스튜디오"],
      ["studio", "디하우스", "디하우스스튜디오"],
      ["studio", "메종드힐", "메종드힐 스튜디오"],
      ["studio", "탱자", "탱자 스튜디오"],
      ["dress", "루비나엘", "루비나엘웨딩"],
      ["dress", "아비가일", "아비가일웨딩"],
      // 3차(2026-08-05): 공시 원본 셀이 스스로 증명하는 표기 차이.
      ["dress", "시그니처엘리자베스", "시그니쳐엘리자베스"],
      ["makeup", "정남", "정남(Jungnam)"],
      ["studio", "바로오늘이그날", "바로오늘이그날(바오그)"],
      ["dress", "르네아뜰리에", "레이첼웨딩"],
    ];
    for (const [category, base, variant] of pairs) {
      expect(
        vendorIdentityKey(category as never, variant, "slug-variant"),
        `${base} ↔ ${variant}가 안 묶인다`,
      ).toBe(vendorIdentityKey(category as never, base, "slug-base"));
    }
    // 목록이 늘어난 것을 모르고 지나치지 않도록 개수를 잠근다.
    // 1차 16 + 2차 10 + 3차 11 + 사본중복 1(셀레네하우스웨딩) = 38
    // - 테레지아 1 (2026-07-30 재감사: 강남↔천안 다른 지점)
    // - 버드투블룸 1 (2026-07-30 재감사: 청담↔인천 행별 귀속 미확인)
    // = 36
    expect(SAME_BUSINESS_DIFFERENT_NAME.size).toBe(36);
  });

  it("형제 조회 패턴이 양방향으로 상대를 잡는다", () => {
    // 방문한 이름이 긴 쪽이면 그것으로 만든 패턴은 짧은 형제를 못 잡는다.
    // 그러면 "가을"에서는 병합되고 "가을스튜디오"에서는 안 되는 반쪽 상태가 된다.
    const matches = (pattern: string, name: string) => {
      const source = pattern
        .split("%")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${source}$`, "i").test(name);
    };

    for (const [base, variant] of [["가을", "가을스튜디오"], ["탱자", "탱자 스튜디오"]]) {
      for (const visited of [base, variant]) {
        const pattern = vendorIdentityLikePattern(visited, "studio")!;
        expect(pattern, `패턴 없음: ${visited}`).toBeTruthy();
        expect(matches(pattern, base), `${visited} 패턴이 "${base}"를 못 잡는다`).toBe(true);
        expect(matches(pattern, variant), `${visited} 패턴이 "${variant}"를 못 잡는다`).toBe(true);
      }
    }
  });

  it("목록에 없는 접미 차이는 계속 분리된다", () => {
    // 자동으로 접미를 떼면 다른 가게 가격이 한 카드에 섞인다. 근거 없는 병합 금지.
    expect(canonicalVendorName("studio", "메이 스튜디오")).toBe("메이스튜디오");
    expect(canonicalVendorName("studio", "메이")).toBe("메이");
    expect(vendorIdentityKey("studio" as never, "메이 스튜디오", "slug-a"))
      .not.toBe(vendorIdentityKey("studio" as never, "메이", "slug-b"));
  });

  it("지역이 다른 지점은 합치지 않는다", () => {
    // 같은 브랜드라도 지점은 다른 샵이고 가격도 다르다. 대괄호 지역 표기를
    // 분리 유지하는 것과 같은 원칙 — 지니어스(서울 ↔ 강릉)를 그래서 제외했다.
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|지니어스스튜디오")).toBe(false);
    expect(vendorIdentityKey("studio" as never, "지니어스 스튜디오", "slug-a"))
      .not.toBe(vendorIdentityKey("studio" as never, "지니어스", "slug-b"));
    expect(canonicalVendorName("studio", "[천안] 아우라")).not.toBe("아우라");
    // 헤이허니는 인스타 프로필이 '서울 부산 광주 웨딩 스튜디오'인 다지역 브랜드고,
    // 변형 행의 확인 근거가 광주 운영을 직접 가리킨다 — 같은 브랜드의 다른 지점이다.
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|헤이허니스튜디오")).toBe(false);
    // 루미에(서울 테헤란로 ↔ 안산 루미에웨딩스튜디오)는 실제로 두 업체가 확인됐다.
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|루미에스튜디오")).toBe(false);
  });
});

/**
 * 행 단위 검증 병합 — 이름 규칙으로 분리된 행 중 공식 채널로 같은 업체임이
 * 확인된 slug들을 묶는다. 이름 규칙보다 먼저 적용된다.
 *
 * 등재 근거: `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md` (2026-07-30 행 단위 검증 병합)
 * 증거 파일: `docs/operations/evidence/vendor-merge-evidence-2026-07-28.json`
 */
describe("VERIFIED_VENDOR_IDENTITY_BY_SLUG 행 단위 병합", () => {
  it("라망 서울 slugs는 한 카드로 묶인다", () => {
    // 라망은 SAME_NAME_DIFFERENT_BUSINESS에 있어 이름 규칙으로는 분리되지만,
    // 서울의 두 slug는 공식 사이트·인스타가 같아 한 카드여야 한다.
    const slugSeoulA = "studio-ingest-ee80fe60805b12d1"; // 라망
    const slugSeoulB = "studio-ingest-d0d04f7ed9330369"; // 라망스튜디오
    const slugJeonju = "studio-ingest-59a8e3a6c75781c0"; // 라망 전주 (@lamantstudio_jeonju)

    // 서울 slugs는 같은 그룹
    expect(vendorIdentityKey("studio" as never, "라망", slugSeoulA))
      .toBe(vendorIdentityKey("studio" as never, "라망스튜디오", slugSeoulB));

    // 전주 slug는 서울과 다른 그룹 (SAME_NAME_DIFFERENT_BUSINESS + 등록 안 됨)
    expect(vendorIdentityKey("studio" as never, "라망", slugJeonju))
      .not.toBe(vendorIdentityKey("studio" as never, "라망", slugSeoulA));
  });

  it("랑게 서울 slugs는 한 카드로 묶인다", () => {
    const slugSeoulA = "studio-ingest-8b66b01259700071";
    const slugSeoulB = "studio-ingest-712748b50059a490";
    const slugJeolla = "studio-ingest-ad55657917fc0fc8"; // @langhe_gj

    // 서울 slugs는 같은 그룹
    expect(vendorIdentityKey("studio" as never, "랑게", slugSeoulA))
      .toBe(vendorIdentityKey("studio" as never, "랑게", slugSeoulB));

    // 전라 slug는 서울과 다른 그룹
    expect(vendorIdentityKey("studio" as never, "랑게", slugJeolla))
      .not.toBe(vendorIdentityKey("studio" as never, "랑게", slugSeoulA));
  });

  it("verifiedVendorIdentityGroup은 등록된 slug만 그룹을 반환한다", () => {
    expect(verifiedVendorIdentityGroup("studio-ingest-ee80fe60805b12d1"))
      .toBe("studio|verified-row|라망서울");
    expect(verifiedVendorIdentityGroup("studio-ingest-59a8e3a6c75781c0"))
      .toBeNull(); // 전주 slug는 등록 안 됨
  });

  it("verifiedVendorIdentitySlugs는 같은 그룹의 slug 집합을 반환한다", () => {
    const slugs = verifiedVendorIdentitySlugs("studio-ingest-ee80fe60805b12d1");
    expect(slugs).not.toBeNull();
    expect(slugs!.has("studio-ingest-ee80fe60805b12d1")).toBe(true);
    expect(slugs!.has("studio-ingest-d0d04f7ed9330369")).toBe(true);
    expect(slugs!.size).toBe(2);

    // 등록 안 된 slug는 null
    expect(verifiedVendorIdentitySlugs("studio-ingest-59a8e3a6c75781c0")).toBeNull();
  });

  it("행 단위 병합 맵의 그룹 ID는 유효한 형식이다", () => {
    for (const [slug, groupId] of VERIFIED_VENDOR_IDENTITY_BY_SLUG) {
      expect(slug, "slug가 비어있다").toBeTruthy();
      expect(groupId, "그룹 ID가 비어있다").toBeTruthy();
      expect(groupId.startsWith("studio|verified-row|"), `잘못된 그룹 ID 형식: ${groupId}`).toBe(true);
    }
  });
});

/**
 * 2026-08-18 사람 검토에서 확인된 13개 SEPARATE 쌍.
 * 이 쌍들은 절대 병합되어서는 안 된다.
 */
describe("SEPARATE 쌍 병합 금지", () => {
  it("지역 지점 쌍은 병합되지 않는다 (대괄호 태그)", () => {
    // 아우라 ↔ [천안] 아우라 — 다른 지역 지점
    expect(vendorIdentityKey("studio" as never, "아우라", "slug-seoul"))
      .not.toBe(vendorIdentityKey("studio" as never, "[천안] 아우라", "slug-cheonan"));

    // 페레 ↔ [천안] 페레
    expect(vendorIdentityKey("studio" as never, "페레", "slug-seoul"))
      .not.toBe(vendorIdentityKey("studio" as never, "[천안] 페레", "slug-cheonan"));

    // 비마이 ↔ [청주] 비마이
    expect(vendorIdentityKey("studio" as never, "비마이", "slug-seoul"))
      .not.toBe(vendorIdentityKey("studio" as never, "[청주] 비마이", "slug-cheongju"));

    // 꼼나나 ↔ [수원] 꼼나나
    expect(vendorIdentityKey("makeup" as never, "꼼나나", "slug-seoul"))
      .not.toBe(vendorIdentityKey("makeup" as never, "[수원] 꼼나나", "slug-suwon"));

    // 더페트라 ↔ [강릉] 더페트라
    expect(vendorIdentityKey("makeup" as never, "더페트라", "slug-seoul"))
      .not.toBe(vendorIdentityKey("makeup" as never, "[강릉] 더페트라", "slug-gangneung"));
  });

  it("다른 지역 업체 쌍은 병합되지 않는다 (카테고리 접미)", () => {
    // 이 쌍들은 같은 이름이지만 다른 지역의 다른 업체로 확인됨

    // 고유 ↔ 고유 스튜디오 (여수 vs 광주) — 대행사 지역이 전혀 안 겹침
    expect(vendorIdentityKey("studio" as never, "고유", "slug-yeosu"))
      .not.toBe(vendorIdentityKey("studio" as never, "고유 스튜디오", "slug-gwangju"));

    // 라크마 ↔ 라크마 스튜디오 (여수 vs 서울 @lacmastudio)
    expect(vendorIdentityKey("studio" as never, "라크마", "slug-yeosu"))
      .not.toBe(vendorIdentityKey("studio" as never, "라크마 스튜디오", "slug-seoul"));

    // 메이 ↔ 메이 스튜디오 (강남 vs 강원)
    expect(vendorIdentityKey("studio" as never, "메이", "slug-gangnam"))
      .not.toBe(vendorIdentityKey("studio" as never, "메이 스튜디오", "slug-gangwon"));

    // 루미에 ↔ 루미에스튜디오 (서울 테헤란로 vs 안산)
    expect(vendorIdentityKey("studio" as never, "루미에", "slug-seoul"))
      .not.toBe(vendorIdentityKey("studio" as never, "루미에스튜디오", "slug-ansan"));

    // 소나르 ↔ 소나르스튜디오 (울산/전라 vs 안동)
    expect(vendorIdentityKey("studio" as never, "소나르", "slug-ulsan"))
      .not.toBe(vendorIdentityKey("studio" as never, "소나르스튜디오", "slug-andong"));

    // 지니어스 ↔ 지니어스 스튜디오 (서울 vs 강릉) — 이미 테스트됨
    // 헤이허니 ↔ 헤이허니 스튜디오 (서울 vs 광주) — 이미 테스트됨

    // 줄리의정원 ↔ 줄리의정원스튜디오 (청담 vs 광주)
    expect(vendorIdentityKey("studio" as never, "줄리의정원", "slug-cheongdam"))
      .not.toBe(vendorIdentityKey("studio" as never, "줄리의정원스튜디오", "slug-gwangju"));
  });

  it("SAME_BUSINESS_DIFFERENT_NAME에 분리해야 할 쌍이 없다", () => {
    // 지니어스, 헤이허니, 루미에가 SAME_BUSINESS_DIFFERENT_NAME에 잘못 등록되어 있으면 안 됨
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|지니어스스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|헤이허니스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|루미에스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|줄리의정원스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|소나르스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|라크마스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|고유스튜디오")).toBe(false);
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|메이스튜디오")).toBe(false);
    // 2026-07-30 재감사에서 제거된 쌍
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|테레지아스튜디오")).toBe(false); // 강남↔천안 다른 지점
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|버드투블룸스튜디오")).toBe(false); // 청담↔인천 행별 귀속 미확인
  });
});
