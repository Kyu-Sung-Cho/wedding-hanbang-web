import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("consumer dialog accessibility contract", () => {
  it.each([
    "src/components/app/schedule/EventFormModal.tsx",
    "src/components/app/schedule/CategoryChecklistModal.tsx",
    "src/app/(app)/vendors/[id]/page.tsx",
  ])("keeps %s modal semantics and shared focus management", (path) => {
    const source = readSource(path);

    expect(source).toContain("useAccessibleDialog");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby");
    expect(source).toContain("data-dialog-initial-focus");
  });

  it("uses native radio inputs for the beta applicant role", () => {
    const source = readSource("src/app/beta/BetaForm.tsx");

    expect(source).toContain("<fieldset>");
    expect(source).toContain("<legend");
    expect(source).toContain('type="radio"');
    expect(source).not.toContain('role="radio"');
  });

  it("exposes the beta date picker as a labelled, controlled dialog", () => {
    const source = readSource("src/app/beta/DatePickerPopover.tsx");

    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="예식일 선택"');
    expect(source).toContain("ArrowLeft");
    expect(source).toContain("rovingFocusDay");
    expect(source).not.toContain('role="button"');
  });

  it("announces loading, error, and success states in core consumer flows", () => {
    const bookings = readSource("src/app/(app)/bookings/page.tsx");
    const beta = readSource("src/app/beta/BetaForm.tsx");

    expect(bookings).toContain('role="status"');
    expect(bookings).toContain('role="alert"');
    expect(beta).toContain('role="status"');
    expect(beta).toContain('aria-live="polite"');
  });
});
