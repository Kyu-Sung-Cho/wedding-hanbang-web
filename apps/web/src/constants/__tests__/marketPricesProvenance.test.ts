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

  // 2026-11-16 파운더 결정(D-79): 참가격 자료를 쓰지 않는다. 예전에는 이 규칙이 아모라를
  // 검수·발행된 공시 데이터 조회(`get_market_price`)와 공시가 페이지(/price)로 보냈다.
  it("tells Amora it has no price statistics and must not invent them", () => {
    const context = getMarketPriceContext();

    expect(context).toContain("아모라에게는 시세·평균 가격 자료가 없습니다");
    expect(context).toContain("평균가·중간값·시세·가격대를 지어내지 마세요");
    expect(context).toContain("실제 계약 금액은 업체의 서면 견적으로 확인하도록 안내하세요");
    expect(context).not.toContain("get_market_price");
    expect(context).not.toContain("/price");
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
