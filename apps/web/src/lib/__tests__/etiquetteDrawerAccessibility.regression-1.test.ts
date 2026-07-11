import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-011 — the mobile etiquette drawer opener was unnamed and
// the drawer had no modal focus, Escape, or return-focus behavior.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("etiquette mobile drawer accessibility regression", () => {
  it("keeps the drawer named, modal, keyboard closable, and focus restoring", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/app/etiquette/EtiquetteClient.tsx"),
      "utf8"
    );

    expect(source).toContain("useAccessibleDialog({");
    expect(source).toContain("returnFocusRef: sidebarTriggerRef");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-label="전체 예절 목록"');
    expect(source).toContain('aria-label="전체 예절 목록 열기"');
    expect(source).toContain('aria-label="전체 예절 목록 닫기"');
    expect(source).toContain("data-dialog-initial-focus");
  });
});
