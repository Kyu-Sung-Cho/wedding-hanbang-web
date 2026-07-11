import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccessibleDialog } from "../useAccessibleDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DialogHarness({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { dialogRef } = useAccessibleDialog({ isOpen, onClose });

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
      <button data-dialog-initial-focus>첫 번째</button>
      <button>마지막</button>
    </div>
  );
}

describe("useAccessibleDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    trigger = document.createElement("button");
    trigger.textContent = "열기";
    container = document.createElement("div");
    document.body.append(trigger, container);
    trigger.focus();
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("moves focus into the dialog, traps Tab, and restores the trigger focus", () => {
    act(() => root.render(<DialogHarness isOpen onClose={() => undefined} />));

    const buttons = container.querySelectorAll("button");
    expect(document.activeElement).toBe(buttons[0]);
    expect(document.body.style.overflow).toBe("hidden");

    buttons[1].focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => document.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].focus();
    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => document.dispatchEvent(shiftTab));
    expect(document.activeElement).toBe(buttons[1]);

    act(() => root.render(<DialogHarness isOpen={false} onClose={() => undefined} />));
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    act(() => root.render(<DialogHarness isOpen onClose={onClose} />));

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => document.dispatchEvent(escape));

    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
