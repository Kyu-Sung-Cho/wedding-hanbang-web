import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));

import CelebrationHero from "./CelebrationHero";

describe("CelebrationHero demo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("turns the proposed schedule into a visible applied state", async () => {
    await act(async () => root.render(<CelebrationHero />));

    const applyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("우리 일정에 저장하기"),
    );
    expect(applyButton).toBeDefined();

    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("우리 일정에 저장됐어요");
    expect(container.textContent).toContain("다시 보기");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_amora_demo_apply_click",
      { source: "landing_hero_demo" },
    );
  });
});
