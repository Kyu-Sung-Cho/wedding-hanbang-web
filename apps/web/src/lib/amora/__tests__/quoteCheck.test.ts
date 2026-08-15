import { describe, expect, it } from "vitest";
import { analyzeAmoraQuoteCheck, getQuoteCheckItems } from "../quoteCheck";
import type { AmoraQuoteCategory, AmoraQuoteRegion } from "../quoteCheck";
import type { PriceCatalog, PriceOffer, PriceVendor } from "@/lib/price/catalog";

const REGIONS: AmoraQuoteRegion[] = ["seoul", "gyeonggi", "busan", "daegu", "other"];
const CATEGORIES: AmoraQuoteCategory[] = ["sdm_package", "studio", "dress", "makeup"];

function analyze(category: AmoraQuoteCategory, region: AmoraQuoteRegion, price: number) {
  return analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: price,
    includedItemIds: [],
  });
}

function publicCatalog(
  entries: Array<{
    id: string;
    category?: "studio" | "dress" | "makeup" | "hall";
    regionCode: string | null;
    minimumKrw: number | null;
    agencyId?: string | null;
  }>,
): PriceCatalog {
  const categories: PriceCatalog["categories"] = {
    studio: [],
    dress: [],
    makeup: [],
    hall: [],
  };

  for (const entry of entries) {
    const category = entry.category ?? "studio";
    const offer: PriceOffer = {
      id: `offer-${entry.id}`,
      agencyId: entry.agencyId === undefined ? `agency-${entry.id}` : entry.agencyId,
      agencyName: "공시 대행사",
      regionCode: entry.regionCode,
      minimumKrw: entry.minimumKrw,
      maximumKrw: entry.minimumKrw,
      priceNote: null,
      baseSpec: "기본 구성",
      options: [],
    };
    const vendor: PriceVendor = {
      id: `vendor-${entry.id}`,
      slug: `vendor-${entry.id}`,
      name: `공시 업체 ${entry.id}`,
      aliases: [],
      category,
      regionCode: entry.regionCode,
      regionCodes: entry.regionCode ? [entry.regionCode] : [],
      offers: [offer],
    };
    categories[category].push(vendor);
  }

  return {
    periodLabel: "2026Q3",
    categories,
    counts: {
      studio: categories.studio.length,
      dress: categories.dress.length,
      makeup: categories.makeup.length,
      hall: categories.hall.length,
    },
    agencies: [],
  };
}

describe("런타임 공시가 경계", () => {
  it("서울 스튜디오의 비교 가능한 공시 기본가 하한만으로 중간값을 계산한다", () => {
    const catalog = publicCatalog([
      { id: "seoul-low", regionCode: "seoul_gangnam3", minimumKrw: 1_000_000 },
      { id: "seoul-mid", regionCode: "seoul_etc", minimumKrw: 2_000_000 },
      { id: "seoul-high", regionCode: "seoul_etc", minimumKrw: 3_000_000 },
      { id: "busan", regionCode: "busan", minimumKrw: 9_000_000 },
      { id: "direct", regionCode: "seoul_etc", minimumKrw: 500_000, agencyId: null },
    ]);

    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 250,
      includedItemIds: [],
    }, catalog);

    expect(result.marketMedianManwon).toBe(200);
    expect(result.priceDiffPercent).toBe(25);
    expect(result.marketComparatorLabel).toContain("공시 기본가 하한 중간값");
    expect(result.marketEvidence).toMatchObject({
      status: "available",
      observationCount: 3,
      vendorCount: 3,
      source: "한국소비자원 참가격",
      sourcePeriod: "2025년 11월",
      regionLabel: "서울",
      calculation: "비교 가능한 업체·대행사별 공시 기본가 하한 3건의 중간값",
      comparisonBasis: "공시 행의 price_min_krw만 사용하며 기본 구성·옵션·부가세 조건을 합산하거나 보정하지 않음",
    });
    expect(result.marketEvidence.sourceUrl).toMatch(/^https:\/\/price\.go\.kr\//u);
    expect(JSON.stringify(result.marketEvidence)).not.toContain("2026Q3");
  });

  it("소스에 고정한 중위가로 가격을 판정하지 않는다", () => {
    for (const category of CATEGORIES) {
      for (const region of REGIONS) {
        const result = analyze(category, region, 300);
        expect(result.marketMedianManwon, `${category}/${region}`).toBe(0);
        expect(result.priceDiffPercent, `${category}/${region}`).toBe(0);
        expect(result.marketComparatorLabel).toContain("최신 공시가 확인 필요");
      }
    }
  });

  it("체크리스트 출처 문구가 가격 비교를 하지 않았음을 명시한다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.sourceNote).toContain("가격의 적정성을 판정하지 않습니다");
    expect(result.sourceNote).toContain("업체별 공시가");
    expect(result.sourceNote).not.toContain("price.go.kr");
  });
});

