import { describe, expect, it } from "vitest";

import mergeEvidence from "../../../../../../docs/operations/evidence/vendor-merge-evidence-2026-07-28.json";
import {
  SAME_BUSINESS_DIFFERENT_NAME,
  SAME_NAME_DIFFERENT_BUSINESS,
  VERIFIED_VENDOR_IDENTITY_BY_SLUG,
  canonicalVendorName,
  normalizeVendorName,
  verifiedVendorIdentitySlugs,
  vendorIdentityKey,
  vendorIdentityLikePattern,
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
  it("서울 랑게 두 행만 한 업체로 모으고 전라 랑게는 분리한다", () => {
    const seoulEtc = vendorIdentityKey(
      "studio",
      "랑게",
      "studio-ingest-8b66b01259700071",
    );
    const seoulGangnam = vendorIdentityKey(
      "studio",
      "랑게",
      "studio-ingest-712748b50059a490",
    );
    const jeolla = vendorIdentityKey(
      "studio",
      "랑게",
      "studio-ingest-ad55657917fc0fc8",
    );

    expect(seoulEtc).toBe(seoulGangnam);
    expect(jeolla).not.toBe(seoulEtc);
  });

  it("서울 라망 두 표기만 한 업체로 모으고 전주 라망은 분리한다", () => {
    const seoulBase = vendorIdentityKey(
      "studio",
      "라망",
      "studio-ingest-ee80fe60805b12d1",
    );
    const seoulVariant = vendorIdentityKey(
      "studio",
      "라망스튜디오",
      "studio-ingest-d0d04f7ed9330369",
    );
    const jeonju = vendorIdentityKey(
      "studio",
      "라망",
      "studio-ingest-59a8e3a6c75781c0",
    );

    expect(seoulBase).toBe(seoulVariant);
    expect(jeonju).not.toBe(seoulBase);
  });

  it("상세 조회가 검증된 행 그룹의 slug만 정확히 요청할 수 있다", () => {
    expect(
      verifiedVendorIdentitySlugs(
        "studio",
        "studio-ingest-ee80fe60805b12d1",
      ),
    ).toEqual([
      "studio-ingest-d0d04f7ed9330369",
      "studio-ingest-ee80fe60805b12d1",
    ]);
    expect(
      verifiedVendorIdentitySlugs(
        "studio",
        "studio-ingest-59a8e3a6c75781c0",
      ),
    ).toBeNull();
  });

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

  it("확인된 24쌍이 실제로 한 그룹으로 묶인다", () => {
    // 목록 카드의 그룹 키가 같아야 한 장으로 나온다.
    const pairs: Array<[string, string, string]> = [
      ["studio", "가을", "가을스튜디오"],
      ["studio", "디하우스", "디하우스스튜디오"],
      ["studio", "메종드힐", "메종드힐 스튜디오"],
      ["studio", "탱자", "탱자 스튜디오"],
      ["dress", "루비나엘", "루비나엘웨딩"],
      ["dress", "아비가일", "아비가일웨딩"],
    ];
    for (const [category, base, variant] of pairs) {
      expect(
        vendorIdentityKey(category as never, variant, "slug-variant"),
        `${base} ↔ ${variant}가 안 묶인다`,
      ).toBe(vendorIdentityKey(category as never, base, "slug-base"));
    }
    expect(SAME_BUSINESS_DIFFERENT_NAME.size).toBe(24);
  });

  it("병합 코드의 키와 대표값이 보존된 근거 24건과 정확히 같다", () => {
    expect(mergeEvidence.mergedPairs).toBe(mergeEvidence.entries.length);
    expect(
      [...SAME_BUSINESS_DIFFERENT_NAME.entries()]
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual(
      mergeEvidence.entries
        .map(({ canonical, key }) => [
          key,
          normalizeVendorName(canonical),
        ] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    expect(mergeEvidence.removedFromMerge.map(({ key }) => key).sort()).toEqual([
      "studio|버드투블룸스튜디오",
      "studio|테레지아스튜디오",
    ]);
  });

  it("행 단위 병합 코드가 보존된 slug 근거와 정확히 같고 제외 행은 빠진다", () => {
    const evidenceEntries = mergeEvidence.verifiedRowScopedGroups.flatMap(
      ({ identity, rows }) => rows.map(({ category, slug }) => [
        `${category}|${slug}`,
        identity,
      ] as const),
    );

    expect(
      [...VERIFIED_VENDOR_IDENTITY_BY_SLUG.entries()]
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual(
      evidenceEntries.sort(([left], [right]) => left.localeCompare(right)),
    );
    for (const group of mergeEvidence.verifiedRowScopedGroups) {
      for (const { category, slug } of group.keptSeparateRows) {
        expect(
          VERIFIED_VENDOR_IDENTITY_BY_SLUG.has(`${category}|${slug}`),
          `분리 행이 병합표에 들어갔다: ${category}|${slug}`,
        ).toBe(false);
      }
    }
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
    // 테레지아는 강남 논현 본점(@teresia_studio)과 천안 불당점
    // (@teresia_cheonan)으로 근거 자체가 서로 다른 지점을 가리킨다.
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|테레지아스튜디오")).toBe(false);
    // 버드투블룸도 근거에 청담 본점과 인천 남동 지점이 함께 적혀 있다.
    // 어느 공시 행이 어느 지점인지 확인되기 전에는 이름 전체를 합치지 않는다.
    expect(SAME_BUSINESS_DIFFERENT_NAME.has("studio|버드투블룸스튜디오")).toBe(false);
  });
});
