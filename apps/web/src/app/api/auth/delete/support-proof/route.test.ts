// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "abcdefghijklmnopqrst";
const SECRET = "local-support-route-secret-only-".repeat(3);
const untrustedHeaders: Record<string, string>[] = [{ origin: "https://other.test" }, { origin: "null" },
  { "sec-fetch-site": "cross-site" }, { authorization: "not-a-bearer" }];
const m = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), limit: vi.fn(), key: vi.fn(), destination: vi.fn(), log: vi.fn() }));
vi.mock("@/utils/log", () => ({ log: { error: m.log } }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: m.create }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: m.limit, rateLimitKey: m.key }));
vi.mock("@/lib/supabase/destinationFence", () => ({ verifyRuntimeSupabaseServiceDestination: m.destination }));
import { POST } from "./route";
import { verifyDeletionSupportProof } from "@/lib/accountDeletion/supportProof";
function request(value: unknown = { intent: "support-identity-only" }, headers: Record<string, string> = {}) {
  return new Request("https://hanbang.ai/api/auth/delete/support-proof", { method: "POST", headers: { origin: "https://hanbang.ai", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SECRET);
  m.create.mockResolvedValue({ auth: { getUser: m.auth } });
  m.auth.mockResolvedValue({ data: { user: { id: USER, is_anonymous: false } }, error: null });
  m.limit.mockResolvedValue(null); m.key.mockReturnValue("owner-scoped-proof");
  m.destination.mockReturnValue({ projectRef: PROJECT });
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("support identity issuance API", () => {
  it("issues a verifiable owner-bound proof without a deletion job, write, email or logout dependency", async () => {
    const req = request(); const response = await POST(req); privateResponse(response);
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.ownerId).toBe(USER);
    expect(verifyDeletionSupportProof({ proof: data.proof, projectRef: PROJECT, secret: SECRET }).subject).toBe(USER);
    expect(m.auth).toHaveBeenCalledOnce();
    expect(m.key).toHaveBeenCalledWith("auth:deletion-support-proof", req, USER);
    expect(m.limit).toHaveBeenCalledWith("owner-scoped-proof", { maxRequests: 3, windowMs: 3_600_000 }, { failClosed: true });
    expect(JSON.stringify(data)).not.toContain(SECRET);
  });
  it.each(untrustedHeaders)("rejects untrusted browser metadata before auth: %j", async headers => {
    const response = await POST(request(undefined, headers)); expect(response.status).toBe(403); privateResponse(response);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([{}, { intent: "delete" }, { intent: "support-identity-only", user_id: USER }, [], null])("rejects extra fields and alternate intent: %j", async value => {
    const response = await POST(request(value)); expect(response.status).toBe(400); privateResponse(response);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("counts actual oversized bytes despite a dishonest content-length and rejects invalid UTF-8/JSON", async () => {
    const oversized = await POST(request({ intent: "x".repeat(300) }, { "content-length": "1" }));
    expect(oversized.status).toBe(413); privateResponse(oversized);
    for (const body of ["{", Buffer.from([0xff])]) {
      const response = await POST(new Request("https://hanbang.ai/api/auth/delete/support-proof", { method: "POST", headers: { origin: "https://hanbang.ai" }, body }));
      expect(response.status).toBe(400); privateResponse(response);
    }
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: USER, is_anonymous: true } }, error: null }, { data: { user: { id: USER } }, error: new Error("private-auth-details") }])("rejects missing, anonymous or failed server authentication", async auth => {
    m.auth.mockResolvedValue(auth); const response = await POST(request());
    expect(response.status).toBe(401); privateResponse(response); expect(m.limit).not.toHaveBeenCalled();
  });
  it("keeps rate denial private and does not sign when the limiter refuses or fails", async () => {
    m.limit.mockResolvedValue(new Response(JSON.stringify({ error: "limited" }), { status: 429 }));
    const denied = await POST(request()); expect(denied.status).toBe(429); privateResponse(denied);
    expect(m.destination).not.toHaveBeenCalled();
    m.limit.mockRejectedValue(new Error("private-limiter-error"));
    const failed = await POST(request()); expect(failed.status).toBe(503); privateResponse(failed);
    expect(await failed.text()).not.toContain("private-limiter-error");
  });
  it("fails closed without leaking destination or signing errors", async () => {
    m.destination.mockImplementation(() => { throw new Error("private-project-secret"); });
    const failed = await POST(request()); expect(failed.status).toBe(503); privateResponse(failed);
    expect(await failed.text()).not.toContain("private-project-secret");
    expect(m.log).toHaveBeenCalledWith("auth/deletion-support-proof", expect.objectContaining({ message: "DELETION_SUPPORT_PROOF_UNAVAILABLE" }));
    m.destination.mockReturnValue({ projectRef: PROJECT }); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await POST(request())).status).toBe(503);
  });
  it("keeps the failed response private even if error reporting itself fails", async () => {
    m.destination.mockImplementation(() => { throw new Error("private-secret"); });
    m.log.mockImplementationOnce(() => { throw new Error("logger failed"); });
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response);
    expect(await response.text()).not.toContain("private-secret");
  });
});
