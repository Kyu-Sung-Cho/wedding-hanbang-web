// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VENDOR_ASYMMETRY } from "@/constants/vendorAsymmetry";
import { WC_FACTS } from "@/constants/weddingCodeResult";

const FIXED_PRICE_OR_RATE = /\d[\d,.]*\s*(?:만\s*원|천\s*원|원|%)/u;
const FIXED_MONEY_LITERAL = /(?:₩\s*[\d,]+|[+]?[\d,.]+\s*(?:만\s*원|만원))/u;
const REAL_OR_AMBIGUOUS_VENDOR_NAME =
  /더 리버사이드|더 라움|신라호텔|Vera Wang|Rosa Clara|(?<!샘플 )청담 스튜디오|라온홀|더 컨벤션|(?:^|["'\s])(?:A|B|C)\s*(?:스튜디오|드레스|메이크업)/imu;

const repositoryRoot = resolve(process.cwd(), "../..");

describe("runtime disclosure data boundary", () => {
  it("does not ship fixed market prices or rates as timeless product facts", () => {
    const weddingCodeFacts = Object.values(WC_FACTS).map((fact) => fact.text);
    const vendorGuidance = VENDOR_ASYMMETRY.flatMap((item) => [
      item.title,
      item.pattern,
      item.truth,
      item.defense,
    ]);

    expect([...weddingCodeFacts, ...vendorGuidance].filter((text) =>
      FIXED_PRICE_OR_RATE.test(text)
    )).toEqual([]);
  });

  it("keeps customer-facing price examples input- or disclosure-driven", () => {
    for (const path of [
      "apps/web/src/components/landing/NumbersAnchor.tsx",
      "apps/web/src/components/landing/ProblemReframe.tsx",
      "apps/web/src/components/landing/PainPoints.tsx",
      "apps/web/src/components/landing/Comparison.tsx",
      "apps/web/src/components/customer-landing/CustomerPainPoints.tsx",
      "apps/web/src/components/customer-landing/CustomerSolutions.tsx",
      "apps/web/src/components/app/budget/BudgetContent.tsx",
      "apps/web/src/components/community/CommunityGuide.tsx",
      "apps/mobile/app/budget/index.tsx",
      "apps/mobile/src/components/AppGuide.tsx",
    ]) {
      const source = readFileSync(resolve(repositoryRoot, path), "utf8");
      expect(source, path).not.toMatch(FIXED_MONEY_LITERAL);
    }
  });

  it("uses explicit sample names in runtime copy and ingestion fixtures", () => {
    for (const path of [
      "apps/web/src/lib/ai/tools.ts",
      "apps/web/src/components/onboarding/WeddingDetails.tsx",
      "apps/web/src/app/(app)/settings/page.tsx",
      "apps/web/src/data/vendorFields.ts",
      "apps/web/src/lib/ai/__tests__/amoraMemoryCompiler.test.ts",
      "apps/web/src/lib/ai/__tests__/amoraMemoryCompilerExecution.test.ts",
      "apps/web/src/lib/utils/__tests__/vendorMapper.test.ts",
      "apps/web/src/components/community/PollEditor.tsx",
      "apps/web/scripts/screenshot-responsive.mjs",
      "scripts/ingest/__tests__/partner-dedupe.test.ts",
      "scripts/ingest/__tests__/extract.test.ts",
      "scripts/ingest/__tests__/load.test.ts",
    ]) {
      const source = readFileSync(resolve(repositoryRoot, path), "utf8");
      expect(source, path).not.toMatch(REAL_OR_AMBIGUOUS_VENDOR_NAME);
    }
  });

  it("logs zero-result truth from the fully filtered catalog", () => {
    const source = readFileSync(
      resolve(repositoryRoot, "apps/web/src/components/price/PriceExplorer.tsx"),
      "utf8",
    );

    expect(source).toContain("const searchResultCount = filtered.length");
    expect(source).toContain("zero_result: filtered.length === 0");
    expect(source).not.toContain(
      "filterPriceCatalog(vendors, { search: debouncedSearch }).length",
    );
  });
});
