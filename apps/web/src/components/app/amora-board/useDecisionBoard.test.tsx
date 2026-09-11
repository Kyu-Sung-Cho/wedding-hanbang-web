import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { DECISION_PAGE_SIZE, parsePreparationDecisions } from "@/lib/amora/preparationBoard";

const mocks = vi.hoisted(() => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  return {
    ownerId, coupleId, auth: { user: { id: ownerId } as { id: string } | null, profile: { id: ownerId, couple_id: coupleId, role: "bride" }, couple: { id: coupleId, bride_id: ownerId, groom_id: null as string | null }, isInitialized: true, isDemo: false },
    listeners: new Set<(state: unknown) => void>(), events: new Set<(event: string) => void>(),
    nodeRead: vi.fn(), calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  };
});
vi.mock("@/stores/authStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: (state: typeof mocks.auth) => void) => {
    mocks.listeners.add(listener as (state: unknown) => void);
    return () => mocks.listeners.delete(listener as (state: unknown) => void);
  };
  return { useAuthStore: Object.assign((select: (state: typeof mocks.auth) => unknown) => useSyncExternalStore(subscribe, () => select(mocks.auth)), { getState: () => mocks.auth, subscribe }) };
});

function query(table: string) {
  const read = async () => table === "profiles" ? { data: { ...mocks.auth.profile }, error: null }
    : table === "couples" ? { data: { ...mocks.auth.couple }, error: null }
      : mocks.nodeRead();
  const chain = {
    select: (...args: unknown[]) => step("select", args), eq: (...args: unknown[]) => step("eq", args),
    is: (...args: unknown[]) => step("is", args), order: (...args: unknown[]) => step("order", args),
    limit: (...args: unknown[]) => step("limit", args), or: (...args: unknown[]) => step("or", args),
    abortSignal: (...args: unknown[]) => step("abortSignal", args), single: read,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => read().then(resolve, reject),
  };
  function step(method: string, args: unknown[]) { mocks.calls.push({ table, method, args }); return chain; }
  return chain;
}
const client = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mocks.auth.user }, error: null })),
    onAuthStateChange: (callback: (event: string) => void) => { mocks.events.add(callback); return { data: { subscription: { unsubscribe: () => mocks.events.delete(callback) } } }; },
  },
  from: query,
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
import { decisionScope, readDecisionPage, useDecisionBoard } from "./useDecisionBoard";

