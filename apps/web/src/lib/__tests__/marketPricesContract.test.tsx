import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarketPriceSeoContent from "@/components/app/market-prices/MarketPriceSeoContent";
import MarketPricesClient from "@/components/app/market-prices/MarketPricesClient";
import RegionalCostTable from "@/components/app/market-prices/RegionalCostTable";
import {
  TREND_DATA,
  getMarketPriceContext,
  getNationalAverages,
} from "@/constants/marketPrices";

describe("market-price source and scope contract", () => {
  it("keeps venue and SDM averages separate in the AI context", () => {
    const national = getNationalAverages();
    expect(national.meal + national.rental + national.decoration).toBeGreaterThan(0);
    expect(national.sdm).toBeGreaterThan(0);

    const context = getMarketPriceContext();
    expect(context).toContain("전국 예식장 평균 계약금액");
    expect(context).toContain("전국 스드메 평균 계약금액");
    expect(context).not.toContain("전국 두 평균 단순 합계");
    expect(context).not.toContain("서울 두 평균 단순 합계");
    expect(context).toContain("하나의 총액으로 합산하지 말고 각각 제시");
    expect(context).toContain("개인의 실제 결혼 총지출이나 중위값으로 표현하지 말 것");
  });

  it("does not publish the unsupported manual 18-month forecast series", () => {
    expect(TREND_DATA).toEqual([]);

    const html = renderToStaticMarkup(<MarketPricesClient />);
    expect(html).not.toContain("18개월 비용 추이");
    expect(html).not.toContain("2027년 6월까지의 예상 시세");
    expect(html).not.toContain("2,101만원");
    expect(html).not.toContain("AVERAGE SAVING");
    expect(html).toContain("예식장 평균 계약금액");
    expect(html).toContain("스드메 평균 계약금액");
    expect(html).not.toContain("두 평균 단순 합계");
    expect(html).not.toContain("총비용");
    expect(html).toContain("별도 실태조사 · 2024");
  });

  it("uses the same separation and seasonal scope in server-rendered SEO copy", () => {
    const html = renderToStaticMarkup(<MarketPriceSeoContent />);

    expect(html).toContain("예식장 평균(식대+대관+기본 장식)");
    expect(html).toContain("스드메 평균 계약금액");
    expect(html).not.toContain("단순 합계");
    expect(html).not.toContain("총비용");
    expect(html).toContain("지역별 예식장·스드메 평균");
    expect(html).toContain("스드메는 포함하지 않으며 실제 절약 보장액이나 전체 결혼비용 차이가 아닙니다");
    expect(html).not.toContain("지역별 총 비용");
  });

  it("presents regional venue and SDM averages separately without a combined ranking", () => {
    const html = renderToStaticMarkup(<RegionalCostTable periodId="202604" />);

    expect(html).toContain("예식장 평균");
    expect(html).toContain("스드메");
    expect(html).not.toContain("총비용");
    expect(html).not.toContain("전국 평균 대비");
    expect(html).not.toContain("순위");
  });
});
