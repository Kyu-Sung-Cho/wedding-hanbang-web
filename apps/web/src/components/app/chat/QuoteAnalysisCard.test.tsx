import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@/types/database.types";
import QuoteAnalysisCard from "./QuoteAnalysisCard";

function render(toolOutput: Record<string, unknown>) {
  const result: ToolExecutionResult = {
    toolName: "analyze_quote",
    toolInput: {},
    toolOutput,
    success: true,
    displayMessage: "견적 체크",
  };

  return renderToStaticMarkup(<QuoteAnalysisCard result={result} />);
}

describe("QuoteAnalysisCard retired static price compatibility", () => {
  it("does not render removed price or usage fields in checklist mode", () => {
    const html = render({
      mode: "checklist",
      quotePrice: 320,
      category: "studio",
      checklistItems: [{
        id: "studio_original_data",
        name: "원본 데이터 구매",
        category: "studio",
        severity: "critical",
        checkQuestion: "원본 데이터가 포함인가요?",
      }],
    });

    expect(html).toContain("원본 데이터 구매");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("이용률");
    expect(html).not.toContain("~");
    expect(html).toContain("이용 안 함");
    expect(html).toContain("확인 필요");
    expect(html).not.toContain("미포함");
  });

  it("does not render removed price or usage fields in analysis mode", () => {
    const html = render({
      quotePrice: 320,
      category: "studio",
      marketMedian: 0,
      marketComparatorLabel: "업체별 최신 공시가 확인 필요",
      priceDiffPercent: 0,
      missingItems: [{
        name: "원본 데이터 구매",
        category: "studio",
        severity: "critical",
        reason: "계약 전 포함 여부를 확인해야 해요.",
        checkQuestion: "원본 데이터가 포함인가요?",
        disguise: "포함 범위가 명시되지 않았어요.",
      }],
      includedItems: [],
      dataSource: "업체별 최신 공시가에서 확인하세요.",
      statsNote: "가격 적정성을 판정하지 않습니다.",
    });

    expect(html).toContain("원본 데이터 구매");
    expect(html).toContain("별도 확인");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("이용률");
    expect(html).not.toContain("~");
    expect(html).not.toContain("거의 확실히 추가");
    expect(html).not.toContain("대부분 추가하게 됨");
  });

  it("does not replay a retired market median or source from a legacy chat response", () => {
    const html = render({
      quotePrice: 320,
      category: "studio",
      marketMedian: 210,
      priceDiffPercent: 52,
      dataSource: "과거 고정 평균가 출처",
      statsNote: "평균보다 비싼 견적입니다.",
      missingItems: [],
      includedItems: [],
    });

    expect(html).toContain("별도 확인");
    expect(html).toContain("가격 적정성을 판정하지 않습니다");
    expect(html).not.toContain("210만");
    expect(html).not.toContain("+52%");
    expect(html).not.toContain("과거 고정 평균가 출처");
    expect(html).not.toContain("평균보다 비싼 견적");
    expect(html).not.toContain("기준 시세 중위가");
  });

  it("shows not-needed items separately from items that still need confirmation", () => {
    const html = render({
      quotePrice: 320,
      category: "studio",
      missingItems: [{ name: "앨범 페이지 수", category: "studio", severity: "high" }],
      includedItems: [],
      notNeededItems: [{ name: "야외 촬영", category: "studio", severity: "medium" }],
    });

    expect(html).toContain("아직 확인하지 않은 항목 1개");
    expect(html).toContain("이용 안 함 1개");
  });
});
