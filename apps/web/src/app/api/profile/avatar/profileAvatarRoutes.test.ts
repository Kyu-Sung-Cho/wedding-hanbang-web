// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const m = vi.hoisted(() => ({ getUser: vi.fn(), directory: vi.fn(), couple: vi.fn(), read: vi.fn(), save: vi.fn(), download: vi.fn(), rateLimit: vi.fn(), logError: vi.fn() }));
vi.mock("@/utils/log", () => ({ log: { error: m.logError } }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: m.getUser }, from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: table === "couples" ? m.couple : m.directory }) }) }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: m.download }) } }) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: m.rateLimit, rateLimitKey: () => "avatar" }));
vi.mock("@/lib/profileAvatar", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/profileAvatar")>(), readProfileAvatar: m.read, readAuthorizedProfileAvatar: m.read, saveProfileAvatar: m.save }));
import { GET, PUT } from "./route";
import { GET as imageGET } from "./image/route";
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("https://hanbang.ai/api/profile/avatar", { method: "PUT", headers: { origin: "https://hanbang.ai", "content-type": "application/json", ...headers }, body: JSON.stringify({ expected_revision: null, expected_user_id: USER, ...(body as Record<string, unknown>) }) }); }
beforeEach(() => {
  vi.clearAllMocks(); m.getUser.mockResolvedValue({ data: { user: { id: USER } } }); m.directory.mockResolvedValue({ data: null, error: null });
  m.read.mockResolvedValue(null); m.rateLimit.mockResolvedValue(null); m.save.mockResolvedValue({ avatar_url: "🌸", revision: REVISION });
  m.couple.mockResolvedValue({ data: { bride_id: USER, groom_id: OTHER }, error: null });
  m.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2])], { type: "image/webp" }), error: null });
});
describe("profile avatar own mutation and authenticated image access", () => {
  it("reports storage outages without logging the private path or server error payload", async () => {
    m.read.mockResolvedValue({ user_id: USER, kind: "photo", object_path: `${USER}/${REVISION}.webp`, revision: REVISION });
    m.download.mockResolvedValue({ data: null, error: new Error("private-upload-filename.png token=do-not-log") });
    expect((await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${USER}&version=${REVISION}`))).status).toBe(503);
    expect(m.logError).toHaveBeenCalledWith("profile-avatar:image-unavailable");
    expect(JSON.stringify(m.logError.mock.calls)).not.toContain(USER);
    expect(JSON.stringify(m.logError.mock.calls)).not.toContain("private-upload");
  });

  it("refuses expired or anonymous authentication before Storage access", async () => {
    for(const result of [{data:{user:{id:USER}},error:{message:"expired"}}, {data:{user:{id:USER,is_anonymous:true}},error:null}]) {
      m.getUser.mockResolvedValue(result);
      expect((await PUT(request({kind:"initial"}))).status).toBe(401);
      expect((await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${USER}&version=${REVISION}`))).status).toBe(401);
    }
    expect(m.save).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled();
  });
  it("requires the editor revision and rejects duplicate multipart fields", async () => {
    for(const expected_revision of [undefined,"bad",42,{},[]]) expect((await PUT(request({kind:"initial",expected_revision}))).status).toBe(400);
    const form=new FormData(); form.append("photo",new Blob(["x"],{type:"image/png"}),"x.png"); form.append("expected_revision","null");form.append("expected_revision",REVISION);form.append("expected_user_id",USER);
    expect((await PUT(new Request("https://hanbang.ai/api/profile/avatar",{method:"PUT",headers:{origin:"https://hanbang.ai"},body:form}))).status).toBe(400);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("requires one valid screen owner field in each input format", async () => {
    for (const expected_user_id of [undefined, "bad", null, 42]) expect((await PUT(request({ kind: "initial", expected_user_id }))).status).toBe(400);
    const form = new FormData(); form.set("photo", new Blob(["photo"], { type: "image/png" }), "a.png"); form.set("expected_revision", "null");
    const make = () => new Request("https://hanbang.ai/api/profile/avatar", { method: "PUT", headers: { origin: "https://hanbang.ai" }, body: form });
    expect((await PUT(make())).status).toBe(400);
    form.append("expected_user_id", USER); form.append("expected_user_id", OTHER);
    expect((await PUT(make())).status).toBe(400);
    expect(m.save).not.toHaveBeenCalled();
  });
  it.each(["json", "photo"])("rejects an A-screen initial draft when the authenticated cookie changed to B: %s", async format => {
    m.getUser.mockResolvedValue({ data: { user: { id: OTHER } }, error: null });
    const form = new FormData();
    form.set("photo", new Blob(["photo"], { type: "image/png" }), "a.png");
    form.set("expected_revision", "null"); form.set("expected_user_id", USER);
    const req = format === "json" ? request({ kind: "emoji", emoji: "🌸" })
      : new Request("https://hanbang.ai/api/profile/avatar", { method: "PUT", headers: { origin: "https://hanbang.ai" }, body: form });
    const result = await PUT(req);
    expect(result.status).toBe(409);
    expect((await result.json()).code).toBe("AVATAR_OWNER_CHANGED");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("does not emit downloaded bytes when membership or selected photo changed meanwhile", async () => {
    m.read.mockResolvedValueOnce({user_id:OTHER,kind:"photo",revision:REVISION,object_path:`${OTHER}/${REVISION}.webp`}).mockResolvedValueOnce(null);
    expect((await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${OTHER}&version=${REVISION}`))).status).toBe(404);
    expect(m.download).toHaveBeenCalledTimes(1);
  });
  it("rate limiting fails closed and keeps responses private", async () => {
    m.rateLimit.mockResolvedValue(new Response("{}",{status:429}));
    const result=await PUT(request({kind:"initial"}));
    expect(result.status).toBe(429); expect(result.headers.get("cache-control")).toContain("no-store"); expect(m.save).not.toHaveBeenCalled();
    expect(m.rateLimit).toHaveBeenCalledWith(expect.anything(),expect.anything(),{failClosed:true});
  });
  it("reports an unexpected request failure with a fixed safe code", async () => {
    m.read.mockRejectedValueOnce(new Error("private-image-bytes or token"));
    expect((await GET(new Request("https://hanbang.ai/api/profile/avatar")))).toHaveProperty("status", 503);
    expect(m.logError).toHaveBeenCalledWith("profile-avatar:request-failed", expect.objectContaining({ message: "PROFILE_AVATAR_UNAVAILABLE" }));
  });

  it("requires authentication and trusted origin before writes", async () => {
    expect((await PUT(request({ kind: "initial" }, { origin: "https://evil.test" }))).status).toBe(403);
    m.getUser.mockResolvedValue({ data: { user: null } });
    expect((await PUT(request({ kind: "initial" }))).status).toBe(401);
    expect((await GET(new Request("https://hanbang.ai/api/profile/avatar")))).toHaveProperty("status", 401);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("uses authenticated owner for emoji and rejects userId or URL injection", async () => {
    expect((await PUT(request({ kind: "emoji", emoji: "🌸" }))).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(expect.anything(), USER, { kind: "emoji", emoji: "🌸" }, null);
    for (const body of [{ kind: "initial", userId: OTHER }, { kind: "photo", avatar_url: "https://evil.test/a.jpg" }, { kind: "emoji", emoji: "1" }]) expect((await PUT(request(body))).status).toBe(400);
    expect(m.save).toHaveBeenCalledTimes(1);
  });
  it("accepts a single photo field and rejects additional identity fields", async () => {
    const form = new FormData(); form.set("expected_revision", "null"); form.set("expected_user_id", USER); form.set("photo", new Blob(["photo"], { type: "image/png" }), "a.png");
    const make = () => new Request("https://hanbang.ai/api/profile/avatar", { method: "PUT", headers: { origin: "https://hanbang.ai" }, body: form });
    expect((await PUT(make())).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(expect.anything(), USER, expect.objectContaining({ kind: "photo", mimeType: "image/png" }), null);
    form.set("userId", OTHER); expect((await PUT(make())).status).toBe(400);
  });
  it("rejects oversized actual body even without declared content length", async () => {
    const response = await PUT(request({ kind: "emoji", emoji: "a".repeat(1200) }));
    expect(response.status).toBe(413); expect(m.save).not.toHaveBeenCalled();
  });
  it("reads only the current user regardless of query and disables cache", async () => {
    const response = await GET(new Request(`https://hanbang.ai/api/profile/avatar?userId=${OTHER}`));
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(m.read).toHaveBeenCalledWith(expect.anything(), USER);
    expect(await response.json()).toEqual({ avatar_url: null, revision: null });
  });
  it("refuses unrelated image access without fetching avatar or bytes", async () => {
    const response = await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${OTHER}&version=${REVISION}`));
    expect(response.status).toBe(404); expect(m.read).toHaveBeenCalledWith(expect.anything(), USER, OTHER); expect(m.download).not.toHaveBeenCalled();
  });
  it.each([USER, OTHER])("serves current own or verified partner image: %s", async owner => {
    m.directory.mockResolvedValue({ data: { id: OTHER, couple_id: REVISION }, error: null });
    m.read.mockResolvedValue({ user_id: owner, kind: "photo", object_path: `${owner}/${REVISION}.webp`, revision: REVISION });
    const response = await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${owner}&version=${REVISION}`));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    if (owner === USER) expect(m.directory).not.toHaveBeenCalled();
  });
  it("never returns a previous revision after reset or replacement", async () => {
    m.read.mockResolvedValue({ kind: "photo", revision: OTHER, object_path: `${USER}/${OTHER}.webp` });
    expect((await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${USER}&version=${REVISION}`))).status).toBe(404);
    expect(m.download).not.toHaveBeenCalled();
  });
  it("denies a stale directory entry when the roster no longer connects these users", async () => {
    m.directory.mockResolvedValue({ data: { id: OTHER, couple_id: REVISION }, error: null });
    m.couple.mockResolvedValue({ data: { bride_id: USER, groom_id: REVISION }, error: null });
    expect((await imageGET(new Request(`https://hanbang.ai/api/profile/avatar/image?userId=${OTHER}&version=${REVISION}`))).status).toBe(404);
    expect(m.download).not.toHaveBeenCalled();
  });
});
