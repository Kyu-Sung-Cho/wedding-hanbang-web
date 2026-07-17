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

  it("회귀: 경기/인천 정상 견적의 중위가 대비 %가 서울 기준으로 왜곡되지 않는다", () => {
    // 경기/인천 패키지 중위가(230만원대) 근처 견적 200만원 —
    // 과거 서울 합산치(380만원대)와 비교하면 -47%로 '현저히 낮음'으로 읽혔다.
    const result = analyze("sdm_package", "gyeonggi", 200);
    expect(result.priceDiffPercent).toBeGreaterThan(-30);
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

describe("판정 없음 — 사실만 노출", () => {
  it("결과에 점수·등급·판정·가격대 분류·추정액 필드가 없다", () => {
    const result = analyze("sdm_package", "seoul", 300) as unknown as Record<string, unknown>;
    for (const banned of [
      "score",
      "grade",
      "verdict",
      "priceTier",
      "priceTierAutoInferred",
      "showPriceComparison",
      "redFlags",
      "estimatedHiddenMinManwon",
      "estimatedHiddenMaxManwon",
      "estimatedTotalMinManwon",
      "estimatedTotalMaxManwon",
    ]) {
      expect(result[banned], `${banned} 필드는 제거되어야 함`).toBeUndefined();
    }

    for (const item of analyze("sdm_package", "seoul", 300).missingItems) {
      const publicItem = item as unknown as Record<string, unknown>;
      expect(publicItem.priceManwon).toBeUndefined();
      expect(publicItem.usageRatePercent).toBeUndefined();
    }
  });

  it("요약 문구가 개수 사실만 말하고 평가 단어를 쓰지 않는다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.summaryTitle).toContain("확인되지 않았어요");
    for (const judgment of ["위험", "안전", "바가지", "등급", "점수"]) {
      expect(result.summaryTitle).not.toContain(judgment);
      expect(result.summaryText).not.toContain(judgment);
    }
    expect(result.summaryText).not.toContain("174만원");
    expect(result.sourceNote).not.toContain("숨은비용");
    expect(result.sourceNote).toContain("https://www.price.go.kr/");
  });
});

describe("체크리스트 일관성", () => {
  it("항목을 전부 체크하면 빠짐 카운트 0 + 질문 0개 + 완료 요약", () => {
    const allIds = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: allIds,
    });
    expect(result.missingCriticalCount + result.missingHighCount + result.missingMediumCount).toBe(0);
    expect(result.contractQuestions).toHaveLength(0);
    expect(result.summaryTitle).toContain("모두");
  });

  it("아무것도 체크 안 하면 필수·고빈도 항목 기준 질문이 최대 6개 생성된다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.missingCriticalCount).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeLessThanOrEqual(6);
  });

  it("포함/누락 분할이 입력과 일치한다", () => {
    const items = getQuoteCheckItems("studio", "seoul");
    const half = items.slice(0, Math.floor(items.length / 2)).map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 150,
      includedItemIds: half,
    });
    expect(result.checkedItemCount).toBe(half.length);
    expect(result.includedItems.length + result.missingItems.length).toBe(items.length);
  });
});
