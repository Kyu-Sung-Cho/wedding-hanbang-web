// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
const USER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc }) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "synthetic" }));
import { POST } from "./route";
const body = { confirmText: "초기화합니다", expectedUserId: USER, expectedCoupleId: COUPLE };
function request(value: unknown = body) {
  return new Request("https://hanbang.ai/api/couple/reset", { method: "POST", headers: { origin: "https://hanbang.ai", "content-type": "application/json" }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { success: true, previous_couple_id: COUPLE }, error: null });
});
describe("couple reset binds the confirmed user and couple atomically", () => {
  it("rejects an oversized UTF-8 body without Content-Length before resetting", async () => {
    const oversized = request({ ...body, padding: "가".repeat(1500) });
    expect(oversized.headers.has("content-length")).toBe(false);
    expect((await POST(oversized)).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { confirmText: "초기화합니다" },
    { confirmText: "초기화합니다", expectedUserId: USER },
    { confirmText: "초기화합니다", expectedCoupleId: COUPLE },
  ])("tells older clients to refresh or update when confirmation fields are absent %j", async value => {
    const response = await POST(request(value));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "초기화를 계속하려면 웹에서는 페이지를 새로고침하고, 앱에서는 최신 버전으로 업데이트해 주세요." });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, expectedUserId: COUPLE },
    { ...body, expectedUserId: null },
    { ...body, expectedCoupleId: "invalid" },
  ])("rejects stale or invalid confirmation identity before mutation %j", async value => {
    const response = await POST(request(value));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "계정 또는 커플 연결이 바뀌었어요. 설정 화면을 다시 열고 확인해 주세요." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires the confirmation phrase before returning old-client guidance", async () => {
    const response = await POST(request({ confirmText: "초기화" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "확인 문구가 일치하지 않습니다." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes the exact confirmed snapshot to the checked RPC", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reset_expected_couple_membership", { p_expected_user_id: USER, p_expected_couple_id: COUPLE });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("allows an explicitly confirmed empty preparation space", async () => {
    mocks.rpc.mockResolvedValue({ data: { success: true, previous_couple_id: null }, error: null });
    expect((await POST(request({ ...body, expectedCoupleId: null }))).status).toBe(200);
  });
  it("normalizes an accepted uppercase couple UUID before comparing the committed receipt", async () => {
    const coupleId = "abcdef01-2222-4222-8222-222222222222";
    mocks.rpc.mockResolvedValue({ data: { success: true, previous_couple_id: coupleId }, error: null });
    const response = await POST(request({ ...body, expectedCoupleId: coupleId.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reset_expected_couple_membership", {
      p_expected_user_id: USER, p_expected_couple_id: coupleId,
    });
  });
  it.each([
    { code: "P0001", status: 409 }, { code: "P0002", status: 404 },
    { code: "PGRST202", status: 503 }, { code: "42883", status: 503 }, { code: "08006", status: 503 },
  ])("fails safely for $code without retrying the unchecked RPC", async ({ code, status }) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private database detail" } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private database detail");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { success: false, previous_couple_id: COUPLE }, { success: true, previous_couple_id: USER }])("does not report success for a mismatched receipt %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("distinguishes temporary auth failure from an absent session", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("private auth detail", 503) });
    expect((await POST(request())).status).toBe(503);
    mocks.auth.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
