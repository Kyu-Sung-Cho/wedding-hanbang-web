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
    expect(result.summaryTitle).toContain("확인할 항목");
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
  it("사용자에게 보여주는 항목은 친숙한 웨딩 용어와 쉬운 설명을 함께 제공한다", () => {
    const opaqueJargon =
      /스드메|상견례|컨펌|얼리스타트|신랑|원판|원본 데이터|전체.*사진 파일|사진 파일.*전체/;
    for (const item of getQuoteCheckItems("sdm_package", "seoul")) {
      expect(item.name, `${item.id}: ${item.name}`).not.toMatch(opaqueJargon);
      for (const text of [item.checkQuestion, item.reason, item.disguise]) {
        expect(text, `${item.id}: ${text}`).not.toMatch(opaqueJargon);
      }
    }
  });

  it("항목을 전부 체크하면 미확인 카운트 0 + 질문 0개 + 완료 요약", () => {
    const allIds = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "sdm_package",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: allIds,
    });
    expect(result.missingCriticalCount + result.missingHighCount + result.missingMediumCount).toBe(0);
    expect(result.contractQuestions).toHaveLength(0);
    expect(result.summaryTitle).toContain("모든 항목");
  });

  it("이용 계획 없음은 확인 필요 항목으로 세지 않는다", () => {
    const items = getQuoteCheckItems("studio", "seoul");
    const included = items.slice(0, 2).map((item) => item.id);
    const notNeeded = items.slice(2).map((item) => item.id);
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 150,
      includedItemIds: included,
      notNeededItemIds: notNeeded,
    });

    expect(result.missingItems).toHaveLength(0);
    expect(result.includedItems).toHaveLength(included.length);
    expect(result.notNeededItems).toHaveLength(notNeeded.length);
    expect(result.notNeededItemCount).toBe(notNeeded.length);
    expect(result.summaryText).toContain(`이용 계획 없음 ${notNeeded.length}개`);
  });

  it("아무것도 체크 안 하면 먼저·함께 확인할 질문이 최대 6개 생성된다", () => {
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
    expect(
      result.includedItems.length + result.notNeededItems.length + result.missingItems.length,
    ).toBe(items.length);
  });

  it("묶음 견적에 예식 당일 공통 항목과 드레스·메이크업 세부 항목을 포함하고 불필요한 초안만 제외한다", () => {
    const ids = getQuoteCheckItems("sdm_package", "seoul").map((item) => item.id);
    expect(ids).toContain("common_ceremony_snap");
    expect(ids).toContain("common_ceremony_original");
    expect(ids).toContain("common_ceremony_video");
    expect(ids).toContain("common_pyebaek");
    expect(ids).toContain("common_wedding_car");
    expect(ids).toContain("common_thank_you_gift");
    expect(ids).toContain("dress_mini");
    expect(ids).toContain("makeup_corsage");
    expect(ids).not.toContain("makeup_nail");
  });

  it("기본 견적 금액(quotePriceManwon 또는 quoteTotalManwon)이 입력되면 요약 문구에 반영한다", () => {
    const result = analyzeAmoraQuoteCheck({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 0,
      quoteTotalManwon: 240,
      includedItemIds: [],
    });
    expect(result.quotePriceManwon).toBe(240);
    expect(result.summaryText).toContain("240만원");
  });

  it("업체에 보낼 질문도 과거 업계 용어 초안을 노출하지 않는다", () => {
    const result = analyze("sdm_package", "seoul", 300);
    expect(result.contractQuestions.join("\n"))
      .not.toMatch(
        /원본 데이터|본식|헬퍼|피팅|혼주|신랑|컨펌|얼리|전체.*사진 파일|사진 파일.*전체/,
      );
    expect(result.contractQuestions.every((question) => question.endsWith("?"))).toBe(true);
  });
});
