import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ captureEvent: mocks.captureEvent }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import TransformationHero from "./TransformationHero";
import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

describe("TransformationHero product demo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows one concrete proposal and keeps the applied example to that item", async () => {
    await act(async () => root.render(<TransformationHero />));

    expect(container.textContent).toContain("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간");
    expect(container.textContent).toContain("아모라 · 대화를 정리하는 AI");
    expect(container.textContent).toContain("아모라의 첫 번째 변경 제안");
    expect(container.textContent).toContain("이 일정을 추가할까요?");
    expect(container.textContent).toContain("10월 17일 오후 2시");
    expect(container.textContent).toContain("아직 반영 전");
    expect(container.textContent).not.toContain("세 가지를 찾았어요");
    expect(container.textContent).toContain("실제로 저장되지 않아요");

    const saveFlowButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("이 일정 반영 예시 보기"),
    );
    expect(saveFlowButton).toBeDefined();

    await act(async () => {
      saveFlowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("우리 일정에 반영한 예시");
    expect(container.textContent).toContain("각각 별도 제안과 확인이 필요해요");
    expect(container.textContent).toContain("실제로 저장되지 않아요");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_amora_demo_apply_click",
      { source: "landing_hero_demo" },
    );
  });

  it("hands the optional date to the first-step screen through browser-only storage", async () => {
    await act(async () => root.render(<TransformationHero />));

    const dateInput = container.querySelector<HTMLInputElement>("#landing-wedding-date");
    const startForm = dateInput?.closest("form");
    expect(dateInput).not.toBeNull();
    expect(startForm).not.toBeNull();

    await act(async () => {
      if (!dateInput) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(dateInput, "2027-05-01");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      startForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBe("2027-05-01");
    expect(mocks.push).toHaveBeenCalledWith("/start-here");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_amora_start_click",
      { source: "landing_hero" },
    );
  });

  it("clears an interrupted date handoff before either date-less start path", async () => {
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");
    await act(async () => root.render(<TransformationHero />));

    const dateInput = container.querySelector<HTMLInputElement>("#landing-wedding-date");
    const startForm = dateInput?.closest("form");
    expect(startForm).not.toBeNull();

    await act(async () => {
      startForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith("/start-here");

    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2028-06-02");
    const noDateLink = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("날짜가 아직 없어요"),
    );
    expect(noDateLink).toBeDefined();
    noDateLink?.addEventListener("click", (event) => event.preventDefault());

    await act(async () => {
      noDateLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "landing_amora_start_click",
      { source: "landing_hero_without_date" },
    );
  });
});
