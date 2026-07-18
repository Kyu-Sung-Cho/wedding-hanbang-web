// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMarketPriceContext,
  PRICE_PERIODS,
  TREND_DATA,
} from "../marketPrices";

describe("official wedding disclosure provenance", () => {
  it("does not embed real survey periods or price trends in application code", () => {
    expect(PRICE_PERIODS).toEqual([]);
    expect(TREND_DATA).toEqual([]);
  });

  it("directs price answers to reviewed runtime disclosures with applicability limits", () => {
    const context = getMarketPriceContext();

    expect(context).toContain("검수·발행된 업체별 공시 데이터");
    expect(context).toContain("실제 계약 금액을 보증하지 않습니다");
    expect(context).not.toMatch(/\d+만원/u);
  });

  it("keeps the retired market-price page behind the published disclosure redirect", () => {
    const legacyPage = readFileSync(
      resolve(process.cwd(), "src/app/(community)/market-prices/page.tsx"),
      "utf8",
    );

    expect(legacyPage).toContain('redirect("/price")');
    expect(legacyPage).not.toContain("MarketPricesClient");
    expect(legacyPage).not.toContain("MarketPriceSeoContent");
  });
});
