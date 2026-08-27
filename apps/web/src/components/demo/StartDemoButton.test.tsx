import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_AMORA_PREFILL_STORAGE_KEY } from "@/lib/chat/demoHandoff";

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

import { StartDemoButton } from "./StartDemoButton";

describe("StartDemoButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 이 파일은 **공개 체험이 켜진 상태**의 동작을 잰다. 기본값은 꺼짐이므로 명시한다
    // (닫힌 상태는 publicDemoTrialIsClosed.test.ts 가 잰다).
    vi.stubEnv("NEXT_PUBLIC_DEMO_TRIAL_ENABLED", "true");
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ alreadySignedIn: false }),
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens Amora directly and carries a one-time draft after demo setup", async () => {
    await act(async () => {
      root.render(
        <StartDemoButton
          label="이 날짜로 아모라에게 물어보기"
          prefill="이번 주에 할 일 하나를 골라줘"
          analyticsSource="start_here_priorities"
        />,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("이 날짜로 아모라에게 물어보기");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetch).toHaveBeenCalledWith("/api/demo/start", {
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "이번 주에 할 일 하나를 골라줘",
    );
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
    expect(mocks.push).not.toHaveBeenCalledWith("/wedding/lounge");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_amora_start_click",
      { source: "start_here_priorities" },
    );
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_amora_start_result",
      { source: "start_here_priorities", result: "success" },
    );
  });

  it("keeps the current result and offers a retry when setup fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await act(async () => root.render(<StartDemoButton />));

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "다시 눌러 주세요",
    );
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it("records an authenticated handoff separately from a login-free demo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ alreadySignedIn: true }),
    } as unknown as Response);
    await act(async () => root.render(
      <StartDemoButton analyticsSource="start_here_early" prefill="예산 기준부터" />,
    ));

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_amora_start_result",
      { source: "start_here_early", result: "signed_in" },
    );
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
  });
});
