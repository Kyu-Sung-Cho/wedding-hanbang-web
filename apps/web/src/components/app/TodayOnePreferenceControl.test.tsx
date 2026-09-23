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
  ownerId: USER_ID,
  preference: {
    enabled: false,
    optedInAt: null,
    pausedUntil: null,
    dailyLimit: 1,
  },
};
const ON = {
  available: true,
  ownerId: USER_ID,
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
    vi.useRealTimers();
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
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ mode: "enable", expectedOwnerId: USER_ID }) }),
    );
  });

  it("supports confirmed pause, resume, and off without calling an outbound channel", async () => {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const paused = {
      available: true,
      ownerId: USER_ID,
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
      expect.objectContaining({ body: JSON.stringify({ mode: "pause_24h", expectedOwnerId: USER_ID }) }),
    );
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("notifications");
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("proactive");
  });

  it("reads the canonical setting when a mutation receipt is malformed instead of claiming no change", async () => {
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
      }))
      .mockResolvedValueOnce(response(ON)));
    await act(async () => root.render(<TodayOnePreferenceControl />));

    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
    await act(async () => toggle?.click());

    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).not.toContain("기존 설정은 그대로예요");
  });

  it("stays hidden when the rollout is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ available: false })));
    await act(async () => root.render(<TodayOnePreferenceControl />));
    expect(container.textContent).toBe("");
  });

  it("ignores an old account mutation even when the old response arrives last", async () => {
    const mutation = deferredResponse();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(OFF))
      .mockReturnValueOnce(mutation.promise).mockResolvedValueOnce(response({ ...OFF, ownerId: "other-user" }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => useAuthStore.setState({ user: { id: "other-user", email: "other@example.com" } }));
    await act(async () => mutation.resolve(response(ON)));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false);
  });

  it("ends a hung response body and offers read-only recovery without retrying the mutation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(OFF))
      .mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(61_000));
    expect(container.textContent).toContain("변경 결과를 확인하지 못했어요");
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(1);
    expect(container.textContent).toContain("다시 불러오기");
  });

  it("does not hide a failed read behind an unavailable response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ available: false }, false)));
    await act(async () => root.render(<TodayOnePreferenceControl />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not revive an old operation across a batched A to B to A session transition", async () => {
    const mutation = deferredResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(OFF))
      .mockReturnValueOnce(mutation.promise).mockResolvedValueOnce(response(OFF)));
    await act(async () => root.render(<TodayOnePreferenceControl />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => {
      useAuthStore.setState({ user: { id: "other-user", email: "other@example.com" } });
      useAuthStore.setState({ user: { id: USER_ID, email: "today@example.com" } });
    });
    await act(async () => mutation.resolve(response(ON)));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });
  it("does not allow an inverse write after timeout while the first pause is still pending, even after a successful GET", async () => {
    vi.useFakeTimers();
    const mutation = deferredResponse();
    const fetchMock = vi.fn().mockImplementation((_url, options) => options.method === "PUT" ? mutation.promise : Promise.resolve(response(ON)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));
    const pause = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("24시간 쉬기"));
    await act(async () => pause?.click());
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).toContain("조회 시점 설정");
    const reload = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("다시 불러오기"));
    await act(async () => reload?.click());
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(1);
    await act(async () => mutation.resolve(response(ON)));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false);
  });
  it.each([false, true])("late response body settlement (rejected=%s) reloads current state rather than publishing the old payload", async rejected => {
    vi.useFakeTimers();
    let settle!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    const body = new Promise((resolve, fail) => { settle = resolve; reject = fail; });
    let current: unknown = ON;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => options.method === "PUT"
      ? Promise.resolve({ ok: true, json: () => body }) : Promise.resolve(response(current))));
    await act(async () => root.render(<TodayOnePreferenceControl />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(container.querySelector('[role="switch"]')).toBeNull();
    current = OFF;
    await act(async () => { if (rejected) reject(new Error("lost body")); else settle(ON); });
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });
  it("re-reads after the original write settles during a recovery GET and ignores that GET's older snapshot", async () => {
    vi.useFakeTimers();
    const mutation = deferredResponse(); const oldRead = deferredResponse();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(OFF)).mockReturnValueOnce(mutation.promise)
      .mockReturnValueOnce(oldRead.promise).mockResolvedValue(response(ON));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOnePreferenceControl />));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    await act(async () => mutation.resolve(response(ON)));
    await act(async () => oldRead.resolve(response(OFF)));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  });
});
