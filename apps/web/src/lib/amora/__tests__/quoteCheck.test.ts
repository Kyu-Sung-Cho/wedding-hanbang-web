import { describe, expect, it } from "vitest";
import { analyzeAmoraQuoteCheck, getQuoteCheckItems } from "../quoteCheck";
import type { AmoraQuoteCategory, AmoraQuoteRegion } from "../quoteCheck";

const REGIONS: AmoraQuoteRegion[] = ["seoul", "gyeonggi", "busan", "daegu", "other"];
const CATEGORIES: AmoraQuoteCategory[] = ["sdm_package", "studio", "dress", "makeup"];

function analyze(category: AmoraQuoteCategory, region: AmoraQuoteRegion, price = 300) {
  return analyzeAmoraQuoteCheck({
    category,
    region,
    quotePriceManwon: price,
    includedItemIds: [],
  });
}

describe("견적 확인 신뢰 경계", () => {
  it("항목 payload에 출처 없는 가격·비율·중요도 필드가 없다", () => {
    for (const category of CATEGORIES) {
      for (const region of REGIONS) {
        for (const item of getQuoteCheckItems(category, region)) {
          expect(Object.keys(item).sort()).toEqual(
            ["category", "checkQuestion", "id", "name"].sort()
          );
          expect(item.checkQuestion).toBeTruthy();
        }
      }
    }
  });

  it("지역 입력으로 체크 항목의 가격이나 발생 가능성을 만들지 않는다", () => {
    const seoul = getQuoteCheckItems("studio", "seoul");
    const other = getQuoteCheckItems("studio", "other");
    expect(seoul).toEqual(other);
  });

  it("결과에 가격 비교·등급·추정·필수성 필드가 없다", () => {
    const result = analyze("sdm_package", "seoul") as unknown as Record<string, unknown>;
    for (const banned of [
      "marketMedianManwon",
      "marketComparatorLabel",
      "priceDiffPercent",
      "missingCriticalCount",
      "missingHighCount",
      "missingMediumCount",
      "missingItems",
      "score",
      "grade",
      "verdict",
      "redFlags",
      "estimatedHiddenCost",
      "estimatedTotal",
    ]) {
      expect(result[banned], banned).toBeUndefined();
    }
  });

  it("체크하지 않은 항목을 미포함으로 단정하지 않는다", () => {
    const result = analyze("studio", "seoul");
    expect(result.unconfirmedItemCount).toBe(result.unconfirmedItems.length);
    expect(result.summaryTitle).toContain("포함 여부");
    expect(result.summaryText).toContain("미포함 판정이 아니라");
  });

  it("총괄 조사 수치는 개별 가격이 아닌 2024 조사 참고로만 분리한다", () => {
    const result = analyze("studio", "seoul");
    expect(result.sourceNote).toContain("2024년 5~11월 조사");
    expect(result.sourceNote).toContain("기본금 평균 346만원");
    expect(result.sourceNote).toContain("추가 지불 평균 174만원");
    expect(result.sourceNote).toContain("개별 견적이나 항목별 현재 시세가 아닙니다");
    expect(result.sourceUrl).toMatch(/^https:\/\/www\.kca\.go\.kr\//);
  });
});

describe("체크리스트 일관성", () => {
  it("항목을 전부 포함으로 표시하면 확인 필요 0개와 완료 요약을 반환한다", () => {
    const allIds = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: allIds,
    });
    expect(result.unconfirmedItemCount).toBe(0);
    expect(result.contractQuestions).toHaveLength(0);
    expect(result.summaryTitle).toContain("모두 포함");
  });

  it("확인하지 않은 항목에서 업체 질문을 최대 6개 만든다", () => {
    const result = analyze("sdm_package", "seoul");
    expect(result.unconfirmedItemCount).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeGreaterThan(0);
    expect(result.contractQuestions.length).toBeLessThanOrEqual(6);
  });

  it("유효하지 않은 ID는 포함으로 세지 않는다", () => {
    const items = getQuoteCheckItems("studio", "seoul");
    const includedIds = items.slice(0, 3).map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 150,
      includedItemIds: [...includedIds, "made_up_item"],
    });
    expect(result.checkedItemCount).toBe(includedIds.length);
    expect(result.includedItems.length + result.unconfirmedItems.length).toBe(items.length);
  });
});