function row(index = 0) {
  return { id: `33333333-3333-4333-8333-${(1000 - index).toString(16).padStart(12, "0")}`, couple_id: mocks.coupleId,
    visibility: "shared", category: "venue", title: `실제 결정 ${index}`, reasoning: "직접 저장된 이유", decision_type: "decided", source: "budget", created_at: "2026-09-07T00:00:00.123900Z", superseded_at: null, memory_key: null, metadata: {} };
}
function notify() { for (const listener of mocks.listeners) listener(mocks.auth); }
function read(cursor: { id: string; createdAt: string } | null = null, current = () => true) {
  return readDecisionPage(client as unknown as SupabaseClient, decisionScope()!, current, new AbortController().signal, cursor);
}
let latest: ReturnType<typeof useDecisionBoard>;
function Harness() {
  const result = useDecisionBoard(); useEffect(() => { latest = result; }, [result]);
  return <div>{result.records.map(record => <p key={record.id}>{record.title}</p>)}{result.error}</div>;
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("actual shared decision reader", () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(mocks.auth, { user: { id: mocks.ownerId }, profile: { id: mocks.ownerId, couple_id: mocks.coupleId, role: "bride" }, couple: { id: mocks.coupleId, bride_id: mocks.ownerId, groom_id: null }, isInitialized: true, isDemo: false });
    mocks.calls.length = 0; mocks.nodeRead.mockReset().mockResolvedValue({ data: [row()], error: null }); client.auth.getUser.mockClear();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("reads the RLS table with shared/current/active/non-memory filters and both owner readbacks", async () => {
    const page = await read(); expect(page.records[0].title).toBe("실제 결정 0");
    expect(mocks.calls).toEqual(expect.arrayContaining([
      { table: "decision_nodes", method: "eq", args: ["couple_id", mocks.coupleId] },
      { table: "decision_nodes", method: "eq", args: ["visibility", "shared"] },
      { table: "decision_nodes", method: "is", args: ["superseded_at", null] },
      { table: "decision_nodes", method: "is", args: ["memory_key", null] },
      { table: "decision_nodes", method: "is", args: ["metadata->>extracted_by", null] },
    ]));
    expect(client.auth.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.calls.filter(call => call.table === "couples" && call.method === "select")).toHaveLength(2);
  });

  it("maps six real states without treating automatic, private or other-couple rows as decisions", () => {
    for (const [type, expected] of [["decided", "confirmed"], ["scheduled", "confirmed"], ["booked", "confirmed"], ["completed", "confirmed"], ["considering", "considering"], ["exploring", "exploring"]]) {
      expect(parsePreparationDecisions([{ ...row(), decision_type: type }], mocks.coupleId).records[0].status).toBe(expected);
    }
    for (const changes of [{ visibility: "bride_private" }, { visibility: "groom_private" }, { couple_id: mocks.ownerId }, { memory_key: "personal_preference" }, { metadata: { extracted_by: "ai" } }, { superseded_at: "2026-09-07T01:00:00Z" }, { decision_type: "guessed" }]) {
      expect(() => parsePreparationDecisions([{ ...row(), ...changes }], mocks.coupleId)).toThrow();
    }
    expect(() => parsePreparationDecisions({}, mocks.coupleId)).toThrow();
    expect(() => parsePreparationDecisions([row(), row()], mocks.coupleId)).toThrow();
  });

  it("returns bounded keyset pages and rejects replay/out-of-order cursor rows", async () => {
    mocks.nodeRead.mockResolvedValueOnce({ data: Array.from({ length: DECISION_PAGE_SIZE + 1 }, (_, index) => row(index)), error: null });
    const first = await read(); expect(first.records).toHaveLength(30); expect(first.nextCursor?.id).toBe(row(29).id);
    mocks.nodeRead.mockResolvedValueOnce({ data: [row(30)], error: null });
    const next = await read(first.nextCursor); expect(next.records[0].id).toBe(row(30).id); expect(next.nextCursor).toBeNull();
    expect(mocks.calls.some(call => call.method === "or" && String(call.args[0]).includes(row(29).id))).toBe(true);
    expect(() => parsePreparationDecisions([row(29)], mocks.coupleId, first.nextCursor)).toThrow();
    expect(() => parsePreparationDecisions([{ ...row(30), created_at: "2026-09-07T00:00:00.123901Z" }], mocks.coupleId, first.nextCursor)).toThrow();
  });

  it("keeps a valid legacy decision with null category and source without inventing a category", async () => {
    mocks.nodeRead.mockResolvedValueOnce({ data: [{ ...row(), category: null, source: null }], error: null });
    const page = await read();
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({ title: "실제 결정 0", category: "", source: "", status: "confirmed" });
    expect(() => parsePreparationDecisions([{ ...row(), title: null }], mocks.coupleId)).toThrow();
    expect(() => parsePreparationDecisions([{ ...row(), decision_type: null }], mocks.coupleId)).toThrow();
  });

  it("fails closed on a partner replacement during a read and on a stale request generation", async () => {
    mocks.nodeRead.mockImplementationOnce(async () => { mocks.auth.couple.groom_id = "44444444-4444-4444-8444-444444444444"; return { data: [row()], error: null }; });
    await expect(read()).rejects.toThrow("DECISION_IDENTITY_CHANGED");
    let active = true;
    mocks.nodeRead.mockImplementationOnce(async () => { active = false; return { data: [row()], error: null }; });
    await expect(read(null, () => active)).rejects.toThrow("DECISION_IDENTITY_CHANGED");
  });

  it("rejects database failures and malformed success without calling either case empty", async () => {
    mocks.nodeRead.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(read()).rejects.toThrow("DECISION_READ_FAILED");
    mocks.nodeRead.mockResolvedValueOnce({ data: null, error: null }); await expect(read()).rejects.toThrow();
    mocks.nodeRead.mockResolvedValueOnce({ data: [], error: null }); expect((await read()).records).toEqual([]);
  });

  it("shows the failed state, retries it and never reads real decisions in demo", async () => {
    mocks.nodeRead.mockResolvedValueOnce({ data: null, error: { code: "503" } });
    await act(async () => root.render(<Harness />)); expect(container.textContent).toContain("결정 기록을 확인하지 못했어요");
    await act(async () => latest.refresh()); expect(container.textContent).toContain("실제 결정 0");
    const count = mocks.nodeRead.mock.calls.length;
    await act(async () => { mocks.auth.isDemo = true; notify(); });
    expect(container.textContent).not.toContain("실제 결정 0"); expect(mocks.nodeRead).toHaveBeenCalledTimes(count);
  });

  it("drops a delayed response across logout and an owner/couple ABA, then reads only the new generation", async () => {
    let resolve!: (value: unknown) => void;
    mocks.nodeRead.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await act(async () => root.render(<Harness />));
    await act(async () => {
      mocks.auth.user = null; notify();
      mocks.auth.user = { id: mocks.ownerId }; notify();
    });
    await act(async () => resolve({ data: [{ ...row(), title: "STALE_FROM_OLD_LOGIN" }], error: null }));
    expect(container.textContent).not.toContain("STALE_FROM_OLD_LOGIN");
    expect(container.textContent).toContain("실제 결정 0");
  });

  it("serializes the private and automatic-memory exclusions through the installed PostgREST client", async () => {
    const urls: URL[] = [];
    const realClient = createSupabaseClient("https://board-fixture.invalid", "synthetic-anon", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async input => {
        const url = new URL(String(input)); urls.push(url);
        const data = url.pathname.endsWith("/profiles") ? mocks.auth.profile : url.pathname.endsWith("/couples") ? mocks.auth.couple : [row()];
        return new globalThis.Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      } },
    });
    vi.spyOn(realClient.auth, "getUser").mockResolvedValue({ data: { user: { id: mocks.ownerId } }, error: null } as Awaited<ReturnType<typeof realClient.auth.getUser>>);
    expect((await readDecisionPage(realClient, decisionScope()!, () => true, new AbortController().signal)).records).toHaveLength(1);
    const request = urls.find(url => url.pathname.endsWith("/decision_nodes"))!;
    expect(request.searchParams.get("visibility")).toBe("eq.shared");
    expect(request.searchParams.get("metadata->>extracted_by")).toBe("is.null");
    expect(request.searchParams.get("memory_key")).toBe("is.null");
    expect(request.searchParams.get("order")).toBe("created_at.desc,id.desc");
    expect(request.searchParams.get("select")?.split(",").map(field => field.trim())).toContain("chosen_value");
  });

  it("invalidates an old session response even when the owner is unchanged, then refreshes on focus", async () => {
    let resolve!: (value: unknown) => void;
    mocks.nodeRead.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await act(async () => root.render(<Harness />));
    await act(async () => { for (const event of mocks.events) event("SIGNED_IN"); });
    await act(async () => resolve({ data: [{ ...row(), title: "STALE_SESSION_ROW" }], error: null }));
    expect(container.textContent).not.toContain("STALE_SESSION_ROW");
    expect(container.textContent).toContain("실제 결정 0");
    mocks.nodeRead.mockResolvedValueOnce({ data: [{ ...row(), title: "복귀 후 결정" }], error: null });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("복귀 후 결정");
  });

  it("appends older real records and hides previously loaded records immediately on a same-account couple change", async () => {
    mocks.nodeRead.mockResolvedValueOnce({ data: Array.from({ length: 31 }, (_, index) => row(index)), error: null });
    await act(async () => root.render(<Harness />));
    mocks.nodeRead.mockResolvedValueOnce({ data: [row(30)], error: null });
    await act(async () => latest.loadMore()); expect(latest.records).toHaveLength(31);
    await act(async () => { mocks.auth.profile.couple_id = mocks.ownerId; notify(); });
    expect(latest.records).toEqual([]); expect(container.textContent).not.toContain("실제 결정");
  });
});
