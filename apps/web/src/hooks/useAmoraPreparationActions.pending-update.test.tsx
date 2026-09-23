import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useAmoraPreparationActions } from "@/hooks/useAmoraPreparationActions";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("does not send a contradictory task update while the original raw write remains unresolved", async () => {
  vi.useFakeTimers();
  const A = "51000000-0000-4000-8000-000000000001", C = "52000000-0000-4000-8000-000000000002";
  const original = useAuthStore.getState();
  useAuthStore.setState({ user: { id: A, email: "synthetic@example.invalid" }, profile: { id: A, name: "합성", role: "bride", couple_id: C, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: "2026-09-20", updated_at: "2026-09-20" }, isInitialized: true, isDemo: false });
  const action = { id: "act_synthetic", title: "합성 할 일", source: "manual", priority: "medium", status: "open", createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" };
  let resolveFirst!: (response: Response) => void;
  let patches = 0;
  const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== "PATCH") return Response.json({ actions: [action], count: 1, open_count: 1 });
    patches += 1;
    if (patches === 1) return new Promise<Response>(resolve => { resolveFirst = resolve; });
    return Response.json({ action: { ...action, ...JSON.parse(String(init.body)) } });
  });
  vi.stubGlobal("fetch", transport);
  let current!: ReturnType<typeof useAmoraPreparationActions>;
  function Harness() { const value = useAmoraPreparationActions(); useEffect(() => { current = value; }, [value]); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    let first!: Promise<boolean>;
    await act(async () => { first = current.update(action.id, { status: "done" }); });
    await act(async () => vi.advanceTimersByTimeAsync(30_001)); expect(await first).toBe(false);
    await act(async () => { await current.update(action.id, { status: "dismissed" }); });
    expect(patches).toBe(1);
  } finally {
    if (resolveFirst) await act(async () => resolveFirst(Response.json({ action: { ...action, status: "done" } })));
    await act(async () => root.unmount()); host.remove(); useAuthStore.setState(original); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  }
});

