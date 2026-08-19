// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/app/schedule/CategoryChecklistModal.tsx"),
  "utf8",
);

describe("CategoryChecklistModal accessibility contract", () => {
  it("exposes a labelled modal dialog with keyboard close and focus restoration", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("previouslyFocusedRef.current?.focus()");
    expect(source).toContain("document.body.style.overflow = \"hidden\"");
  });

  it("uses checkbox semantics and announces progress and save state", () => {
    expect(source).toContain('role="checkbox"');
    expect(source).toContain("aria-checked={item.done}");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-live="polite"');
  });

  /**
   * 항목 안내(`note`)는 화면에 그려지고, 저장 payload에는 실리지 않는다.
   * 둘 중 하나만 남으면 문구를 써 놓고 아무도 못 보거나, 제품 카피가 사용자 행에 복제된다.
   */
  it("renders the per-item note and strips it before saving", () => {
    expect(source).toContain("{item.note && (");
    expect(source).toContain("{item.note}");
    // 이름은 label, note는 설명. 체크박스 이름에 두 문장이 섞이지 않는다.
    expect(source).toContain("aria-labelledby={`${titleId}-${item.id}-label`}");
    expect(source).toContain("aria-describedby={item.note ?");
    // 저장 경로는 항목 토글과 "해당 없음" 토글 둘뿐이다. 둘 다 거쳐야 한다.
    expect(source).not.toContain("checklist: updated,");
    expect(source.match(/checklist: stripPlanningChecklistNotes\(/g)?.length).toBe(2);
  });
});
