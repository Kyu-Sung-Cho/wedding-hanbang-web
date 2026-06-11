import { describe, expect, it } from "vitest";
import { analyzeAmoraQuoteCheck, getQuoteCheckItems } from "../quoteCheck";
import type { AmoraQuoteCategory, AmoraQuoteRegion } from "../quoteCheck";

const REGIONS: AmoraQuoteRegion[] = ["seoul", "gyeonggi", "busan", "daegu", "other"];
const CATEGORIES: AmoraQuoteCategory[] = ["sdm_package", "studio", "dress", "makeup"];

function analyze(category: AmoraQuoteCategory, region: AmoraQuoteRegion, price: number) {
  return analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: price,
    includedItemIds: [],
  });
}

describe("지역별 중위가 비교 (정밀도 핵심)", () => {
  it("모든 카테고리×지역 조합에서 중위가가 0보다 크다", () => {
    for (const category of CATEGORIES) {
      for (const region of REGIONS) {
        const result = analyze(category, region, 300);
        expect(result.marketMedianManwon, `${category}/${region}`).toBeGreaterThan(0);
        expect(result.marketComparatorLabel, `${category}/${region}`).toBeTruthy();
      }
    }
  });

  it("스드메 패키지: 서울과 경기/인천은 서로 다른 지역 중위가와 비교한다", () => {
    const seoul = analyze("sdm_package", "seoul", 300);
    const gyeonggi = analyze("sdm_package", "gyeonggi", 300);
    expect(seoul.marketComparatorLabel).toContain("서울");
    expect(gyeonggi.marketComparatorLabel).toContain("경기/인천");
    // 참가격 통계상 서울 패키지 중위가가 경기/인천보다 뚜렷이 높다
    expect(seoul.marketMedianManwon).toBeGreaterThan(gyeonggi.marketMedianManwon);
  });

  it("회귀: 경기/인천의 정상 견적을 서울 기준으로 미끼가격 오판하지 않는다", () => {
    // 경기/인천 패키지 중위가(230만원대) 근처 견적 200만원 —
    // 과거 서울 합산치(380만원대)와 비교하면 ratio 0.52로 suspicious_low 오판이 났다.
    const result = analyze("sdm_package", "gyeonggi", 200);
    expect(result.priceTier).toBe("standard");
    expect(result.priceTierAutoInferred).toBe("standard");
  });

  it("부산/대구는 5대광역시, 기타는 기타지역 통계와 비교한다", () => {
    expect(analyze("sdm_package", "busan", 300).marketComparatorLabel).toContain("5대광역시");
    expect(analyze("sdm_package", "daegu", 300).marketComparatorLabel).toContain("5대광역시");
    expect(analyze("sdm_package", "other", 300).marketComparatorLabel).toContain("기타지역");
  });

  it("드레스/메이크업은 비교 기준 항목을 라벨에 명시한다", () => {
    expect(analyze("dress", "seoul", 150).marketComparatorLabel).toContain("드레스");
    expect(analyze("makeup", "busan", 70).marketComparatorLabel).toContain("메이크업");
  });
});

describe("가격대 분류 경계", () => {
  it("중위가의 60% 미만은 suspicious_low, 130% 미만은 standard", () => {
    const median = analyze("sdm_package", "seoul", 300).marketMedianManwon;
    expect(analyze("sdm_package", "seoul", Math.floor(median * 0.5)).priceTierAutoInferred).toBe(
      "suspicious_low"
    );
    expect(analyze("sdm_package", "seoul", Math.round(median * 1.0)).priceTierAutoInferred).toBe(
      "standard"
    );
    expect(analyze("sdm_package", "seoul", Math.round(median * 1.5)).priceTierAutoInferred).toBe(
      "premium"
    );
    expect(analyze("sdm_package", "seoul", Math.round(median * 2.5)).priceTierAutoInferred).toBe(
      "highend"
    );
  });

  it("하이엔드는 가격 비교를 숨기고, 사용자 override가 자동 분류보다 우선한다", () => {
    const median = analyze("sdm_package", "seoul", 300).marketMedianManwon;
    const highend = analyze("sdm_package", "seoul", Math.round(median * 3));
    expect(highend.showPriceComparison).toBe(false);

    const overridden = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: Math.round(median * 3),
      includedItemIds: [],
      userPriceTierOverride: "premium",
    });
    expect(overridden.priceTier).toBe("premium");
    expect(overridden.priceTierAutoInferred).toBe("highend");
    expect(overridden.showPriceComparison).toBe(true);
  });
});

describe("추가금 추정 일관성", () => {
  it("항목을 전부 체크하면 추가금 추정이 0이고 빠짐 카운트도 0이다", () => {
    const allIds = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: allIds,
    });
    expect(result.estimatedHiddenMinManwon).toBe(0);
    expect(result.estimatedHiddenMaxManwon).toBe(0);
    expect(result.missingCriticalCount + result.missingHighCount + result.missingMediumCount).toBe(0);
    expect(result.verdict).toBe("safe");
  });

  it("추정 최소치는 최대치를 넘지 않고, 합산 추정은 견적가+추가금과 일치한다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.estimatedHiddenMinManwon).toBeLessThanOrEqual(result.estimatedHiddenMaxManwon);
    expect(result.estimatedTotalMinManwon).toBe(300 + result.estimatedHiddenMinManwon);
    expect(result.estimatedTotalMaxManwon).toBe(300 + result.estimatedHiddenMaxManwon);
  });

  it("아무것도 체크 안 하면 위험 판정 + 미끼가격이 아니어도 필수 누락 red flag가 뜬다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.verdict).toBe("danger");
    expect(result.redFlags.some((flag) => flag.id === "essential_as_option")).toBe(true);
  });
});
