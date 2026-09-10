import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";
import type { AmoraActionItem } from "@/lib/amora/actions";
import { useAmoraPreparationActions } from "./useAmoraPreparationActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const action: AmoraActionItem = {
  id: "act_a", title: "첫 조회", status: "open", source: "chat", priority: "medium",
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
};
function owner(user = "user-a", couple = "couple-a") {
  const profile: Profile = {
    id: user, name: user, role: "bride", couple_id: couple, avatar_url: null,
    onboarding_completed: true, onboarding_step: 5, is_admin: false,
    created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
  };
  return { user: { id: user, email: `${user}@example.invalid` }, profile, isInitialized: true, isDemo: false };
}
function response(items: AmoraActionItem[]) {
  return Response.json({ actions: items, count: items.length, open_count: items.filter(item => item.status === "open").length });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let latest: ReturnType<typeof useAmoraPreparationActions>;
function Harness() {
  const value = useAmoraPreparationActions();
  useEffect(() => { latest = value; }, [value]);
  return <div>{value.actions.map(item => <p key={item.id}>{item.title}</p>)}</div>;
}

describe("preparation action auth ownership with the real Zustand store", () => {
  const originalAuth = useAuthStore.getState();
  const fetchMock = vi.fn();
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    useAuthStore.setState(owner());
    fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); useAuthStore.setState(originalAuth);
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  it.each(["manual", "background"])("invalidates a deferred %s response synchronously during a batched A-B-A account switch", async mode => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => root.render(<Harness />));
    const oldRead = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    await act(async () => {
      if (mode === "manual") void latest.refresh();
      else window.dispatchEvent(new Event("focus"));
    });
    const options = z.object({ signal: z.instanceof(AbortSignal) }).parse(fetchMock.mock.calls[1][1]);
    const fresh = { ...action, title: "돌아온 계정에서 다시 확인한 정본" };
    fetchMock.mockResolvedValueOnce(response([fresh]));
    let abortedBeforeReactCommit = false;
    await act(async () => {
      // 중간 B를 React가 그리기 전에 즉시 A로 돌아온다. 수동 rerender를 하지 않는다.
      useAuthStore.setState(owner("user-b", "couple-b"));
      useAuthStore.setState(owner());
      abortedBeforeReactCommit = options.signal.aborted;
      // abort를 무시하는 네트워크를 흉내 내도 오래된 응답을 수락하면 안 된다.
      oldRead.resolve(response([{ ...action, title: "전환 전 지연 응답" }]));
    });
    expect(latest.actions).toEqual([fresh]);
    expect(container.textContent).not.toContain("전환 전 지연 응답");
    expect(abortedBeforeReactCommit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("also invalidates a batched couple A-B-A switch for the same account", async () => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => root.render(<Harness />));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    const options = z.object({ signal: z.instanceof(AbortSignal) }).parse(fetchMock.mock.calls[1][1]);
    const fresh = { ...action, title: "준비 공간 재확인" };
    fetchMock.mockResolvedValueOnce(response([fresh]));
    let abortedBeforeReactCommit = false;
    await act(async () => {
      useAuthStore.setState(owner("user-a", "couple-b"));
      useAuthStore.setState(owner());
      abortedBeforeReactCommit = options.signal.aborted;
      pending.resolve(response([{ ...action, title: "이전 준비 공간 응답" }]));
    });
    expect(latest.actions).toEqual([fresh]);
    expect(abortedBeforeReactCommit).toBe(true);
  });

  it("does not revive a pre-switch PATCH receipt after a batched return to its old owner", async () => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => root.render(<Harness />));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    let updating!: Promise<boolean>;
    await act(async () => { updating = latest.update(action.id, { status: "done" }); });
    const fresh = { ...action, title: "현재 서버 정본" };
    fetchMock.mockResolvedValueOnce(response([fresh]));
    await act(async () => {
      useAuthStore.setState(owner("user-b", "couple-b"));
      useAuthStore.setState(owner());
      pending.resolve(Response.json({ action: { ...action, status: "done" } }));
    });
    expect(await updating).toBe(false);
    expect(latest.actions).toEqual([fresh]);
    expect(latest.updatingIds.size).toBe(0);
  });

  it("keeps an active read when only the current profile's display name changes", async () => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => root.render(<Harness />));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    const options = z.object({ signal: z.instanceof(AbortSignal) }).parse(fetchMock.mock.calls[1][1]);
    await act(async () => useAuthStore.setState({ profile: { ...owner().profile, name: "새 이름" } }));
    expect(options.signal.aborted).toBe(false);
    const fresh = { ...action, title: "같은 범위 정상 응답" };
    await act(async () => pending.resolve(response([fresh])));
    expect(latest.actions).toEqual([fresh]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
