import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomerNav from "../CustomerNav";

vi.mock("@/components/ui/Logo", () => ({
  default: () => <span>웨딩한방</span>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushNativeToggle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CustomerNav mobile menu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("uses native details disclosure and closes from its backdrop", async () => {
    act(() => root.render(<CustomerNav demoMode />));

    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    const menu = container.querySelector<HTMLElement>("#customer-mobile-menu");

    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect(summary?.getAttribute("aria-controls")).toBe("customer-mobile-menu");
    expect(menu?.closest("details:not([open])")).toBe(details);
    expect(details?.open).toBe(false);

    await act(async () => {
      summary?.click();
      await flushNativeToggle();
    });

    expect(details?.open).toBe(true);
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="모바일 메뉴 닫기"]'
    );
    await act(async () => {
      closeButton?.click();
      await flushNativeToggle();
    });

    expect(details?.open).toBe(false);
    expect(summary?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape and restores focus to the summary", async () => {
    act(() => root.render(<CustomerNav />));

    const details = container.querySelector("details")!;
    const summary = container.querySelector<HTMLElement>("summary")!;
    await act(async () => {
      summary.click();
      await flushNativeToggle();
    });
    expect(details.open).toBe(true);

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(escape);
      await flushNativeToggle();
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(document.body.style.overflow).toBe("");
  });
});
