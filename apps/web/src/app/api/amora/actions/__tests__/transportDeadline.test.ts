// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manualActionIdForRequest } from "@/lib/amora/manualActionCreate";

const OWNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const TOKEN = "2026-10-12T00:00:00.123456Z";
const userReply = () => ({ data: { user: { id: OWNER } }, error: null });
const fields = { title: "합성 준비", requestId: REQUEST_ID, expectedOwnerId: OWNER, expectedCoupleId: COUPLE, source: "manual" };
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpcBodies: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async (_request: Request, options?: { fetch?: typeof fetch }) => {
    const client = createClient("http://127.0.0.1:55436", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: options?.fetch ?? ((...args) => globalThis.fetch(...args)) },
    });
    vi.spyOn(client.auth, "getUser").mockImplementation(mocks.auth);
    return client;
  },
}));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.useFakeTimers(); mocks.auth.mockReset().mockResolvedValue(userReply()); mocks.rpcBodies = [];
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const request = new Request(input, init); const name = new URL(request.url).pathname.split("/").at(-1)!;
    if (name === "profiles") return Response.json({ couple_id: COUPLE });
    if (name === "wedding_journeys") return Response.json({ progress: {} });
    if (name === "mutate_own_amora_action") {
      const values = await request.json(); mocks.rpcBodies.push(values);
      return Response.json({ id: values.p_action_id, couple_id: COUPLE, created_by: OWNER, created_at: TOKEN, updated_at: TOKEN, ...values.p_values });
    }
    return Response.json([], { headers: { "content-range": "0-0/0" } });
  });
  vi.stubGlobal("fetch", fetchMock); await import("../route");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function call(method: "GET" | "POST", body: unknown = fields) {
  const route = await import("../route");
  const request = new Request("https://hanbang.ai/api/amora/actions", { method,
    headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  return method === "POST" ? route.POST(request) : route.GET(request);
}
describe("the list and create endpoints have the same bounded lifetime", () => {
  it.each(["GET", "POST"] as const)("ends %s before preflight can deliver a late identity", async method => {
    const auth = deferred<ReturnType<typeof userReply>>(); mocks.auth.mockReturnValueOnce(auth.promise);
    let result: Response | undefined; const pending = call(method).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000); const atDeadline = result;
    auth.resolve(userReply()); await pending;
    expect(atDeadline?.status).toBe(503);
    expect(await atDeadline!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.rpcBodies).toEqual([]);
  });
  it.each(["GET", "POST"] as const)("ends %s after a stalled profile without starting a later read or write", async method => {
    const profile = deferred<Response>(); fetchMock.mockReturnValueOnce(profile.promise);
    let result: Response | undefined; const pending = call(method).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    profile.resolve(Response.json({ couple_id: COUPLE })); await pending; await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(mocks.rpcBodies).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not turn an uncompleted list body into an empty successful list", async () => {
    const body = deferred<string>(); const legacy = Response.json({ progress: {} });
    vi.spyOn(legacy, "text").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(Response.json({ couple_id: COUPLE })); fetchMock.mockResolvedValueOnce(legacy);
    let result: Response | undefined; const pending = call("GET").then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    body.resolve(JSON.stringify({ progress: {} })); await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["fetch", "body"])("reports POST RPC %s timeout as unconfirmed without issuing a second write", async phase => {
    const rpc = deferred<Response>(); const body = deferred<string>();
    const receipt = { id: manualActionIdForRequest(OWNER, COUPLE, REQUEST_ID), couple_id: COUPLE, created_by: OWNER,
      title: fields.title, priority: "medium", status: "open", source: "manual", created_at: TOKEN, updated_at: TOKEN };
    const response = Response.json(receipt); if (phase === "body") vi.spyOn(response, "text").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(Response.json({ couple_id: COUPLE }));
    fetchMock.mockReturnValueOnce(phase === "fetch" ? rpc.promise : Promise.resolve(response));
    let result: Response | undefined; const pending = call("POST").then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_OUTCOME_UNCONFIRMED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST"); expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sent).toMatchObject({ p_action_id: receipt.id, p_operation: "create", p_couple_id: COUPLE });
    if (phase === "fetch") rpc.resolve(Response.json(receipt)); else body.resolve(JSON.stringify(receipt));
    await pending; await vi.advanceTimersByTimeAsync(0);
    expect(result?.status).toBe(503); expect(fetchMock).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an unfinished incoming create body without awaiting custom cancel or issuing a write", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled += 1; return new Promise<void>(() => {}); } }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
      headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" } };
    const { POST } = await import("../route"); let result: Response | undefined;
    const pending = POST(new Request("https://hanbang.ai/api/amora/actions", init)).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000); await pending;
    expect(result?.status).toBe(503); expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(cancelled).toBe(1); expect(body.locked).toBe(false); expect(fetchMock).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds the actual creation bytes without trusting Content-Length", async () => {
    const result = await call("POST", { ...fields, unrelatedText: "가".repeat(32 * 1024) });
    expect(result.status).toBe(413); expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.rpcBodies).toEqual([]);
  });
  it("rejects malformed incoming JSON without logging or writing its private text", async () => {
    const { POST } = await import("../route");
    const result = await POST(new Request("https://hanbang.ai/api/amora/actions", { method: "POST",
      headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" }, body: '{"PRIVATE_SYNTHETIC":' }));
    expect(result.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.rpcBodies).toEqual([]);
  });
  it("preserves a verified creation's request ID, stable action ID and original 201 receipt", async () => {
    const result = await call("POST"); expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ requestId: REQUEST_ID, replayed: false,
      action: { id: manualActionIdForRequest(OWNER, COUPLE, REQUEST_ID), title: fields.title } });
    expect(mocks.rpcBodies).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
});
