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
});
