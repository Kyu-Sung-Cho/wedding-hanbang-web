// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public quote result retirement boundary", () => {
  it("keeps stored quote records out of retired public routes", () => {
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
    expect(quoteCheckPage).toContain("result.marketEvidence.sourcePeriod");
    expect(quoteCheckPage).toContain("result.marketEvidence.observationCount");
    expect(quoteCheckPage).toContain("result.marketEvidence.vendorCount");
    expect(quoteCheckPage).toContain("result.marketEvidence.comparisonBasis");
    expect(quoteCheckPage).toContain("result.marketEvidence.sourceUrl");
    expect(publicPage).toContain("공개 견적 링크 제공을 종료");
    expect(publicPage).not.toContain("createAdminClient");
    expect(publicPage).not.toContain("amora_quote_checks");
    expect(publicApi).toContain("status: 410");
    expect(publicApi).not.toContain("createAdminClient");
    expect(publicApi).not.toContain("amora_quote_checks");
  });
});
