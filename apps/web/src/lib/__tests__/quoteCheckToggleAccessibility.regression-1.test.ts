import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-007 — selected quote items had no programmatic pressed state.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("quote-check toggle accessibility regression", () => {
  it("exposes every checklist item's selected state with aria-pressed", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(community)/community/quote-check/page.tsx"),
      "utf8"
    );

    expect(source).toContain("const active = selected.has(item.id)");
    expect(source).toMatch(
      /onClick=\{\(\) => onToggle\(item\.id\)\}[\s\S]{0,120}aria-pressed=\{active\}/
    );
  });
});
