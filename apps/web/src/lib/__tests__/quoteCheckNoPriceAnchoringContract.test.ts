import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("quote-check price anchoring boundary", () => {
  it("keeps historical public routes on static retirement responses", () => {
    const surfaces = [
      read("apps/web/src/app/quote/[id]/page.tsx"),
      read("apps/web/src/app/api/amora/quote-check/[id]/public/route.ts"),
    ].join("\n");

    expect(surfaces).toContain("quote_check_public_read_retired");
    expect(surfaces).toContain('feature="quoteChecklist"');
    expect(surfaces).not.toMatch(/basicPriceManwon|additionalPaymentManwon|스드메 기본금 평균|추가 지불 평균|createAdminClient|amora_quote_checks/);
  });
});
