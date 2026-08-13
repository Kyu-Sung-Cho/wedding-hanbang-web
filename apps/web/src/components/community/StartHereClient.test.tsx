import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_AMORA_PREFILL_STORAGE_KEY } from "@/lib/chat/demoHandoff";
import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

const HANDOFF_ID = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  captureEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: mocks.captureEvent,
}));

import StartHereClient from "./StartHereClient";

describe("StartHereClient first visit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T09:00:00+09:00"));
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => HANDOFF_ID });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ alreadySignedIn: false }),
    }));
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/start-here#date=2027-05-01");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("turns one date into a calm priority and hands it directly to Amora", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(container.textContent).toContain(
      "기본 확인 시점은 지났지만, 지금부터 하나씩 확인해요",
    );
    expect(container.textContent).not.toMatch(/\d+일 지남/);

    const amoraButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("이 날짜로 아모라에게 물어보기"),
    );
    expect(amoraButton).toBeDefined();

    await act(async () => {
      amoraButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const handoff = window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY);
    expect(handoff).toContain("결혼식 날짜는 2027-05-01");
    expect(handoff).toContain("이번 주에 할 한 가지만");
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
  });

  it("keeps the landing date and renders priorities when effects replay in Strict Mode", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <StartHereClient />
        </StrictMode>,
      );
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(window.location.hash).toBe("");
  });

  it("consumes the browser-only landing handoff after a client-side route change", async () => {
    window.history.replaceState({}, "", "/start-here");
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");

    await act(async () => {
      root.render(
        <StrictMode>
          <StartHereClient />
        </StrictMode>,
      );
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("prefers an explicit fragment date over a stale stored handoff", async () => {
    window.history.replaceState({}, "", "/start-here#date=2028-06-02");
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");

    await act(async () => root.render(<StartHereClient />));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2028-06-02",
    );
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("uses the fragment and clears it even when session storage cannot be read", async () => {
    window.history.replaceState({}, "", "/start-here#date=2028-06-02");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    await act(async () => root.render(<StartHereClient />));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2028-06-02",
    );
    expect(window.location.hash).toBe("");
  });

  it("offers a direct Amora path when the couple has not chosen a date yet", async () => {
    window.history.replaceState({}, "", "/start-here");
    await act(async () => {
      root.render(<StartHereClient />);
    });

    const undatedButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("날짜 없이 기준부터 물어보기"),
    );
    expect(undatedButton).toBeDefined();

    const smallWeddingButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("작게 준비해요"),
    );
    await act(async () => smallWeddingButton?.click());

    await act(async () => {
      undatedButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "아직 결혼식 날짜가 정해지지 않았어요",
    );
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "결혼식은 작게 준비하고 싶어요",
    );
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_amora_start_click",
      { source: "start_here_without_date" },
    );
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
  });

  it("renders wedding-day and post-wedding checklist windows without negative D-minus copy", async () => {
    window.history.replaceState({}, "", "/start-here");
    await act(async () => root.render(<StartHereClient />));

    expect(container.textContent).toContain("D-day");
    expect(container.textContent).toContain("D+30");
    expect(container.textContent).not.toContain("-30일 전");
  });

  it("does not leave very-early planners at a dead end", async () => {
    window.history.replaceState({}, "", "/start-here#date=2030-05-01");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    for (const startingPoint of [
      "편안한 예산 범위",
      "초대할 사람의 범위",
      "원하는 크기와 분위기",
    ]) {
      expect(container.textContent).toContain(startingPoint);
    }
    expect(container.textContent).toContain("이 세 가지를 아모라와 정하기");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_result_viewed",
      { source: "early" },
    );
  });

  it("includes the new shared-decision foundation at the 301–360 day boundary", async () => {
    window.history.replaceState({}, "", "/start-here#date=2027-07-01");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const priorityItems = container.querySelectorAll("#start-result-panel ol > li");
    expect(priorityItems).toHaveLength(3);
    expect(priorityItems[0]?.textContent).toContain("함께 정할 것");
    expect(container.textContent).toContain("부모님 첫 만남");
    expect(container.textContent).toContain("예식·모임 장소");
    expect(container.textContent).toContain("기본 확인 시점까지");
  });

  it("treats a past date as a correction state instead of expired priorities", async () => {
    window.history.replaceState({}, "", "/start-here#date=2026-07-31");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("이미 지난 날짜예요.");
    expect(container.textContent).toContain("다른 날짜 선택하기");
    expect(container.textContent).not.toContain("지금은 이것부터");
    expect(container.textContent).not.toContain("이 날짜로 아모라에게 물어보기");
  });

  it("keeps the visible priorities for signup without putting them in the URL", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const signupLink = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("계정 베타로 계속 관리하기"),
    );
    expect(signupLink?.getAttribute("href")).toBe(
      "/login?mode=signup&redirect=%2Fwedding%2Fchat&source=start-here",
    );
    signupLink?.addEventListener("click", (event) => event.preventDefault());
    await act(async () => {
      signupLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "결혼식 날짜는 2027-05-01",
    );
    expect(mocks.push).toHaveBeenCalledWith(
      `/login?mode=signup&redirect=%2Fwedding%2Fchat%3FstartHereHandoff%3D${HANDOFF_ID}&source=start-here`,
    );
    expect(window.location.search).toBe("");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_signup_click",
      { source: "priorities" },
    );
  });

  it("tracks only a bounded date-selection state without the selected date", async () => {
    window.history.replaceState({}, "", "/start-here");
    await act(async () => root.render(<StartHereClient />));
    const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(dateInput, "2027-06-07");
      dateInput?.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_date_selected",
      { source: "date_input" },
    );
    expect(JSON.stringify(mocks.captureEvent.mock.calls)).not.toContain("2027-06-07");
  });

  it("keeps the mobile result below the sticky header when using the jump link", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector("#start-result-panel")?.className).toContain(
      "scroll-mt-16",
    );
  });
});
