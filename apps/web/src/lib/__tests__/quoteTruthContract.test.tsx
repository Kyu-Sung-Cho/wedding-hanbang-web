import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import QuoteAnalysisCard from "@/components/app/chat/QuoteAnalysisCard";
import type { ToolExecutionResult } from "@/types/database.types";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const TRUST_BOUNDARY_FILES = [
  "src/constants/hiddenCosts.ts",
  "src/lib/amora/quoteCheck.ts",
  "src/lib/ai/tools/quoteMarketTools.ts",
  "src/components/app/chat/QuoteAnalysisCard.tsx",
  "src/app/(community)/community/quote-check/page.tsx",
  "src/app/(community)/community/quote-check/layout.tsx",
  "src/app/quote/[id]/page.tsx",
  "src/lib/quoteCheck/reportCard.ts",
];

describe("quote-check truth contract", () => {
  it("does not restore unsupported per-item evidence fields or estimators", () => {
    const checklist = readSource("src/constants/hiddenCosts.ts");
    for (const forbidden of [
      "usageRate:",
      "nationalPrice:",
      "seoulPrice:",
      "severity:",
      "estimateHiddenCosts",
      "getGradeFromScore",
      "getHiddenCostContext",
      "TransparencyScore",
      "RED_FLAGS",
    ]) {
      expect(checklist, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps unsupported public wording out of quote surfaces", () => {
    const source = TRUST_BOUNDARY_FILES.map(readSource).join("\n");
    for (const forbidden of [
      "%가 추가로 냄",
      "이용률 ",
      "필수급",
      "거의 확실히 추가",
      "자주 붙는 추가금",
      "필수 항목 누락",
      "평균 ${formatManwon",
      "평균 ${formatReportManwon",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("renders checklist and result cards without item prices, rates, or priority badges", () => {
    const checklistResult: ToolExecutionResult = {
      toolName: "analyze_quote",
      toolInput: {},
      toolOutput: {
        mode: "checklist",
        quotePrice: 300,
        category: "studio",
        checklistItems: [
          {
            id: "studio_original_data",
            name: "원본 데이터 제공",
            category: "studio",
            checkQuestion: "원본 데이터가 포함되나요?",
          },
        ],
      },
      success: true,
      displayMessage: "확인해주세요.",
    };
    const analysisResult: ToolExecutionResult = {
      ...checklistResult,
      toolOutput: {
        mode: "analysis",
        quotePrice: 300,
        category: "studio",
        unconfirmedItems: [
          {
            name: "원본 데이터 제공",
            category: "studio",
            checkQuestion: "원본 데이터가 포함되나요?",
          },
        ],
        includedItems: [],
        statsNote: "2024년 조사 총괄 참고",
      },
    };

    const html = [
      renderToStaticMarkup(<QuoteAnalysisCard result={checklistResult} />),
      renderToStaticMarkup(<QuoteAnalysisCard result={analysisResult} />),
    ].join("\n");

    expect(html).toContain("원본 데이터가 포함되나요?");
    expect(html).toContain("아직 확인되지 않은 항목");
    expect(html).not.toContain("이용률");
    expect(html).not.toContain("필수급");
    expect(html).not.toContain("평균 300");
    expect(html).not.toContain("~300만");
  });
});
