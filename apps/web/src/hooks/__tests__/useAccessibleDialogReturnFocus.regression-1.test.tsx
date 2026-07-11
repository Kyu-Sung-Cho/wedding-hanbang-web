import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAccessibleDialog } from "../useAccessibleDialog";

// Regression: ISSUE-008 — async report generation disabled the opener before
// the dialog mounted, so closing the report returned focus to the document body.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DialogHarness({ isOpen }: { isOpen: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { dialogRef } = useAccessibleDialog({
    isOpen,
    onClose: () => undefined,
    returnFocusRef: triggerRef,
  });

  return (
    <>
      <button ref={triggerRef}>리포트 이미지로 저장·공유</button>
      {isOpen && (
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
          <button data-dialog-initial-focus>닫기</button>
        </div>
      )}
    </>
  );
}

describe("accessible dialog explicit return focus regression", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("returns focus to the explicit opener even when it was not focused at mount", () => {
    act(() => root.render(<DialogHarness isOpen />));

    expect(document.activeElement?.textContent).toBe("닫기");

    act(() => root.render(<DialogHarness isOpen={false} />));

    expect(document.activeElement?.textContent).toBe("리포트 이미지로 저장·공유");
    expect(document.body.style.overflow).toBe("");
  });
});
