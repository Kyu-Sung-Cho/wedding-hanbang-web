// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePublicQuoteAnalysis } from "./publicResult";

describe("public quote result retirement boundary", () => {
  it("suppresses legacy static medians and source claims from saved records", () => {
    const analysis = normalizePublicQuoteAnalysis({
      category: "studio",
      quotePriceManwon: 320,
      marketMedianManwon: 250,
      marketComparatorLabel: "서울 스튜디오 중위가",
      priceDiffPercent: 28,
      missingCriticalCount: 1,
      missingHighCount: 2,
      missingMediumCount: 3,
      summaryTitle: "서울 평균 250만원보다 비싼 견적이에요",
      summaryText: "과거 비교율을 근거로 판단한 설명",
      sourceNote: "과거 고정 시세 기준",
    }, "studio");

    expect(analysis).toMatchObject({
      marketMedianManwon: 0,
      marketComparatorLabel: "업체별 최신 공시가 확인 필요",
      priceDiffPercent: 0,
    });
    expect(analysis?.sourceNote).toContain("가격의 적정성을 판정하지 않습니다");
    expect(analysis?.sourceNote).not.toContain("과거 고정 시세");
    expect(analysis?.summaryTitle).toBe("핵심 확인 항목 1개가 견적서에서 확인되지 않았어요");
    expect(analysis?.summaryText).not.toContain("과거 비교율");
  });

  it("rejects malformed stored analysis instead of rendering NaN or crashing", () => {
    expect(normalizePublicQuoteAnalysis(null, "studio")).toBeNull();
    expect(normalizePublicQuoteAnalysis({ quotePriceManwon: "not-a-price" }, "studio")).toBeNull();
    expect(normalizePublicQuoteAnalysis({ quotePriceManwon: -1 }, "studio")).toBeNull();
    expect(normalizePublicQuoteAnalysis({ quotePriceManwon: 320 }, "studio")).toBeNull();
  });

  it("does not promise retired aggregate comparisons in consumer copy", () => {
    const quoteCheckPage = readFileSync(
      resolve(process.cwd(), "src/app/(community)/community/quote-check/page.tsx"),
      "utf8",
    );
    const publicPage = readFileSync(
      resolve(process.cwd(), "src/app/quote/[id]/page.tsx"),
      "utf8",
    );
    const publicApi = readFileSync(
      resolve(process.cwd(), "src/app/api/amora/quote-check/[id]/public/route.ts"),
      "utf8",
    );

    expect(quoteCheckPage).not.toContain("한국소비자원 평균 가격");
    expect(quoteCheckPage).not.toContain("가격 비교는 한국소비자원 평균");
    expect(quoteCheckPage).not.toContain('value="평균"');
    expect(quoteCheckPage).not.toContain('useState("320")');
    expect(publicPage).not.toContain("한국소비자원 같은 지역 중위가");
    expect(publicApi).toContain("normalizePublicQuoteAnalysis");
    expect(publicApi).not.toContain("analysis.marketMedianManwon");
  });
});
