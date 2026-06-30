import { describe, expect, it } from "vitest";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "../quoteMarketTools";

describe("quoteMarketTools", () => {
  it("keeps market price tool output shape", () => {
    const result = executeGetMarketPrice({ category: "total", scope: "national" });

    expect(result.toolName).toBe("get_market_price");
    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("기준 총 비용");
    expect(result.toolOutput).toHaveProperty("national");
    expect(result.toolOutput).toHaveProperty("seoul");
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
