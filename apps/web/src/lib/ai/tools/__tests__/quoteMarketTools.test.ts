import { describe, expect, it } from "vitest";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "../quoteMarketTools";

describe("quoteMarketTools", () => {
  it("서로 다른 조사 항목을 하나의 총비용으로 합산하지 않는다", () => {
    const result = executeGetMarketPrice({ category: "total", scope: "national" });

    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("총비용");
    expect(result.displayMessage).toContain("합산하지 않아요");
    expect(result.toolOutput).toMatchObject({ totalAvailable: false });
    expect(result.toolOutput).not.toHaveProperty("national");
    expect(result.toolOutput).not.toHaveProperty("seoul");
  });

  it("시장 가격은 조사월이 연결된 생성 데이터만 반환한다", () => {
    const result = executeGetMarketPrice({ category: "studio", scope: "seoul" });

    expect(result.success).toBe(true);
    expect(result.toolOutput).toHaveProperty("periodId");
    expect(result.toolOutput).toHaveProperty("periodLabel");
    expect(result.toolOutput).toHaveProperty("studioBasic");
    expect(result.toolOutput).toMatchObject({
      sourceName: "한국소비자원 참가격 결혼서비스 가격조사",
    });
    expect(result.toolOutput.sourceUrl).toMatch(/^https:\/\/price\.go\.kr\//);
    expect(result.toolOutput).not.toHaveProperty("options");
  });

  it("첫 단계 체크리스트 payload에 가격·비율·중요도를 넣지 않는다", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
      category: "sdm_package",
      region: "seoul",
      quote_price: 300,
      vendor_name: "테스트 스드메",
    });

    expect(result.success).toBe(true);
    expect(result.displayMessage).toBe("견적 포함 항목을 먼저 확인해주세요.");
    const output = result.toolOutput as { checklistItems: Array<Record<string, unknown>> };
    expect(output.checklistItems.length).toBeGreaterThan(0);
    for (const item of output.checklistItems) {
      expect(Object.keys(item).sort()).toEqual(
        ["category", "checkQuestion", "id", "name"].sort()
      );
      expect(item).not.toHaveProperty("severity");
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("usageRate");
    }
  });

  it("분석 결과도 확인 필요 항목만 반환하고 가격 비교·필수성 필드를 제거한다", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 300,
      included_items: ["원본 데이터 제공"],
    });

    expect(result.success).toBe(true);
    const output = result.toolOutput as Record<string, unknown>;
    expect(output).toHaveProperty("unconfirmedItems");
    expect(output).toHaveProperty("unconfirmedItemCount");
    for (const banned of [
      "missingItems",
      "missingCriticalCount",
      "missingHighCount",
      "missingMediumCount",
      "marketMedian",
      "marketComparatorLabel",
      "priceDiff",
      "priceDiffPercent",
    ]) {
      expect(output[banned], banned).toBeUndefined();
    }
    expect(result.displayMessage).toContain("포함 여부");
  });

  it("0 이하 견적 금액은 기존 사용자 안내로 거부한다", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 0,
    });

    expect(result.success).toBe(false);
    expect(result.displayMessage).toBe("견적 금액을 만원 단위 숫자로 다시 알려주세요.");
  });
});
