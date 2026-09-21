import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET, POST } from "./route";
import { log } from "@/utils/log";
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({ isTrustedMutationRequest: vi.fn(() => true) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "reset:test") }));
const USER = "10000000-0000-4000-8000-000000000001";
const COUPLE = "20000000-0000-4000-8000-000000000001";
const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string } | null }>>(async () => ({ data: { success: true }, error: null }));
describe("couple reset confirmation target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) }, rpc } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });
  it.each([undefined, "Bearer legacy-token"])("rejects a legacy confirmation and offers a fresh confirmation path (%s)", async authorization => {
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ confirmText: "초기화합니다" }) }));
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.reason).toBe("confirmation_required");
    expect(body.error).toContain("앱을 업데이트");
    expect(body.error).toContain("https://hanbang.ai/settings");
    expect(body.error).toContain("같은 계정");
    expect(body.error).toContain("다시");
    expect(body.error).not.toContain(USER);
    expect(body.error).not.toContain(COUPLE);
  });
  it.each([null, [], 7, "초기화합니다"])("rejects malformed non-object JSON %j before any reset", async body => {
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { target: null, reason: "confirmation_invalid" },
    { target: [], reason: "confirmation_invalid" },
    { target: { ownerId: "private-untrusted-value" }, reason: "confirmation_invalid" },
    { target: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 1.5 }, reason: "confirmation_invalid" },
    { target: { ownerId: COUPLE, coupleId: COUPLE, privacyEpoch: 7 }, reason: "confirmation_changed" },
  ])("distinguishes malformed reset confirmation from changed owner: $reason ($target)", async ({ target, reason }) => {
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", {
      method: "POST", headers: { authorization: "Bearer legacy-token" },
      body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: target }),
    }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.reason).toBe(reason);
    expect(body.error).toContain(reason === "confirmation_invalid" ? "형식" : "바뀌었어요");
    for (const value of [USER, COUPLE, "private-untrusted-value"]) expect(JSON.stringify(body)).not.toContain(value);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes the exact reviewed tuple into the atomic RPC and requires a verified receipt", async () => {
    rpc.mockImplementation(async (_name, args) => args?.p_expected_couple_id === COUPLE && args.p_expected_user_id === USER && args.p_expected_privacy_epoch === 7
      ? { data: { success: true, previous_couple_id: COUPLE }, error: null }
      : { data: null, error: { code: "40001" } });
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
  it("reads the confirmation owner, couple and epoch from the authenticated server context", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    const client = await createClientFromRequest(new Request("https://hanbang.ai"));
    vi.mocked(createClientFromRequest).mockResolvedValue({ ...client, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { couple_id: COUPLE }, error: null }) }) }) }) } as unknown as typeof client);
    const response = await GET(new Request("https://hanbang.ai/api/couple/reset"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not claim a failed reset when the atomic receipt may have been lost", async () => {
    rpc.mockRejectedValue(new Error("private relationship text must not be logged"));
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } }) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("초기화 결과를 확인하지 못했어요. 현재 연결 상태를 다시 확인해 주세요.");
    expect(log.error).toHaveBeenCalledExactlyOnceWith("api/couple/reset", new Error("RESET_RESULT_UNKNOWN"));
  });
  it.each([null, {}, { success: false }, { success: true, previous_couple_id: USER }])("does not report success for an unverified receipt %j", async receipt => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } }) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("결과를 확인하지 못했어요");
    expect(log.error).toHaveBeenCalledExactlyOnceWith("api/couple/reset", new Error("RESET_RECEIPT_UNVERIFIED"));
  });
  it("fails the confirmation read closed when authentication infrastructure is unavailable", async () => {
    vi.mocked(createClientFromRequest).mockRejectedValue(new Error("synthetic unavailable"));
    const response = await GET(new Request("https://hanbang.ai/api/couple/reset"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("confirmationTarget");
    expect(log.error).toHaveBeenCalledExactlyOnceWith("api/couple/reset", new Error("RESET_CONFIRMATION_UNAVAILABLE"));
  });
  it("reports an unknown database outcome without copying arbitrary database codes", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "private database detail" } });
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } }) }));
    expect(response.status).toBe(503);
    expect(log.error).toHaveBeenCalledExactlyOnceWith("api/couple/reset", new Error("RESET_RPC_OUTCOME_UNKNOWN"));
  });
  it("does not report an expected missing profile as an infrastructure incident", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const response = await POST(new Request("https://hanbang.ai/api/couple/reset", { method: "POST", body: JSON.stringify({ confirmText: "초기화합니다", confirmationTarget: { ownerId: USER, coupleId: COUPLE, privacyEpoch: 7 } }) }));
    expect(response.status).toBe(404);
    expect(log.error).not.toHaveBeenCalled();
  });
});
