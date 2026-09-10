import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AmoraActionItem } from "@/lib/amora/actions";

const mocks = vi.hoisted(() => ({ auth: {
  user: { id: "user-a" }, profile: { id: "user-a", couple_id: "couple-a" },
  isDemo: false, isInitialized: true, journey: { progress: {} },
} }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth), {
    getState: () => mocks.auth,
    subscribe: () => () => undefined,
  }),
}));
import { useAmoraPreparationActions } from "./useAmoraPreparationActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const action: AmoraActionItem = {
  id: "act_shared", title: "업체 전화", status: "open", source: "manual", priority: "medium",
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
};
function response(actions: AmoraActionItem[], nextCursor: string | null = null, count = actions.length) {
  return Response.json({ actions, count, open_count: actions.filter(item => item.status === "open").length, next_cursor: nextCursor });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const results = new Map<string, ReturnType<typeof useAmoraPreparationActions>>();
function snapshot(name = "reader") {
  const value = results.get(name);
  if (!value) throw new Error(`missing mounted hook: ${name}`);
  return value;
}
function Harness({ name }: { name: string }) {
  const value = useAmoraPreparationActions();
  useEffect(() => { results.set(name, value); }, [name, value]);
  return <div>{value.actions.map(item => <p key={item.id}>{item.title}</p>)}</div>;
}

describe("preparation actions open-tab synchronization", () => {
  const fetchMock = vi.fn();
  const mounts: { root: Root; container: HTMLDivElement }[] = [];
  let visible = true;
  let online = true;
  async function mount(name = "reader") {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounts.push({ root, container });
    await act(async () => root.render(<Harness name={name} />));
    return root;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    visible = true; online = true;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    mocks.auth.user = { id: "user-a" };
    mocks.auth.profile = { id: "user-a", couple_id: "couple-a" };
    mocks.auth.isDemo = false;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    results.clear();
  });
  afterEach(async () => {
    for (const { root, container } of mounts.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  it("updates an independently mounted empty task list after another surface saves a task", async () => {
    let serverActions: AmoraActionItem[] = [];
    fetchMock.mockImplementation((_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        const body = z.object({ requestId: z.string(), title: z.string(), expectedOwnerId: z.literal("user-a"), expectedCoupleId: z.literal("couple-a") }).parse(JSON.parse(String(options.body)));
        serverActions = [{ ...action, title: body.title }];
        return Response.json({ action: serverActions[0], requestId: body.requestId, replayed: false });
      }
      return response(serverActions);
    });
    await mount("writer"); await mount();
    await act(async () => { expect(await snapshot("writer").create({ title: action.title })).toBe(true); });
    expect(snapshot("writer").open_count).toBe(1);
    expect(snapshot().open_count).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(snapshot().actions).toEqual([action]);
    expect(snapshot().open_count).toBe(1);
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it.each(["focus", "visibilitychange", "online", "pageshow"])("refreshes on %s without clearing the visible list while reading", async (event) => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await mount();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => { (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(snapshot().loading).toBe(false);
    expect(snapshot().actions).toEqual([action]);
    const changed: AmoraActionItem = { ...action, status: "done", description: "견적 확인 완료", dueDate: "2026-09-12" };
    await act(async () => pending.resolve(response([changed])));
    expect(snapshot().actions).toEqual([changed]);
    expect(snapshot().open_count).toBe(0);
  });

  it("coalesces resume events and never overlaps a pending read", async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    await mount();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(response([action])));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not poll hidden or offline tabs and reads immediately when they become usable", async () => {
    fetchMock.mockImplementation(() => response([]));
    await mount();
    visible = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visible = true; online = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    online = true;
    fetchMock.mockImplementation(() => response([action]));
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(snapshot().actions).toEqual([action]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late background read after the account scope changes", async () => {
    fetchMock.mockResolvedValueOnce(response([action]));
    const root = await mount();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const oldOptions = z.object({ signal: z.instanceof(AbortSignal) }).parse(fetchMock.mock.calls[1][1]);
    mocks.auth.user = { id: "user-b" };
    mocks.auth.profile = { id: "user-b", couple_id: "couple-b" };
    const newAction = { ...action, id: "act_b", title: "새 준비 공간" };
    fetchMock.mockResolvedValueOnce(response([newAction]));
    await act(async () => root.render(<Harness name="reader" />));
    expect(oldOptions.signal.aborted).toBe(true);
    await act(async () => pending.resolve(response([{ ...action, title: "이전 계정 늦은 응답" }])));
    expect(snapshot().actions).toEqual([newAction]);
  });

  it("stops synchronization on unmount and aborts its pending read", async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    await mount();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const options = z.object({ signal: z.instanceof(AbortSignal) }).parse(fetchMock.mock.calls[1][1]);
    const owned = mounts.pop();
    if (!owned) throw new Error("missing mount");
    await act(async () => owned.root.unmount());
    owned.container.remove();
    expect(options.signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(response([action]));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not query over a pending mutation or let an older poll undo its receipt", async () => {
    fetchMock.mockResolvedValueOnce(response([action]));
    await mount();
    const oldRead = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const patch = deferred<Response>();
    fetchMock.mockReturnValueOnce(patch.promise);
    let updating!: Promise<boolean>;
    await act(async () => { updating = snapshot().update(action.id, { status: "done" }); });
    await act(async () => {
      oldRead.resolve(response([action]));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const done: AmoraActionItem = { ...action, status: "done" };
    await act(async () => { patch.resolve(Response.json({ action: done })); expect(await updating).toBe(true); });
    expect(snapshot().actions).toEqual([done]);
    fetchMock.mockResolvedValueOnce(response([done]));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(snapshot().open_count).toBe(0);
  });

  it("refreshes already expanded pages atomically without collapsing them to the first page", async () => {
    const older = { ...action, id: "act_old", title: "이전 할 일" };
    fetchMock.mockResolvedValueOnce(response([action], "old", 2));
    await mount();
    fetchMock.mockResolvedValueOnce(response([older], null, 2));
    await act(async () => snapshot().loadMore());
    const changed = { ...action, title: "새 제목" };
    const olderChanged = { ...older, description: "다른 탭에서 수정" };
    fetchMock.mockResolvedValueOnce(response([changed], "new-old", 2));
    const secondPage = deferred<Response>();
    fetchMock.mockReturnValueOnce(secondPage.promise);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toContain("cursor=new-old");
    expect(snapshot().actions).toEqual([action, older]);
    expect(snapshot().loading).toBe(false);
    await act(async () => secondPage.resolve(response([olderChanged], null, 2)));
    expect(snapshot().actions).toEqual([changed, olderChanged]);
    expect(snapshot().nextCursor).toBeNull();
  });

  it("keeps the previous complete snapshot if a later background page fails and recovers on the next poll", async () => {
    const older = { ...action, id: "act_old" };
    fetchMock.mockResolvedValueOnce(response([action], "old", 2));
    await mount();
    fetchMock.mockResolvedValueOnce(response([older], null, 2));
    await act(async () => snapshot().loadMore());
    fetchMock.mockResolvedValueOnce(response([{ ...action, title: "partial" }], "old", 2));
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(snapshot().actions).toEqual([action, older]);
    expect(snapshot().error).toContain("불러오지 못했어요");
    fetchMock.mockResolvedValueOnce(response([action], "old", 2));
    fetchMock.mockResolvedValueOnce(response([older], null, 2));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(snapshot().error).toBeNull();
    expect(snapshot().actions).toEqual([action, older]);
  });

  it("times out a background read and allows the following poll to recover", async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    await mount();
    fetchMock.mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(snapshot().error).toContain("불러오지 못했어요");
    fetchMock.mockResolvedValueOnce(response([action]));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(snapshot().actions).toEqual([action]);
    expect(snapshot().error).toBeNull();
  });

  it("does not attach server synchronization to demo data", async () => {
    mocks.auth.isDemo = true;
    await mount();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot().isDemo).toBe(true);
  });
});
