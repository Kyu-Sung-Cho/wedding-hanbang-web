import { describe, expect, it } from "vitest";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "../quoteMarketTools";
import {
  OFF_PEAK_WEDDING_MONTHS_LABEL,
  PEAK_WEDDING_MONTHS_LABEL,
} from "@/constants/weddingSeasonality";

describe("quoteMarketTools", () => {
  it("keeps market price tool output shape", () => {
    const result = executeGetMarketPrice({ category: "total", scope: "national" });

    expect(result.toolName).toBe("get_market_price");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("평균 총 계약금액");
    expect(result.displayMessage).toContain("서울(강남)");
    expect(result.displayMessage).toContain("서울(강남외)");
    expect(result.displayMessage).not.toContain("서울 평균");
    expect(result.toolOutput).toHaveProperty("national");
    expect(result.toolOutput).toHaveProperty("seoulGangnam");
    expect(result.toolOutput).toHaveProperty("seoulOther");
    expect(result.toolOutput).toMatchObject({
      sourceUrl: "https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do",
    });
  });

  it("describes peak and off-peak months from the shared wedding calendar", () => {
    const result = executeGetMarketPrice({ category: "seasonal" });

    expect(result.displayMessage).toContain("예식장 필수품목 표본 중간값");
    expect(result.displayMessage).toContain(`성수기 (${PEAK_WEDDING_MONTHS_LABEL})`);
    expect(result.displayMessage).toContain(`비수기 (${OFF_PEAK_WEDDING_MONTHS_LABEL})`);
    expect(result.displayMessage).toContain("할인이나 절약액을 보장하지 않아요");
    expect(result.displayMessage).not.toContain("비수기 절약");
  });

  it("asks for checklist items before quote analysis when included items are missing", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
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

  it("rejects non-positive quote prices with the existing user-facing message", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
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
});
