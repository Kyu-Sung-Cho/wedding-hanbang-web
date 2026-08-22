import { describe, expect, it } from "vitest";
import {
  executeAnalyzeQuoteWithTrustEngine,
  executeGetMarketPrice,
} from "../quoteMarketTools";

describe("quoteMarketTools", () => {
  // 이 두 테스트가 지키던 것은 "정적 시세표를 폐기한 뒤 숫자를 지어내지 말 것"이고
  // 그 계약은 지금도 유효하다. 다만 2026-08-22에 실행기가 실제 공시가
  // (`v_public_official_prices`, 한국소비자원 참가격 2026Q3)를 읽도록 재배선되면서,
  // 폐기된 옛 카테고리(total/seasonal/sdm/options/venue)는 **조회 자체를 거부**하는
  // 형태로 바뀌었다. 단언을 그 형태에 맞추되 "수치를 만들지 않는다"는 본래 의도는
  // 그대로 둔다. 실제 통계 계약은 `marketPriceIsSourced.test.ts` 가 따로 고정한다.
  const rejectingClient = {
    from: () => {
      throw new Error("공시 자료가 없는 카테고리는 조회조차 하면 안 된다");
    },
  } as never;

  it.each(["total", "seasonal", "sdm", "options", "venue"])(
    "폐기된 카테고리 '%s' 로는 수치를 만들지 않는다",
    async (category) => {
      const result = await executeGetMarketPrice({ category }, rejectingClient);

      expect(result.toolName).toBe("get_market_price");
      expect(result.success).toBe(false);
      expect(result.displayMessage).not.toMatch(/\d+만원/u);
      expect(result.displayMessage).not.toContain("중간값");
      expect(result.toolOutput).toMatchObject({ error: "unsupported_category" });
    },
  );

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

  it("does not report user-declared not-needed items as unconfirmed", () => {
    const first = executeAnalyzeQuoteWithTrustEngine({
      category: "studio",
      region: "seoul",
      quote_price: 300,
    });
    const checklist = first.toolOutput as {
      checklistItems: Array<{ id: string; name: string }>;
    };
    const notNeeded = checklist.checklistItems[0];
    const result = executeAnalyzeQuoteWithTrustEngine({
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

  it("can finish the second step even when every item remains unconfirmed", () => {
    const result = executeAnalyzeQuoteWithTrustEngine({
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
