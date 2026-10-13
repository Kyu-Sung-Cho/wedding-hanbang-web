// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "22222222-2222-4222-8222-222222222222";
const COUPLE = "11111111-1111-4111-8111-111111111111";
const ID = "act_deadline_http";
const TOKEN = "2026-10-12T00:00:00.123456Z";
const NEXT = "2026-10-12T00:00:00.123457Z";
const userReply = () => ({ data: { user: { id: OWNER } }, error: null });
const receipt = () => ({ id: ID, couple_id: COUPLE, title: "합성 준비", description: "내 초안", priority: "medium", status: "open",
  source: "manual", created_at: TOKEN, updated_at: NEXT });
const mocks = vi.hoisted(() => ({ auth: vi.fn(), requests: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async (_request: Request, options?: { fetch?: typeof fetch }) => {
    const client = createClient("http://127.0.0.1:55435", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: options?.fetch ?? ((...args) => globalThis.fetch(...args)) },
    });
    vi.spyOn(client.auth, "getUser").mockImplementation(mocks.auth);
    return client;
  },
}));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function patch(signal?: AbortSignal) {
  const { PATCH } = await import("../route");
  return PATCH(new Request(`https://hanbang.ai/api/amora/actions/${ID}`, { method: "PATCH", signal,
    headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    body: JSON.stringify({ description: "내 초안", expectedUpdatedAt: TOKEN, expectedOwnerId: OWNER, expectedCoupleId: COUPLE }),
  }), { params: Promise.resolve({ id: ID }) });
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.useFakeTimers();
  mocks.auth.mockReset().mockResolvedValue(userReply()); mocks.requests = [];
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const request = new Request(input, init); const name = new URL(request.url).pathname.split("/").at(-1)!;
    mocks.requests.push(name);
    return Response.json(name === "profiles" ? { couple_id: COUPLE } : receipt());
  });
  vi.stubGlobal("fetch", fetchMock);
  // 먼저 실제 route를 로드한 뒤 요청 수명에만 fake clock을 진행한다.
  await import("../route");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("the whole action endpoint lifetime, not only response headers", () => {
  it("returns unavailable before any RPC when auth does not finish, and ignores its late user", async () => {
    const auth = deferred<ReturnType<typeof userReply>>(); mocks.auth.mockReturnValueOnce(auth.promise);
    let result: Response | undefined;
    const pending = patch().then(response => { result = response; });
    await vi.advanceTimersByTimeAsync(15_000);
    const atDeadline = result;
    auth.resolve(userReply()); await pending;
    expect(atDeadline?.status).toBe(503);
    expect(await atDeadline!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(mocks.requests).toEqual([]);
  });
  it("aborts an unfinished profile read and never sends an RPC after the profile arrives late", async () => {
    const profile = deferred<Response>(); fetchMock.mockReturnValueOnce(profile.promise);
    let result: Response | undefined;
    const pending = patch().then(response => { result = response; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    profile.resolve(Response.json({ couple_id: COUPLE })); await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["fetch", "body"])("returns an unconfirmed outcome when RPC %s never finishes, with one write and no late success", async phase => {
    const rpc = deferred<Response>(); const body = deferred<string>();
    const response = Response.json(receipt());
    if (phase === "body") vi.spyOn(response, "text").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(Response.json({ couple_id: COUPLE }));
    fetchMock.mockReturnValueOnce(phase === "fetch" ? rpc.promise : Promise.resolve(response));
    let result: Response | undefined;
    const pending = patch().then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_OUTCOME_UNCONFIRMED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).p_expected_updated_at).toBe(TOKEN);
    if (phase === "fetch") rpc.resolve(Response.json(receipt())); else body.resolve(JSON.stringify(receipt()));
    await pending; await vi.advanceTimersByTimeAsync(0);
    expect(result?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses one operation budget across preflight and response body instead of resetting each await", async () => {
    const auth = deferred<ReturnType<typeof userReply>>(); mocks.auth.mockReturnValueOnce(auth.promise);
    const body = deferred<string>(); const response = Response.json(receipt());
    vi.spyOn(response, "text").mockImplementation(() => body.promise);
    fetchMock.mockResolvedValueOnce(Response.json({ couple_id: COUPLE })); fetchMock.mockResolvedValueOnce(response);
    let result: Response | undefined;
    const pending = patch().then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(10_000); auth.resolve(userReply());
    await vi.advanceTimersByTimeAsync(4_999); expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_OUTCOME_UNCONFIRMED" });
    body.resolve(JSON.stringify(receipt())); await pending;
  });
  it("stops before auth when the incoming request was already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const result = await patch(controller.signal);
    expect(result.status).toBe(503);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps the single-record GET bounded without claiming a record exists after read timeout", async () => {
    const auth = deferred<ReturnType<typeof userReply>>(); mocks.auth.mockReturnValueOnce(auth.promise);
    const { GET } = await import("../route");
    let result: Response | undefined;
    const pending = GET(new Request(`https://hanbang.ai/api/amora/actions/${ID}`), { params: Promise.resolve({ id: ID }) }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(result?.headers.get("cache-control")).toContain("no-store");
    auth.resolve(userReply()); await pending;
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cleans up the deadline after a normal saved receipt", async () => {
    const result = await patch();
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ action: { description: "내 초안", viewVersion: NEXT } });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("cancels and releases a never-ending incoming body even if its custom cancel promise never resolves", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { cancelled += 1; return new Promise<void>(() => {}); },
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = { method: "PATCH", body, duplex: "half",
      headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" } };
    const request = new Request(`https://hanbang.ai/api/amora/actions/${ID}`, init);
    const { PATCH } = await import("../route");
    let result: Response | undefined;
    const pending = PATCH(request, { params: Promise.resolve({ id: ID }) }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(15_000);
    const cancelledAtDeadline = cancelled; const lockedAtDeadline = body.locked;
    // RED에서도 이 테스트 소유 stream만 정상 종료한다. 운영 요청은 없다.
    if (cancelled === 0) controller.close();
    await pending; await vi.advanceTimersByTimeAsync(0);
    expect(result?.status).toBe(503);
    expect(await result!.json()).toMatchObject({ code: "AMORA_ACTION_UNAVAILABLE" });
    expect(cancelledAtDeadline).toBe(1);
    expect(lockedAtDeadline).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
