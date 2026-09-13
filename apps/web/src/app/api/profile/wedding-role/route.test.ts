// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const USER = "11111111-1111-4111-8111-111111111111";
const REV = "33333333-3333-4333-8333-333333333333";
const OTHER = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: m.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: m.limit, rateLimitKey: () => "role" }));
vi.mock("@/lib/profileWeddingRole", async original => ({ ...await original<typeof import("@/lib/profileWeddingRole")>(), readProfileWeddingRole: m.read, saveProfileWeddingRole: m.save }));
import { GET, PUT } from "./route";
function request(body: Record<string, unknown>, origin = "https://hanbang.ai") { return new Request("https://hanbang.ai/api/profile/wedding-role", { method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({expected_user_id:USER,...body}) }); }
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ data: { user: { id: USER } } }); m.limit.mockResolvedValue(null);
  m.read.mockResolvedValue({ user_id: USER, confirmed_role: null, revision: null }); m.save.mockImplementation(async (_admin, userId, role) => ({ user_id: userId, confirmed_role: role, revision: REV })); });
describe("own explicitly confirmed wedding role API", () => {
  it("requires auth and trusted origin, never accepting a client-selected owner", async () => {
    expect((await PUT(request({ confirmed_role: "groom" }, "https://evil.test"))).status).toBe(403);
    m.auth.mockResolvedValue({ data: { user: null } });
    expect((await PUT(request({ confirmed_role: "groom" }))).status).toBe(401);
    expect((await GET(new Request("https://hanbang.ai/api/profile/wedding-role")))).toHaveProperty("status", 401);
    expect(m.save).not.toHaveBeenCalled();
  });
  it.each([
    { data: { user: { id: USER } }, error: new Error("auth verification failed") },
    { data: { user: { id: USER, is_anonymous: true } }, error: null },
  ])("rejects unverified or anonymous identities for both reads and writes", async authResult => {
    m.auth.mockResolvedValue(authResult);
    const responses = [await GET(new Request("https://hanbang.ai/api/profile/wedding-role")),
      await PUT(request({ confirmed_role: "groom", expected_revision: null }))];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("private, no-store");
    }
    expect(m.read).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
  });
  it("keeps rate limit metadata and body while preventing private response caching", async () => {
    m.limit.mockResolvedValue(new Response(JSON.stringify({ error: "요청이 너무 많아요." }), {
      status: 429, headers: { "content-type": "application/json", "retry-after": "60" },
    }));
    const response = await PUT(request({ confirmed_role: "groom", expected_revision: null }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ error: "요청이 너무 많아요." });
    expect(m.save).not.toHaveBeenCalled();
  });
  it.each(["groom", "bride", null])("saves only the authenticated owner's explicit choice: %s", async role => {
    expect((await PUT(request({ confirmed_role: role, expected_revision: null }))).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(expect.anything(), USER, role, null);
  });
  it.each([{ role: "bride" }, { confirmed_role: "partner" }, { confirmed_role: "groom", user_id: OTHER }, { confirmed_role: "bride", avatar_url: "🌷" }, {}])("rejects malformed or unrelated fields: %j", async body => {
    expect((await PUT(request(body))).status).toBe(400); expect(m.save).not.toHaveBeenCalled();
  });
  it("bounds the actual body without trusting content-length", async () => {
    expect((await PUT(request({ confirmed_role: "a".repeat(1024) }))).status).toBe(413);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("rejects an A-screen initial draft if the authenticated cookie has changed to B", async () => {
    m.auth.mockResolvedValue({data:{user:{id:OTHER}}});
    const response=await PUT(request({confirmed_role:"groom",expected_revision:null,expected_user_id:USER}));
    expect(response.status).toBe(409);expect((await response.json()).code).toBe("PROFILE_ROLE_OWNER_CHANGED");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("reads only the authenticated owner with no-store and preserves unresolved failure", async () => {
    const response = await GET(new Request(`https://hanbang.ai/api/profile/wedding-role?userId=${OTHER}`));
    expect(m.read).toHaveBeenCalledWith(expect.anything(), USER);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(await response.json()).toEqual({ user_id: USER, confirmed_role: null, revision: null });
    m.save.mockRejectedValue(new Error("network unavailable"));
    expect((await PUT(request({ confirmed_role: "bride", expected_revision: REV }))).status).toBe(503);
  });
});
