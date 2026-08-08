import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TodayOnePreferenceControl, {
  __resetTodayOnePreferenceCacheForTests,
} from "./TodayOnePreferenceControl";
import { useAuthStore } from "@/stores/authStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OFF = {
  available: true,
  preference: {
    enabled: false,
    optedInAt: null,
    pausedUntil: null,
    dailyLimit: 1,
  },
};
const ON = {
  available: true,
  preference: {
    enabled: true,
    optedInAt: "2026-08-02T03:00:00.000Z",
    pausedUntil: null,
    dailyLimit: 1,
  },
};

function response(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 503, json: vi.fn().mockResolvedValue(payload) };
}

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("TodayOnePreferenceControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalUser = useAuthStore.getState().user;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    __resetTodayOnePreferenceCacheForTests();
    useAuthStore.setState({ user: { id: USER_ID, email: "today@example.com" } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ user: originalUser });
    __resetTodayOnePreferenceCacheForTests();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows an explicit default-off in-app control separated from outbound delivery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(OFF)));
    await act(async () => root.render(<TodayOnePreferenceControl />));

    expect(container.textContent).toContain("아모라 오늘의 한 가지(인앱)");
    expect(container.textContent).toContain("일정·예산에서 지금 확인할 한 가지");
    expect(container.textContent).toContain("대시보드 안에서만");
    expect(container.textContent).toContain("푸시·문자·이메일을 보내지 않아요");
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("does not flip the switch until the server confirms opt-in", async () => {
    const mutation = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(OFF))
      .mockReturnValueOnce(mutation.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));

    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).not.toContain("사용 중");

    await act(async () => mutation.resolve(response(ON)));
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("사용 중");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/amora/today-one/preferences",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ mode: "enable" }) }),
    );
  });

  it("supports confirmed pause, resume, and off without calling an outbound channel", async () => {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const paused = {
      available: true,
      preference: {
        ...ON.preference,
        pausedUntil,
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(ON))
      .mockResolvedValueOnce(response(paused));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));

    const pause = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "24시간 쉬기",
    );
    await act(async () => pause?.click());
    expect(container.textContent).toContain("일시정지 중");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/amora/today-one/preferences",
      expect.objectContaining({ body: JSON.stringify({ mode: "pause_24h" }) }),
    );
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("notifications");
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("proactive");
  });

  it("keeps the previous setting when a success response is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(OFF))
      .mockResolvedValueOnce(response({
        available: true,
        preference: {
          enabled: true,
          optedInAt: null,
          pausedUntil: null,
          dailyLimit: 1,
        },
      })));
    await act(async () => root.render(<TodayOnePreferenceControl />));

    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
    await act(async () => toggle?.click());

    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "기존 설정은 그대로예요",
    );
  });

  it("stays hidden when the rollout is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ available: false })));
    await act(async () => root.render(<TodayOnePreferenceControl />));
    expect(container.textContent).toBe("");
  });
});
