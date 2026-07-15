import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-006 — /check forced a failed RSC request before redirecting.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("WeddingCode physical retirement regression", () => {
  it("keeps the former result route on the unavailable surface", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/wedding-code/result/page.tsx"),
      "utf8"
    );

    expect(source).toContain("PublicBetaUnavailable");
    expect(source).toContain('feature="weddingCode"');
    expect(source).not.toContain("/community/quote-check");
    expect(source).not.toContain('href="/check"');
    expect(
      existsSync(join(process.cwd(), "src/app/wedding-code/result/ResultClient.tsx"))
    ).toBe(false);
  });
});
