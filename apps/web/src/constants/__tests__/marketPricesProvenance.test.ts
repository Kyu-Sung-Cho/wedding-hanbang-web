import { describe, expect, it } from "vitest";
import {
  getLatestPeriodId,
  getMarketPriceContext,
  PRICE_PERIODS,
  TREND_DATA,
} from "../marketPrices";

function expectedMonthLabels(periodId: string): string[] {
  const year = Number(periodId.slice(0, 4));
  const month = Number(periodId.slice(4, 6));

  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return `${String(date.getUTCFullYear()).slice(2)}년 ${String(date.getUTCMonth() + 1).padStart(2, "0")}월`;
  });
}

describe("official wedding market-price provenance", () => {
  it("generates all 18 forward-looking months from the latest official survey", () => {
    const latest = getLatestPeriodId();

    expect(PRICE_PERIODS.at(-1)?.id).toBe(latest);
    expect(TREND_DATA).toHaveLength(18);
    expect(TREND_DATA.map((row) => row.month)).toEqual(expectedMonthLabels(latest));
  });

  it("keeps applicability limits and the original URL beside injected figures", () => {
    const context = getMarketPriceContext();

    expect(context).toContain("https://www.price.go.kr/tprice/portal/wedding/areaStatistic.do");
    expect(context).toContain("표본 기반 통계");
    expect(context).toContain("개별 견적의 적정성");
    expect(context).not.toContain("고객이 예산 적정성을 물으면 시세와 비교하여");
    expect(context).not.toContain("비수기 절약 가능 금액 안내");
  });
});
