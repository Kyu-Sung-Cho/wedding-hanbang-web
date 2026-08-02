import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));

import TransformationHero from "./TransformationHero";

describe("TransformationHero product demo", () => {
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

  it("moves from conversation to review to a clearly bounded saved-state example", async () => {
    await act(async () => root.render(<TransformationHero />));

    expect(container.textContent).toContain("두 사람의 말에서");
    expect(container.textContent).toContain("실제로 저장되지 않아요");

    const reviewButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("정리한 내용 보기"),
    );
    expect(reviewButton).toBeDefined();

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("이렇게 정리할까요?");
    expect(container.textContent).toContain("총예산 3,000만원");

    const saveFlowButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("확인하고 저장 흐름 보기"),
    );
    expect(saveFlowButton).toBeDefined();

    await act(async () => {
      saveFlowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("확인한 준비만");
    expect(container.textContent).toContain("실제로 저장되지 않아요");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_amora_demo_apply_click",
      { source: "landing_hero_demo" },
    );
  });
});
