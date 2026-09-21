import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useDecisionBoard } from "@/components/app/amora-board/useDecisionBoard";
const client = vi.hoisted(() => ({
  auth: { getUser: vi.fn<() => Promise<{ data: { user: { id: string } | null }; error: unknown }>>(() => new Promise(() => {})), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  from: vi.fn(),
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("leaves decision-record loading with a retryable error when authentication reads stall", async () => {
  vi.useFakeTimers();
  const A = "41000000-0000-4000-8000-000000000001", C = "42000000-0000-4000-8000-000000000002";
  const prior = useAuthStore.getState();
  useAuthStore.setState({ user: { id: A, email: "synthetic@example.invalid" }, profile: { id: A, name: "합성", role: "bride", couple_id: C, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: "2026-09-20", updated_at: "2026-09-20" }, couple: { id: C, bride_id: A, groom_id: null, invite_code: null, membership_sealed_at: null, created_at: "2026-09-20", updated_at: "2026-09-20" }, isDemo: false, isInitialized: true });
  let current!: ReturnType<typeof useDecisionBoard>;
  function Harness() { const value = useDecisionBoard(); useEffect(() => { current = value; }, [value]); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />)); expect(current.loading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(current.loading).toBe(false); expect(current.error).toBeTruthy();
  } finally { await act(async () => root.unmount()); host.remove(); useAuthStore.setState(prior); vi.useRealTimers(); vi.restoreAllMocks(); }
});

describe("decision read recovery with the real owner store", () => {
  const A = "81000000-0000-4000-8000-000000000001", C = "82000000-0000-4000-8000-000000000002";
  let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
  let prior: ReturnType<typeof useAuthStore.getState>;
  let current: ReturnType<typeof useDecisionBoard>;
  const reads = vi.fn<(table: string) => Promise<{ data: unknown; error: unknown }>>();
  const auth = () => ({ data: { user: { id: A } }, error: null });
  const row = (index = 0) => ({ id: `83000000-0000-4000-8000-${String(1000 - index).padStart(12, "0")}`, couple_id: C,
    visibility: "shared", category: "venue", title: `확인된 결정 ${index}`, reasoning: "사용자 승인", decision_type: "considering", source: "chat",
    created_at: "2026-09-20T00:00:00.123900Z", superseded_at: null, memory_key: null, metadata: {}, chosen_value: "검토 중" });
  function Harness() { const value = useDecisionBoard(); useEffect(() => { current = value; }, [value]); return null; }
  const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
  beforeEach(() => {
    vi.useFakeTimers(); prior = useAuthStore.getState();
    useAuthStore.setState({ user: { id: A, email: "synthetic@example.invalid" }, profile: { id: A, name: "합성", role: "bride", couple_id: C, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: "2026-09-20", updated_at: "2026-09-20" }, couple: { id: C, bride_id: A, groom_id: null, invite_code: null, membership_sealed_at: null, created_at: "2026-09-20", updated_at: "2026-09-20" }, isDemo: false, isInitialized: true });
    client.auth.getUser.mockReset().mockResolvedValue(auth());
    reads.mockReset().mockImplementation(async table => ({ data: table === "profiles" ? useAuthStore.getState().profile : table === "couples" ? useAuthStore.getState().couple : [row()], error: null }));
    client.from.mockReset().mockImplementation((table: string) => {
      const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query, or: () => query, abortSignal: () => query,
        single: () => reads(table), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => reads(table).then(resolve, reject) };
      return query;
    });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); useAuthStore.setState(prior); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(["auth", "profiles", "decision_nodes", "reverify"])("bounds a stalled %s, retries successfully, and ignores its old completion", async phase => {
    const pending = deferred<{ data: unknown; error: unknown }>(); const authPending = deferred<ReturnType<typeof auth>>();
    if (phase === "auth") client.auth.getUser.mockImplementationOnce(() => authPending.promise);
    else if (phase === "reverify") client.auth.getUser.mockResolvedValueOnce(auth()).mockImplementationOnce(() => authPending.promise);
    else {
      const normal = reads.getMockImplementation()!; let stalled = false;
      reads.mockImplementation(table => { if (!stalled && table === phase) { stalled = true; return pending.promise; } return normal(table); });
    }
    await act(async () => root.render(<Harness />)); expect(current.loading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(current.loading).toBe(false); expect(current.errorKind).toBe("initial"); expect(current.error).toBeTruthy();
    await act(async () => current.refresh());
    expect(current.records.map(record => record.title)).toEqual(["확인된 결정 0"]); expect(current.error).toBeNull();
    const count = reads.mock.calls.length;
    await act(async () => {
      authPending.resolve(auth());
      pending.resolve({ data: phase === "profiles" ? useAuthStore.getState().profile : [{ ...row(), title: "오래된 조회" }], error: null });
    });
    expect(reads.mock.calls.length).toBe(count);
    expect(current.records[0].title).toBe("확인된 결정 0");
  });

  it("keeps the first page and its cursor when the next page times out, then retries that page", async () => {
    const normal = reads.getMockImplementation()!; let nodeCalls = 0;
    const old = deferred<{ data: unknown; error: unknown }>();
    reads.mockImplementation(table => table !== "decision_nodes" ? normal(table)
      : ++nodeCalls === 1 ? Promise.resolve({ data: Array.from({ length: 31 }, (_, index) => row(index)), error: null })
        : nodeCalls === 2 ? old.promise : Promise.resolve({ data: [row(30)], error: null }));
    await act(async () => root.render(<Harness />)); const cursor = current.nextCursor;
    expect(current.records).toHaveLength(30);
    await act(async () => { void current.loadMore(); });
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(current.loadingMore).toBe(false); expect(current.errorKind).toBe("more");
    expect(current.records).toHaveLength(30); expect(current.nextCursor).toEqual(cursor);
    await act(async () => current.loadMore());
    expect(current.records).toHaveLength(31); expect(current.error).toBeNull();
    await act(async () => old.resolve({ data: [{ ...row(30), title: "오래된 추가 페이지" }], error: null }));
    expect(current.records[30].title).toBe("확인된 결정 30");
  });
});
