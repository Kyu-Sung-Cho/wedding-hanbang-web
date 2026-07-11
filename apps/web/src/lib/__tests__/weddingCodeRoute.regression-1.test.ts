import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-006 — /check forced a failed RSC request before redirecting.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("WeddingCode result next-action route regression", () => {
  it("links directly to the canonical quote-check page", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/wedding-code/result/ResultClient.tsx"),
      "utf8"
    );

    expect(source).toContain('href="/wedding/community/quote-check"');
    expect(source).not.toContain('href="/check"');
  });
});
