import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import MarketPriceSeoContent from "@/components/app/market-prices/MarketPriceSeoContent";
import MarketPricesClient, {
  formatMarketPrice,
} from "@/components/app/market-prices/MarketPricesClient";
import RegionalCostTable from "@/components/app/market-prices/RegionalCostTable";
import {
  TREND_DATA,
  getNationalAverages,
} from "@/constants/marketPrices";

describe("market-price source and scope contract", () => {
  it("keeps venue and SDM source fields separate without a bulk AI anchoring prompt", () => {
    const national = getNationalAverages();
    expect(Object.values(national).every((value) => typeof value === "number" && value > 0)).toBe(true);

    const source = readFileSync(resolve(process.cwd(), "src/constants/marketPrices.ts"), "utf8");
    expect(source).not.toContain("export function getMarketPriceContext");
  });

  it("represents a missing survey period as unavailable data instead of zero prices", () => {
    expect(getNationalAverages("period-without-source-data")).toEqual({
      meal: null,
      sdm: null,
      rental: null,
      decoration: null,
    });
  });

  it("labels a missing client-side price as unavailable instead of rendering zero", () => {
    expect(formatMarketPrice(undefined)).toBe("자료 없음");
    expect(formatMarketPrice(null)).toBe("자료 없음");
    expect(formatMarketPrice(0)).toBe("자료 없음");
  });

  it("does not publish the unsupported manual 18-month forecast series", () => {
    expect(TREND_DATA).toEqual([]);

    const html = renderToStaticMarkup(<MarketPricesClient />);
    const source = readFileSync(resolve(process.cwd(), "src/components/app/market-prices/MarketPricesClient.tsx"), "utf8");
    expect(html).not.toContain("18개월 비용 추이");
    expect(html).not.toContain("2027년 6월까지의 예상 시세");
    expect(html).not.toContain("2,101만원");
    expect(html).not.toContain("AVERAGE SAVING");
    expect(html).toContain("공식 가격 조사 (조사월 기준)");
    expect(html).toContain("한국소비자원 참가격 공식 조사 원문");
    expect(html).toContain("식대 평균 계약금액");
    expect(html).toContain("대관료 평균 계약금액");
    expect(html).toContain("기본 장식 평균 계약금액");
    expect(html).toContain("스드메 평균 계약금액");
    expect(html).not.toContain("두 평균 단순 합계");
    expect(html).not.toContain("총비용");
    expect(html.match(/전국 식대 평균 계약금액/g)).toHaveLength(1);
    expect(html).not.toMatch(/\+174만원|174만원|346만원|신혼부부 995쌍|별도 실태조사/);
    expect(html).not.toContain("정부 가격표시제 시행 중");
    expect(html).not.toContain("공정위 고시 개정 안내");
    expect(source).toContain("필수 항목");
    expect(source).toContain("공식 조사 중위가격(중간값)");
    expect(source).toContain("스드메 패키지 지역별 중위가격(중간값)");
    expect(source).toContain("예식장별 성수기·비수기 기준 상이");
    expect(source).not.toMatch(/4~6월|9~11월|1~3월|7~8월|12월 · 스드메 제외/);
  });

  it("uses the same separation and seasonal scope in server-rendered SEO copy", () => {
    const html = renderToStaticMarkup(<MarketPriceSeoContent />);

    expect(html).toContain("공식 가격 조사 항목");
    expect(html).toContain("식대 평균 계약금액");
    expect(html).toContain("대관료 평균 계약금액");
    expect(html).toContain("기본 장식 평균 계약금액");
    expect(html).toContain("스드메 평균 계약금액");
    expect(html).not.toContain("단순 합계");
    expect(html).not.toContain("총비용");
    expect(html).toContain("지역별 예식장·스드메 평균");
    expect(html).toContain("스드메 패키지 중위가격(중간값)");
    expect(html).toContain("예식장별 성수기·비수기 기준");
    expect(html).toContain("스드메는 포함하지 않으며 실제 절약 보장액이나 전체 결혼비용 차이가 아닙니다");
    expect(html).not.toContain("지역별 총 비용");
    expect(html).not.toMatch(/4~6월|9~11월|1~3월|7~8월|12월\)/);
  });

  it("presents regional venue and SDM averages separately without a combined ranking", () => {
    const html = renderToStaticMarkup(<RegionalCostTable periodId="202504" />);

    expect(html).toContain("식대");
    expect(html).toContain("대관료");
    expect(html).toContain("기본 장식");
    expect(html).toContain("스드메");
    expect(html).not.toContain("총비용");
    expect(html).not.toContain("전국 평균 대비");
    expect(html).not.toContain("순위");
    expect(html).not.toContain(">0만원<");
    expect(html).toContain("자료 없음");
  });

  it("shows an explicit unavailable state when a regional survey period is missing", () => {
    const html = renderToStaticMarkup(
      <RegionalCostTable periodId="period-without-source-data" />,
    );

    expect(html).toContain("선택한 조사월의 지역별 자료가 없습니다.");
  });
});
