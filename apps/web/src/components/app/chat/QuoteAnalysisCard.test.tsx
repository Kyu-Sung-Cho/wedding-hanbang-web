import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionResult } from "@/types/database.types";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";
import { parseCanonicalQuoteAnalysisSelection } from "@/lib/ai/quoteAnalysisSelection";
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

  it("shows a current public lower-bound median only with its full evidence and limitations", () => {
    const html = render({
      quotePrice: 250,
      category: "studio",
      marketMedian: 200,
      marketComparatorLabel: "서울 사진 촬영 공시 기본가 하한 중간값 (3건)",
      marketEvidence: {
        status: "available",
        observationCount: 3,
        vendorCount: 3,
        source: "한국소비자원 참가격",
        sourceUrl: "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122",
        sourcePeriod: "2025년 11월",
        categoryLabel: "사진 촬영",
        regionLabel: "서울",
        calculation: "비교 가능한 업체·대행사별 공시 기본가 하한 3건의 중간값",
        comparisonBasis: "공시 행의 price_min_krw만 사용하며 기본 구성·옵션·부가세 조건을 합산하거나 보정하지 않음",
        limitation: "공시 기본가 하한의 참고 중간값이며 옵션·계약 조건·시점에 따른 실제 결제액과 견적 적정성을 뜻하지 않습니다.",
        officialReference: {
          version: 1,
          referenceId: "kca_wedding_service_price_2025_11",
          sourceDisclosure: {
            version: 1,
            sourceType: "official_reference",
            commercialRelationship: "none",
            checkedAt: "2026-07-27",
            badgeLabel: "공식 자료",
            statusLabel: "참고 정보",
            commercialRelationshipLabel: "표시된 상업 관계 없음",
            checkedAtLabel: "2026.07.27 확인",
            limitation: "표시된 확인일과 적용 범위 기준이에요. 중요한 내용은 최신 원문을 다시 확인해야 해요.",
            stateEffect: "none",
            rankingPolicy: "disclosure_only",
          },
          sourceName: "한국소비자원 참가격",
          sourceUrl: "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122",
          sourcePeriod: "2025-11",
          sourcePeriodLabel: "2025년 11월",
          regionScope: "seoul",
          regionLabel: "서울",
          applicabilityKey: "studio",
          applicabilityScopeLabel: "사진 촬영 공시 기본가 하한 참고",
          referenceEffect: "context_only",
        },
      },
      missingItems: [],
      includedItems: [],
    });

    expect(html).toContain("공시 기본가 하한 참고값");
    expect(html).toContain("200만");
    expect(html).toContain("2025년 11월");
    expect(html).toContain("공식 자료");
    expect(html).toContain("2026.07.27 확인");
    expect(html).toContain("지역 · 서울");
    expect(html).toContain("적용 범위 · 사진 촬영 공시 기본가 하한 참고");
    expect(html).toContain("공시 3건");
    expect(html).toContain("업체·대행사 3곳");
    expect(html).toContain("price_min_krw만 사용");
    expect(html).toContain("실제 결제액과 견적 적정성을 뜻하지 않습니다.");
    expect(html).toContain("https://price.go.kr/");
    expect(html).not.toContain("공식 평균");
    expect(html).not.toContain("결혼 비용 시세");
  });

  it("fails closed when a claimed benchmark is missing current public evidence", () => {
    const html = render({
      quotePrice: 250,
      category: "studio",
      marketMedian: 200,
      marketEvidence: { status: "available", observationCount: 1 },
      missingItems: [],
      includedItems: [],
    });

    expect(html).toContain("별도 확인");
    expect(html).not.toContain("200만");
    expect(html).not.toContain("공시 기본가 하한 참고값");
  });

  it("fails closed when persisted official source scope is missing or tampered", () => {
    const html = render({
      quotePrice: 250,
      category: "studio",
      marketMedian: 200,
      marketComparatorLabel: "서울 사진 촬영 공시 기본가 하한 중간값 (3건)",
      marketEvidence: {
        status: "available",
        observationCount: 3,
        vendorCount: 3,
        source: "한국소비자원 참가격",
        sourceUrl: "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122",
        sourcePeriod: "2025년 11월",
        categoryLabel: "사진 촬영",
        regionLabel: "서울",
        calculation: "중간값",
        comparisonBasis: "공시 기본가 하한",
        limitation: "견적 적정성을 뜻하지 않습니다.",
        officialReference: { referenceId: "kca_wedding_service_price_2025_11" },
      },
      missingItems: [],
      includedItems: [],
    });

    expect(html).toContain("별도 확인");
    expect(html).not.toContain("200만");
    expect(html).not.toContain("공시 기본가 하한 참고값");
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

  it("submits a bounded v2 context with the exact checklist ID partition", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const items = getQuoteCheckItems("studio", "seoul");
    const result: ToolExecutionResult = {
      toolName: "analyze_quote",
      toolInput: {},
      toolOutput: {
        mode: "checklist",
        quotePrice: 300,
        category: "studio",
        region: "seoul",
        vendorName: "테스트 스튜디오",
        checklistItems: items,
      },
      success: true,
      displayMessage: "견적 체크",
    };
    const onSend = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<QuoteAnalysisCard result={result} onSend={onSend} />));
    const submit = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("확인 질문 정리하기"));
    await act(async () => submit?.click());

    expect(onSend).toHaveBeenCalledTimes(1);
    const message = String(onSend.mock.calls[0]?.[0]);
    expect(message).toContain("[quote_analysis_v2]");
    expect(parseCanonicalQuoteAnalysisSelection(message)).toMatchObject({
      status: "valid",
      category: "studio",
      region: "seoul",
      quotePriceManwon: 300,
      vendorName: "테스트 스튜디오",
      includedItems: [],
      notNeededItems: [],
      unknownItems: items.map((item) => item.id),
    });

    await act(async () => root.unmount());
  });
});
