import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useAmoraPreparationActions } from "./useAmoraPreparationActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const version = "2026-10-12T00:00:00.123456Z";
const nextVersion = "2026-10-12T00:00:00.123457Z";
const action = { id: "act_deadline_qa", title: "합성 준비", status: "open", source: "manual", priority: "medium",
  description: "처음 내용", createdAt: version, updatedAt: version, viewVersion: version };
const current = { ...action, description: "다른 탭의 내용", updatedAt: nextVersion, viewVersion: nextVersion };
const owner = { user: { id: "deadline-user", email: "deadline@example.invalid" }, profile: {
  id: "deadline-user", name: "합성", role: "bride" as const, couple_id: "deadline-couple", avatar_url: null,
  onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: version, updated_at: version,
}, isInitialized: true, isDemo: false };
let latest: ReturnType<typeof useAmoraPreparationActions>;
function Harness() {
  const result = useAmoraPreparationActions();
  useEffect(() => { latest = result; }, [result]);
  return <div />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("bounded preparation action saves with the real owner store", () => {
  const originalAuth = useAuthStore.getState();
  const fetchMock = vi.fn();
  let root: Root;
  let container: HTMLDivElement;
  let unmounted = false;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    useAuthStore.setState(owner);
    fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    unmounted = false;
  });
  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(originalAuth);
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });
  async function mount() {
    fetchMock.mockResolvedValueOnce(Response.json({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
  }
  it("stops waiting after 15s, retains uncertainty and reads once without retrying the mutation", async () => {
    await mount();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockResolvedValueOnce(Response.json({ action: current }));
    let updating!: Promise<boolean>;
    await act(async () => { updating = latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(latest.updatingIds.size).toBe(0);
    expect(await updating).toBe(false);
    expect(latest.updateIssues[action.id]).toMatchObject({ kind: "uncertain", availability: "current", latest: current });
    expect(latest.actions[0]?.description).toBe(action.description);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json({ action: { ...current, description: "내 초안" } })));
    expect(latest.actions[0]?.description).toBe(action.description);
    expect(latest.updateIssues[action.id]?.kind).toBe("uncertain");
  });
  it("keeps the server's unconfirmed outcome uncertain even when the recovery value equals the draft", async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(Response.json({ code: "AMORA_ACTION_OUTCOME_UNCONFIRMED" }, { status: 503 }));
    fetchMock.mockResolvedValueOnce(Response.json({ action: { ...current, description: "내 초안" } }));
    await act(async () => {
      expect(await latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(latest.updateIssues[action.id]?.kind).toBe("uncertain");
    expect(latest.actions[0]?.description).toBe(action.description);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
  });
  it("also releases pending when the independent recovery body ignores its 10s abort", async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(Response.json({ code: "AMORA_ACTION_CONFLICT" }, { status: 409 }));
    const body = deferred<unknown>();
    const recovery = Response.json({ action: current });
    vi.spyOn(recovery, "json").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(recovery);
    let updating!: Promise<boolean>;
    await act(async () => { updating = latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(latest.updatingIds.size).toBe(0);
    expect(await updating).toBe(false);
    expect(latest.updateIssues[action.id]).toEqual({ kind: "conflict", availability: "unknown" });
    await act(async () => body.resolve({ action: current }));
    expect(latest.updateIssues[action.id]?.availability).toBe("unknown");
    expect(latest.actions[0]?.description).toBe(action.description);
  });
  it("ends a stalled foreground body without dropping the previous list or accepting a late page", async () => {
    await mount();
    const body = deferred<unknown>(); const response = Response.json({ actions: [current], count: 1, open_count: 1 });
    vi.spyOn(response, "json").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(response);
    let reading!: Promise<void>;
    await act(async () => { reading = latest.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(latest.loading).toBe(false);
    expect(latest.error).toContain("불러오지 못했어요");
    expect(latest.actions[0]?.description).toBe(action.description);
    await reading;
    await act(async () => body.resolve({ actions: [current], count: 1, open_count: 1 }));
    expect(latest.actions[0]?.description).toBe(action.description);
  });
  it("ends a stalled create body, preserves the same explicit request and does not promote a late receipt", async () => {
    await mount();
    const body = deferred<unknown>(); const response = Response.json({});
    vi.spyOn(response, "json").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(response);
    let creating!: Promise<boolean>;
    await act(async () => { creating = latest.create({ title: action.title, description: "내 초안" }); });
    const requestId = JSON.parse(fetchMock.mock.calls[1][1].body).requestId;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(latest.creating).toBe(false);
    expect(await creating).toBe(false);
    expect(latest.createLocked).toBe(true);
    expect(latest.updateError).toContain("저장 결과를 확인하지 못했어요");
    await act(async () => body.resolve({ action: { ...current, description: "내 초안" }, requestId, replayed: false }));
    expect(latest.createLocked).toBe(true);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "POST"]);
  });
  it("does not add another 15s to creation just for the post-receipt list read", async () => {
    await mount();
    const post = deferred<Response>(); const list = deferred<Response>();
    fetchMock.mockReturnValueOnce(post.promise); fetchMock.mockReturnValueOnce(list.promise);
    let creating!: Promise<boolean>;
    await act(async () => { creating = latest.create({ title: action.title }); });
    const requestId = JSON.parse(fetchMock.mock.calls[1][1].body).requestId;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
      post.resolve(Response.json({ action: { ...action, description: undefined }, requestId, replayed: false }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(latest.creating).toBe(false);
    // POST 영수증은 이미 검증됐다. 뒤의 조회 실패를 저장 미확정으로 바꾸지 않는다.
    expect(await creating).toBe(true);
    expect(latest.error).toContain("불러오지 못했어요");
    expect(latest.createLocked).toBe(false);
    await act(async () => list.resolve(Response.json({ actions: [current], count: 1, open_count: 1 })));
    expect(latest.actions[0]?.description).toBe(action.description);
  });
  it("keeps the 15s budget running after mutation headers rather than resetting it for the body", async () => {
    await mount();
    const headers = deferred<Response>(); const body = deferred<unknown>();
    const response = Response.json({ action: current }); vi.spyOn(response, "json").mockImplementation(() => body.promise);
    fetchMock.mockReturnValueOnce(headers.promise); fetchMock.mockResolvedValueOnce(Response.json({ action: current }));
    let updating!: Promise<boolean>;
    await act(async () => { updating = latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); headers.resolve(response); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(latest.updatingIds.has(action.id)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(latest.updatingIds.size).toBe(0); expect(await updating).toBe(false);
    expect(latest.updateIssues[action.id]?.kind).toBe("uncertain");
    await act(async () => body.resolve({ action: { ...current, description: "내 초안" } }));
    expect(latest.actions[0]?.description).toBe(action.description);
  });
  it.each(["owner", "unmount"])("immediately aborts a pending mutation on %s and ignores its late receipt", async reason => {
    await mount();
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
    let updating!: Promise<boolean>;
    await act(async () => { updating = latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope }); });
    const signal: AbortSignal = fetchMock.mock.calls[1][1].signal;
    fetchMock.mockResolvedValueOnce(Response.json({ actions: [], count: 0, open_count: 0 }));
    await act(async () => {
      if (reason === "owner") useAuthStore.setState({ user: { id: "next-user", email: "next@example.invalid" }, profile: { ...owner.profile, id: "next-user", couple_id: "next-couple" } });
      else { root.unmount(); unmounted = true; }
    });
    expect(signal.aborted).toBe(true); expect(await updating).toBe(false);
    await act(async () => pending.resolve(Response.json({ action: { ...current, description: "내 초안" } })));
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
    if (reason === "owner") { expect(latest.actions).toEqual([]); expect(latest.updateIssues).toEqual({}); }
  });
  it("keeps a generic unavailable 503 distinct from an unconfirmed write", async () => {
    await mount();
    fetchMock.mockResolvedValueOnce(Response.json({ code: "AMORA_ACTION_UNAVAILABLE" }, { status: 503 }));
    fetchMock.mockResolvedValueOnce(Response.json({ action: current }));
    await act(async () => { expect(await latest.update(action.id, { description: "내 초안" }, { version, ownerScope: latest.ownerScope })).toBe(false); });
    expect(latest.updateIssues[action.id]?.kind).toBe("unavailable");
    expect(latest.actions[0]?.description).toBe(action.description);
  });
});
