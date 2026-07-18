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

describe("런타임 공시가 경계", () => {
  it("소스에 고정한 중위가로 가격을 판정하지 않는다", () => {
    for (const category of CATEGORIES) {
      for (const region of REGIONS) {
        const result = analyze(category, region, 300);
        expect(result.marketMedianManwon, `${category}/${region}`).toBe(0);
        expect(result.priceDiffPercent, `${category}/${region}`).toBe(0);
        expect(result.marketComparatorLabel).toContain("최신 공시가 확인 필요");
      }
    }
  });

  it("체크리스트 출처 문구가 가격 비교를 하지 않았음을 명시한다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.sourceNote).toContain("가격의 적정성을 판정하지 않습니다");
    expect(result.sourceNote).toContain("업체별 공시가");
    expect(result.sourceNote).not.toContain("price.go.kr");
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
    expect(result.sourceNote).toContain("업체별 공시가");
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