describe("판정 없음 — 사실만 노출", () => {
  it("결과에 점수·등급·판정·가격대 분류·추정액 필드가 없다", () => {
    const result = analyze("sdm_package", "seoul", 300) as unknown as Record<string, unknown>;
    for (const banned of [
      "score",
      "grade",
      "verdict",
      "priceTier",
      "priceTierAutoInferred",
      "showPriceComparison",
      "redFlags",
      "estimatedHiddenMinManwon",
      "estimatedHiddenMaxManwon",
      "estimatedTotalMinManwon",
      "estimatedTotalMaxManwon",
    ]) {
      expect(result[banned], `${banned} 필드는 제거되어야 함`).toBeUndefined();
    }

    for (const item of analyze("sdm_package", "seoul", 300).missingItems) {
      const publicItem = item as unknown as Record<string, unknown>;
      expect(publicItem.priceManwon).toBeUndefined();
      expect(publicItem.usageRatePercent).toBeUndefined();
    }
  });

  it("요약 문구가 개수 사실만 말하고 평가 단어를 쓰지 않는다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.summaryTitle).toContain("확인할 항목");
    for (const judgment of ["위험", "안전", "바가지", "등급", "점수"]) {
      expect(result.summaryTitle).not.toContain(judgment);
      expect(result.summaryText).not.toContain(judgment);
    }
    expect(result.summaryText).not.toContain("174만원");
    expect(result.sourceNote).not.toContain("숨은비용");
    expect(result.sourceNote).toContain("업체별 공시가");
  });
});

describe("체크리스트 일관성", () => {
  it("사용자에게 보여주는 항목은 업계 용어를 쉬운 말로 바꾼다", () => {
    const banned =
      /스드메|본식|폐백|상견례|헬퍼|컨펌|얼리스타트|혼주|신랑|원판|피팅|원본 데이터|전체.*사진 파일|사진 파일.*전체/;
    for (const item of getQuoteCheckItems("sdm_package", "seoul")) {
      for (const text of [item.name, item.checkQuestion, item.reason, item.disguise]) {
        expect(text, `${item.id}: ${text}`).not.toMatch(banned);
      }
    }
  });

  it("항목을 전부 체크하면 미확인 카운트 0 + 질문 0개 + 완료 요약", () => {
    const allIds = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: allIds,
    });
    expect(result.missingCriticalCount + result.missingHighCount + result.missingMediumCount).toBe(0);
    expect(result.contractQuestions).toHaveLength(0);
    expect(result.summaryTitle).toContain("모든 항목");
  });

  it("이용 계획 없음은 확인 필요 항목으로 세지 않는다", () => {
    const items = getQuoteCheckItems("studio", "seoul");
    const included = items.slice(0, 2).map((item) => item.id);
    const notNeeded = items.slice(2).map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 150,
      includedItemIds: included,
      notNeededItemIds: notNeeded,
    });

    expect(result.missingItems).toHaveLength(0);
    expect(result.includedItems).toHaveLength(included.length);
    expect(result.notNeededItems).toHaveLength(notNeeded.length);
    expect(result.notNeededItemCount).toBe(notNeeded.length);
    expect(result.summaryText).toContain(`이용 계획 없음 ${notNeeded.length}개`);
  });

  it("아무것도 체크 안 하면 먼저·함께 확인할 질문이 최대 6개 생성된다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.missingCriticalCount).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeLessThanOrEqual(6);
  });

  it("포함/누락 분할이 입력과 일치한다", () => {
    const items = getQuoteCheckItems("studio", "seoul");
    const half = items.slice(0, Math.floor(items.length / 2)).map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 150,
      includedItemIds: half,
    });
    expect(result.checkedItemCount).toBe(half.length);
    expect(
      result.includedItems.length + result.notNeededItems.length + result.missingItems.length,
    ).toBe(items.length);
  });

  it("묶음 견적에 관계없는 공통 준비물과 중복 항목을 노출하지 않는다", () => {
    const ids = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    expect(ids).not.toContain("common_pyebaek");
    expect(ids).not.toContain("common_wedding_car");
    expect(ids).not.toContain("common_thank_you_gift");
    expect(ids).not.toContain("dress_mini");
    expect(ids).not.toContain("makeup_nail");
    expect(ids).not.toContain("makeup_corsage");
  });

  it("업체에 보낼 질문도 과거 업계 용어 초안을 노출하지 않는다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.contractQuestions.join("\n"))
      .not.toMatch(
        /원본 데이터|본식|헬퍼|피팅|혼주|신랑|컨펌|얼리|전체.*사진 파일|사진 파일.*전체/,
      );
    expect(result.contractQuestions.every((question) => question.endsWith("?"))).toBe(true);
  });
});
