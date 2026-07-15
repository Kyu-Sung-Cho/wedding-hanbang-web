import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-012 — settings edit/save/cancel icons were unnamed and
// preference toggle state was visual-only.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("settings control accessibility regression", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/settings/page.tsx"),
    "utf8"
  );

  it("names every profile and journey edit action", () => {
    for (const field of ["계정 이름", "결혼 예정일", "예식장", "설정 예산"]) {
      expect(source).toContain(`aria-label="${field} 편집"`);
      expect(source).toContain(`aria-label="${field} 저장"`);
      expect(source).toContain(`aria-label="${field} 편집 취소"`);
    }
  });

  it("identifies editable inputs and exposes each preference toggle state", () => {
    expect(source).toContain('aria-label="이름 또는 서로 부를 이름"');
    expect(source).toContain('aria-label="결혼 예정일"');
    expect(source).toContain('aria-label="예식장"');
    expect(source).toContain('aria-label="설정 예산 (만원)"');
    expect(source.match(/aria-pressed=\{selected\}/g)).toHaveLength(4);
    expect(source).toContain('role="switch"');
    expect(source).toContain("aria-checked={notifications[item.key]}");
  });
});