describe("shared update recovery across hook lifetimes", () => {
  let sequence = 0;
  let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
  const views: Record<string, ReturnType<typeof useAmoraPreparationActions>> = {};
  const transport = vi.fn<typeof fetch>();
  let prior: ReturnType<typeof useAuthStore.getState>;
  let row = { id: "act_review", title: "검사 할 일", source: "manual", priority: "medium", status: "open", createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" };
  const page = () => Response.json({ actions: [row], count: 1, open_count: Number(row.status === "open") });
  function Harness({ name }: { name: string }) {
    const state = useAmoraPreparationActions(); useEffect(() => { views[name] = state; }, [name, state]); return null;
  }
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
  };
  beforeEach(() => {
    vi.useFakeTimers(); prior = useAuthStore.getState();
    const id = `71000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
    useAuthStore.getState().reset();
    useAuthStore.setState({ user: { id, email: "synthetic@example.invalid" }, profile: { id, name: "합성", role: "bride", couple_id: "72000000-0000-4000-8000-000000000002", avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: "2026-09-20", updated_at: "2026-09-20" }, isInitialized: true, isDemo: false });
    row = { ...row, status: "open" };
    transport.mockReset().mockImplementation(async (_url, init) => {
      if (init?.method !== "PATCH") return page();
      row = { ...row, ...JSON.parse(String(init.body)) }; return Response.json({ action: row });
    });
    vi.stubGlobal("fetch", transport);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); useAuthStore.setState(prior);
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  const patchCount = () => transport.mock.calls.filter(([, options]) => options?.method === "PATCH").length;
  const render = () => act(async () => root.render(<><Harness name="a" /><Harness name="b" /></>));

  it.each(["fetch", "body"])("blocks inverse writes during unresolved %s through a second hook and remount", async phase => {
    await render(); const pending = deferred<Response>(); const body = deferred<unknown>();
    transport.mockImplementationOnce(async () => phase === "fetch" ? pending.promise : new Response());
    if (phase === "body") transport.mockImplementationOnce(async () => page());
    // 응답 본문 대기는 실제 fetch 경계에서 제어한다.
    if (phase === "body") transport.mockReset().mockImplementation(async (_url, init) => init?.method === "PATCH"
      ? { ok: true, json: () => body.promise } as Response : page());
    await act(async () => { void views.a.update(row.id, { status: "done" }); });
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(false); });
    await act(async () => root.unmount()); root = createRoot(host); await render();
    expect(views.a.updateError).toContain("확인 전에는 추가 변경하지 않아요");
    await act(async () => { expect(await views.a.update(row.id, { status: "dismissed" })).toBe(false); });
    expect(patchCount()).toBe(1);
    await act(async () => { if (phase === "fetch") pending.resolve(Response.json({ action: { ...row, status: "done" } })); else body.resolve({ action: { ...row, status: "done" } }); });
    await act(async () => views.a.refresh());
  });

  it("a read started before raw settlement cannot unlock, and the first retry after settlement only reconciles", async () => {
    await render(); const pending = deferred<Response>();
    transport.mockImplementationOnce(() => pending.promise);
    await act(async () => { void views.a.update(row.id, { status: "done" }); });
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    const read = deferred<Response>(); transport.mockImplementationOnce(() => read.promise);
    await act(async () => { void views.b.refresh(); });
    await act(async () => pending.resolve(Response.json({ action: { ...row, status: "done" } })));
    await act(async () => read.resolve(page()));
    expect(views.b.updateError).toContain("확인 전에는 추가 변경하지 않아요");
    await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(false); });
    expect(patchCount()).toBe(1);
    await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(true); });
    expect(patchCount()).toBe(2);
  });

  it("keeps a lease across logout/login and only a valid post-settlement read can clear it", async () => {
    await render(); const pending = deferred<Response>(); transport.mockImplementationOnce(() => pending.promise);
    await act(async () => { void views.a.update(row.id, { status: "done" }); });
    const owner = useAuthStore.getState();
    await act(async () => { useAuthStore.getState().reset(); useAuthStore.setState(owner); });
    await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(false); });
    await act(async () => vi.advanceTimersByTimeAsync(30_001));
    await act(async () => pending.resolve(Response.json({ action: { ...row, status: "done" } })));
    for (const response of [Response.json({}, { status: 503 }), Response.json({ actions: "invalid" }), Response.json({ actions: [], count: 1, open_count: 1 })]) {
      transport.mockResolvedValueOnce(response);
      await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(false); });
      expect(views.b.updateError).toBeTruthy();
    }
    expect(patchCount()).toBe(1);
    await act(async () => views.b.refresh());
    await act(async () => { expect(await views.b.update(row.id, { status: "dismissed" })).toBe(true); });
  });

  it("settles a valid receipt after unmount without leaving an unrecoverable lease", async () => {
    await render(); const pending = deferred<Response>(); transport.mockImplementationOnce(() => pending.promise);
    await act(async () => { void views.a.update(row.id, { status: "done" }); });
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => pending.resolve(Response.json({ action: { ...row, status: "done" } })));
    await render();
    await act(async () => { expect(await views.a.update(row.id, { status: "dismissed" })).toBe(true); });
    expect(patchCount()).toBe(2);
  });
  it("an older read cannot release a newer write lease started by another hook", async () => {
    await render(); transport.mockRejectedValueOnce(new TypeError("lost response"));
    await act(async () => { expect(await views.a.update(row.id, { status: "done" })).toBe(false); });
    const oldRead = deferred<Response>(); transport.mockImplementationOnce(() => oldRead.promise);
    await act(async () => { void views.b.refresh(); });
    await act(async () => views.a.refresh());
    const nextWrite = deferred<Response>(); transport.mockImplementationOnce(() => nextWrite.promise);
    await act(async () => { void views.a.update(row.id, { status: "dismissed" }); });
    await act(async () => oldRead.resolve(page()));
    await act(async () => { expect(await views.b.update(row.id, { status: "done" })).toBe(false); });
    expect(patchCount()).toBe(2);
    await act(async () => nextWrite.resolve(Response.json({ action: { ...row, status: "dismissed" } })));
  });
  it("a complete post-settlement empty list resolves a removed item without replaying its write", async () => {
    await render(); transport.mockRejectedValueOnce(new TypeError("lost response"));
    await act(async () => { expect(await views.a.update(row.id, { status: "done" })).toBe(false); });
    transport.mockResolvedValueOnce(Response.json({ actions: [], count: 0, open_count: 0 }));
    await act(async () => views.a.refresh());
    expect(views.a.updateError).toBeNull(); expect(views.a.actions).toEqual([]);
    await act(async () => { expect(await views.a.update(row.id, { status: "done" })).toBe(false); });
    expect(patchCount()).toBe(1);
  });
  it("clears the first hook's obsolete error when another hook resolves the shared unknown update", async () => {
    await render(); transport.mockRejectedValueOnce(new TypeError("lost response"));
    await act(async () => { expect(await views.a.update(row.id, { status: "done" })).toBe(false); });
    expect(views.a.updateError).toBeTruthy();
    await act(async () => views.b.refresh());
    expect(views.a.updateError).toBeNull();
    await act(async () => views.a.refresh());
    expect(views.a.updateError).toBeNull();
  });
});
