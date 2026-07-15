import { describe, expect, it } from "vitest";
import {
  DRESS_PRICES,
  MAKEUP_PRICES,
  SDM_PACKAGES,
  SEASONAL_DATA,
  VENUE_NECESSARY,
  getLatestPeriodId,
} from "@/constants/marketPrices";
import { executeGetMarketPrice } from "../marketPriceTools";

describe("marketPriceTools", () => {
  it("서로 다른 조사 항목을 하나의 총비용으로 합산하지 않는다", () => {
    const result = executeGetMarketPrice({ category: "total", scope: "national" });

    expect(result.success).toBe(true);
    expect(result.displayMessage).toContain("총비용");
    expect(result.displayMessage).toContain("합산하지 않아요");
    expect(result.toolOutput).toMatchObject({ totalAvailable: false });
    expect(result.toolOutput).toMatchObject({
      crossCategoryAggregationAllowed: false,
      statisticType: "published_median",
    });
    expect(result.toolOutput).not.toHaveProperty("national");
    expect(result.toolOutput).not.toHaveProperty("seoul");
  });

  it("통계 단위와 예식장별 성수기 기준 차이를 그대로 설명한다", () => {
    const venue = executeGetMarketPrice({ category: "venue", scope: "national" });
    const sdm = executeGetMarketPrice({ category: "sdm", scope: "national" });
    const seasonal = executeGetMarketPrice({ category: "seasonal", scope: "national" });

    expect(venue.displayMessage).toMatch(/대관료 중위가격|식대 중위가격/);
    expect(sdm.displayMessage).toContain("중위가격");
    expect(seasonal.displayMessage).toContain("예식장별 성수기·비수기 기준은 다름");
    expect(seasonal.displayMessage).not.toMatch(/4~6월|9~11월|1~3월|7~8월|12월/);
  });

  it("시장 가격은 조사월과 원출처가 연결된 데이터만 반환한다", () => {
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
    expect(result.displayMessage).toContain("개인 견적의 적정성이나 계약 안전성을 판정하지 않습니다");
    expect(result.toolOutput).toMatchObject({
      interpretationBoundary: "market_reference_not_individual_appraisal",
      scope: "seoul",
      crossCategoryAggregationAllowed: false,
    });
  });

  it("fails closed for unsupported or unavailable requests", () => {
    const unsupported = executeGetMarketPrice({ category: "restaurant", scope: "national" });
    const invalidScope = executeGetMarketPrice({ category: "studio", scope: "gangnam" });

    expect(unsupported.success).toBe(false);
    expect(unsupported.displayMessage).toContain("지원하지 않는");
    expect(invalidScope.success).toBe(false);
    expect(invalidScope.displayMessage).toContain("전국 또는 서울");
  });

  it("결측 예식장 금액을 0만원으로 말하지 않는다", () => {
    const latestPeriodId = getLatestPeriodId();
    const venue = VENUE_NECESSARY.find(
      (item) => item.periodId === latestPeriodId && item.scope === "national",
    );
    if (!venue) throw new Error("latest national venue fixture missing");
    const previousRental = venue.rental;
    venue.rental = 0;

    try {
      const result = executeGetMarketPrice({ category: "venue", scope: "national" });

      expect(result.success).toBe(true);
      expect(result.displayMessage).toContain("대관료 중위가격: 자료 없음");
      expect(result.displayMessage).not.toContain("대관료 중위가격: 0만원");
      expect(result.toolOutput).toMatchObject({
        necessary: { rental: null },
      });
    } finally {
      venue.rental = previousRental;
    }
  });

  it("결측 시즌 차이를 0원 절약처럼 말하지 않는다", () => {
    const latestPeriodId = getLatestPeriodId();
    const seasonal = SEASONAL_DATA.find((item) => item.periodId === latestPeriodId);
    if (!seasonal) throw new Error("latest seasonal fixture missing");
    const previousSavings = seasonal.savings;
    seasonal.savings = 0;

    try {
      const result = executeGetMarketPrice({ category: "seasonal", scope: "national" });

      expect(result.success).toBe(true);
      expect(result.displayMessage).toContain("차이: 자료 없음 (절약 보장액 아님)");
      expect(result.displayMessage).not.toContain("차이: 0만원");
      expect(result.toolOutput).toMatchObject({
        seasonal: { savings: null },
      });
    } finally {
      seasonal.savings = previousSavings;
    }
  });

  it("스드메·드레스·메이크업의 부분 결측을 0만원으로 노출하지 않는다", () => {
    const latestPeriodId = getLatestPeriodId();
    const sdm = SDM_PACKAGES.find(
      (item) => item.periodId === latestPeriodId && item.region === "전체",
    );
    const dress = DRESS_PRICES.find(
      (item) => item.periodId === latestPeriodId && item.scope === "national",
    );
    const makeup = MAKEUP_PRICES.find(
      (item) => item.periodId === latestPeriodId && item.scope === "national",
    );
    if (!sdm || !dress || !makeup) throw new Error("latest price fixtures missing");

    const previous = {
      packageMedian: sdm.packageMedian,
      photoShootDress: dress.photoShoot,
      rehearsalMakeup: makeup.rehearsal,
    };
    sdm.packageMedian = 0;
    dress.photoShoot = 0;
    makeup.rehearsal = Number.NaN;

    try {
      const sdmResult = executeGetMarketPrice({ category: "sdm", scope: "national" });
      const dressResult = executeGetMarketPrice({ category: "dress", scope: "national" });
      const makeupResult = executeGetMarketPrice({ category: "makeup", scope: "national" });

      expect(sdmResult.displayMessage).toContain("전체: 패키지 자료 없음");
      expect(sdmResult.toolOutput).toMatchObject({
        packages: expect.arrayContaining([
          expect.objectContaining({ region: "전체", packageMedian: null }),
        ]),
      });
      expect(dressResult.displayMessage).toContain("촬영용: 자료 없음");
      expect(dressResult.toolOutput).toMatchObject({ prices: { photoShoot: null } });
      expect(makeupResult.displayMessage).toContain("리허설(선택·포함 여부 확인): 자료 없음");
      expect(makeupResult.toolOutput).toMatchObject({ prices: { rehearsal: null } });
      for (const result of [sdmResult, dressResult, makeupResult]) {
        expect(result.success).toBe(true);
        expect(result.displayMessage).not.toMatch(/(?:^|[^\d])0만원/);
        expect(result.displayMessage).not.toContain("NaN만원");
      }
    } finally {
      sdm.packageMedian = previous.packageMedian;
      dress.photoShoot = previous.photoShootDress;
      makeup.rehearsal = previous.rehearsalMakeup;
    }
  });

  it("요청한 단일 가격이 결측이면 임의 값 대신 실패 상태를 반환한다", () => {
    const latestPeriodId = getLatestPeriodId();
    const studio = SDM_PACKAGES.find(
      (item) => item.periodId === latestPeriodId && item.region === "전체",
    );
    if (!studio) throw new Error("latest national studio fixture missing");
    const previousStudioBasic = studio.studioBasic;
    studio.studioBasic = 0;

    try {
      const result = executeGetMarketPrice({ category: "studio", scope: "national" });

      expect(result.success).toBe(false);
      expect(result.toolOutput).toMatchObject({ dataAvailable: false });
      expect(result.displayMessage).toContain("공식 조사값을 찾지 못했습니다");
      expect(result.displayMessage).not.toContain("0만원");
    } finally {
      studio.studioBasic = previousStudioBasic;
    }
  });

  it("선택항목 구조화 결과에도 0이나 비정상 가격을 남기지 않는다", () => {
    const result = executeGetMarketPrice({ category: "options", scope: "national" });
    const options = result.toolOutput.options as Record<string, number | null>;

    expect(result.success).toBe(true);
    expect(result.displayMessage).not.toMatch(/: (?:0|NaN|∞)만원/);
    expect(Object.values(options).every((price) => price === null || price > 0)).toBe(true);
  });
});
