import { describe, expect, it, vi } from "vitest";
import type { PriceCatalog, PriceCategory } from "@/lib/price/catalog";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "../quoteMarketTools";
import { WEDDING_TOOLS } from "../../tools";
import {
  bindCanonicalQuoteAnalysisInput,
  parseCanonicalQuoteAnalysisSelection,
} from "../../quoteAnalysisSelection";

function catalogWithPrices(
  category: PriceCategory,
  prices: number[],
  regionCode = "seoul_etc",
): PriceCatalog {
  const categories: PriceCatalog["categories"] = {
    studio: [],
    dress: [],
    makeup: [],
    hall: [],
  };
  categories[category] = prices.map((minimumKrw, index) => ({
    id: `vendor-${index}`,
    slug: `vendor-${index}`,
    name: `공시 업체 ${index}`,
    aliases: [],
    category,
    regionCode,
    regionCodes: [regionCode],
    offers: [{
      id: `offer-${index}`,
      agencyId: `agency-${index}`,
      agencyName: `공시 대행사 ${index}`,
      regionCode,
      minimumKrw,
      maximumKrw: minimumKrw,
      priceNote: null,
      baseSpec: "기본 구성",
      options: [],
    }],
  }));
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

describe("quoteMarketTools", () => {
  it("describes the public-price calculation without claiming an official average or market price", () => {
    const tool = WEDDING_TOOLS.find((candidate) => candidate.name === "get_market_price");

    expect(tool?.description).toContain("공시 기본가 하한");
    expect(tool?.description).toContain("아모라가 계산한");
    expect(tool?.description).toContain("3곳 이상");
    expect(tool?.description).not.toContain("공식 평균");
    expect(tool?.description).not.toContain("시세");
  });

  it("asks the public catalog loader for only the requested price category", async () => {
    const loader = vi.fn(async () => (
      catalogWithPrices("studio", [1_000_000, 2_000_000, 3_000_000])
    ));

    await executeGetMarketPrice({ category: "studio", scope: "seoul" }, loader);

    expect(loader).toHaveBeenCalledWith(["studio"]);
  });

  it("returns a source-bound public-price benchmark instead of only redirecting to /price", async () => {
    const result = await executeGetMarketPrice(
      { category: "studio", scope: "seoul" },
      async () => catalogWithPrices("studio", [1_000_000, 2_000_000, 3_000_000]),
    );

    expect(result.toolName).toBe("get_market_price");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("200만원");
    expect(result.displayMessage).toContain("공시 기본가 하한");
    expect(result.toolOutput).toMatchObject({
      status: "available",
      publicPath: "/price/studio",
      sourcePolicy: "reviewed_published_vendor_disclosures_only",
      benchmark: {
        medianManwon: 200,
        observationCount: 3,
        vendorCount: 3,
        source: "한국소비자원 참가격",
        sourcePeriod: "2025년 11월",
        regionLabel: "서울",
      },
    });
    expect((result.toolOutput.benchmark as { sourceUrl: string }).sourceUrl)
      .toMatch(/^https:\/\/price\.go\.kr\//u);
    expect(JSON.stringify(result.toolOutput)).not.toContain("2026Q3");
  });

  it("returns no price number when fewer than three independent vendors are comparable", async () => {
    const result = await executeGetMarketPrice(
      { category: "studio", scope: "seoul" },
      async () => catalogWithPrices("studio", [1_000_000, 2_000_000]),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      status: "insufficient_comparable_data",
      evidence: {
        status: "unavailable",
        unavailableReason: "insufficient_sample",
        observationCount: 2,
        vendorCount: 2,
      },
    });
    expect(result.toolOutput).not.toHaveProperty("benchmark");
    expect(result.displayMessage).not.toMatch(/\d[\d,]*만원/u);
  });

  it("fails closed without a price claim when the public catalog cannot be loaded", async () => {
    const result = await executeGetMarketPrice(
      { category: "dress", scope: "national" },
      async () => { throw new Error("catalog unavailable"); },
    );

    expect(result.success).toBe(false);
    expect(result.toolOutput).toMatchObject({
      status: "catalog_unavailable",
      publicPath: "/price/dress",
    });
    expect(result.toolOutput).not.toHaveProperty("benchmark");
    expect(result.displayMessage).toContain("숫자를 추정하지 않았");
    expect(result.displayMessage).not.toMatch(/\d[\d,]*만원/u);
  });

  it("returns SDM component evidence separately without inventing a package total", async () => {
    const studio = catalogWithPrices("studio", [1_000_000, 2_000_000, 3_000_000]);
    const dress = catalogWithPrices("dress", [2_000_000, 3_000_000, 4_000_000]);
    const makeup = catalogWithPrices("makeup", [500_000, 1_000_000, 1_500_000]);
    const catalog: PriceCatalog = {
      ...studio,
      categories: {
        ...studio.categories,
        dress: dress.categories.dress,
        makeup: makeup.categories.makeup,
      },
      counts: {
        ...studio.counts,
        dress: dress.counts.dress,
        makeup: makeup.counts.makeup,
      },
    };

    const result = await executeGetMarketPrice(
      { category: "sdm", scope: "seoul" },
      async () => catalog,
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      status: "available_by_component",
      benchmarks: {
        studio: { medianManwon: 200, observationCount: 3 },
        dress: { medianManwon: 300, observationCount: 3 },
        makeup: { medianManwon: 100, observationCount: 3 },
      },
    });
    expect(result.displayMessage).toContain("묶음 합계로 더하지 않았어요");
    expect(result.toolOutput).not.toHaveProperty("combinedMedianManwon");
    expect(result.toolOutput).not.toHaveProperty("totalManwon");
  });

  it("does not fabricate a seasonal benchmark after the static dataset is retired", async () => {
    const result = await executeGetMarketPrice({ category: "seasonal" });

    expect(result.toolOutput).toMatchObject({ publicPath: "/price" });
    expect(result.displayMessage).not.toContain("중간값");
  });

  it("attaches the same public-price evidence to a completed quote analysis", async () => {
    const result = await executeAnalyzeQuoteWithTrustEngine(
      {
        category: "studio",
        region: "seoul",
        quote_price: 250,
        checklist_confirmed: true,
      },
      async () => catalogWithPrices("studio", [1_000_000, 2_000_000, 3_000_000]),
    );

    expect(result.success).toBe(true);
    expect(result.toolOutput).toMatchObject({
      marketMedian: 200,
      priceDiff: 50,
      priceDiffPercent: 25,
      marketEvidence: {
        status: "available",
        observationCount: 3,
        vendorCount: 3,
        source: "한국소비자원 참가격",
        sourcePeriod: "2025년 11월",
      },
    });
    expect((result.toolOutput.marketEvidence as { sourceUrl: string }).sourceUrl)
      .toMatch(/^https:\/\/price\.go\.kr\//u);
  });

  it("asks for checklist items before quote analysis when included items are missing", async () => {
    const result = await executeAnalyzeQuoteWithTrustEngine({
      category: "sdm_package",
      region: "seoul",
      quote_price: 300,
      vendor_name: "테스트 스드메",
    });

    expect(result.toolName).toBe("analyze_quote");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("견적 포함 항목을 먼저 확인해주세요.");
    expect(result.toolOutput).toMatchObject({
      mode: "checklist",
      category: "sdm_package",
      region: "seoul",
      vendorName: "테스트 스드메",
    });
  });

  it("keeps provider-invented quote selections out of the executor without a canonical tag", async () => {
    const input = bindCanonicalQuoteAnalysisInput({
      category: "studio",
      region: "seoul",
      quote_price: 300,
      included_items: ["야외 촬영"],
      not_needed_items: ["보정해 주는 사진 수"],
      checklist_confirmed: true,
    }, parseCanonicalQuoteAnalysisSelection("이 견적을 확인해줘"));

    const result = await executeAnalyzeQuoteWithTrustEngine(input);

    expect(result.toolOutput).toMatchObject({ mode: "checklist" });
    expect(result.displayMessage).toBe("견적 포함 항목을 먼저 확인해주세요.");
  });

  it("rejects non-positive quote prices with the existing user-facing message", async () => {
    const result = await executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 0,
    });

    expect(result.toolName).toBe("analyze_quote");
    expect(result.success).toBe(false);
    expect(result.displayMessage).toBe("견적 금액을 만원 단위 숫자로 다시 알려주세요.");
    expect(result.toolOutput).toMatchObject({
      error: "quote_price must be a positive number.",
    });
  });

  it("does not report user-declared not-needed items as unconfirmed", async () => {
    const first = await executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 300,
    });
    const checklist = first.toolOutput as {
      checklistItems: Array<{ id: string; name: string }>;
    };
    const notNeeded = checklist.checklistItems[0];
    const result = await executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 300,
      included_items: [],
      not_needed_items: [notNeeded.name],
      checklist_confirmed: true,
    });
    const output = result.toolOutput as {
      missingItems: Array<{ name: string }>;
      notNeededItems: Array<{ name: string }>;
    };

    expect(result.success).toBe(true);
    expect(output.notNeededItems.map((item) => item.name)).toContain(notNeeded.name);
    expect(output.missingItems.map((item) => item.name)).not.toContain(notNeeded.name);
  });

  it("can finish the second step even when every item remains unconfirmed", async () => {
    const result = await executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 300,
      included_items: [],
      not_needed_items: [],
      checklist_confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.toolOutput).not.toMatchObject({ mode: "checklist" });
  });
});
