import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("legacy quote record truth contract", () => {
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

  it("retires old shared results instead of interpreting or re-sharing them", () => {
    const api = readSource("src/app/api/amora/quote-check/[id]/public/route.ts");
    const page = readSource("src/app/quote/[id]/page.tsx");
    expect(api).toContain("quote_check_public_read_retired");
    expect(api).toContain("status: 410");
    expect(api).not.toMatch(/createAdminClient|amora_quote_checks|params/);
    expect(page).toContain("PublicBetaUnavailable");
    expect(page).toContain('feature="quoteChecklist"');
  });
});
