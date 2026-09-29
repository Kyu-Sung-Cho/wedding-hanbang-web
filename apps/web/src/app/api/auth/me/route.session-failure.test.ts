// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE = { id: OWNER, name: "본인", couple_id: null, onboarding_completed: false };
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), profileRead: vi.fn(), profileInsert: vi.fn(), adminFrom: vi.fn(), signedDemo: vi.fn(),
}));
function query(read: () => Promise<unknown>) {
  const builder = { select: () => builder, eq: () => builder, single: read, maybeSingle: read };
  return builder;
}
vi.mock("@/lib/auth/signupConsentAccess", () => ({ getWebSignupConsentAccess: () => "server_verified" }));
vi.mock("@/lib/demoSession", () => ({ hasSignedDemoSessionFromCookieHeader: mocks.signedDemo }));
vi.mock("@/lib/profileWeddingRole", () => ({ readOptionalProfileWeddingRoles: async () => new Map() }));
vi.mock("@/lib/profileAvatar", () => ({ readOptionalProfileAvatars: async () => new Map() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom }) }));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER, email: "owner@example.invalid" } }, error: null });
  mocks.signedDemo.mockReturnValue(false);
  mocks.profileRead.mockResolvedValue({ data: PROFILE, error: null });
  mocks.profileInsert.mockResolvedValue({ data: PROFILE, error: null });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table !== "profiles") throw new Error(`Unexpected privileged query: ${table}`);
    return { ...query(mocks.profileRead), insert: () => query(mocks.profileInsert) };
  });
});

describe("auth/me does not turn unavailable authentication or profile data into logout", () => {
  it.each([
    new AuthRetryableFetchError("private network diagnostic", 0),
    new AuthRetryableFetchError("private upstream diagnostic", 503),
    new AuthApiError("private database diagnostic", 500, "unexpected_failure"),
    new AuthApiError("private rate-limit diagnostic", 429, "over_request_rate_limit"),
    new AuthUnknownError("private response diagnostic", new Error("invalid response")),
  ])("returns 503 for unavailable auth: $name $status", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    for (const mode of ["normal", "guest_probe", "signed_demo"]) {
      mocks.signedDemo.mockReturnValue(mode === "signed_demo");
      const response = await GET(new Request(`https://hanbang.ai/api/auth/me${mode === "guest_probe" ? "?guest_probe=1" : ""}`));
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).not.toHaveProperty("user");
      expect(body).not.toHaveProperty("demo");
      expect(JSON.stringify(body)).not.toContain(error.message);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it.each([
    new AuthSessionMissingError(),
    new AuthApiError("expired JWT", 403, "bad_jwt"),
    new AuthApiError("expired session", 400, "session_expired"),
    new AuthApiError("revoked refresh token", 400, "refresh_token_not_found"),
    new AuthApiError("legacy invalid credential", 401, undefined),
  ])("preserves signed-out, guest, and signed-demo behavior for $name $code", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    expect((await GET(new Request("https://hanbang.ai/api/auth/me"))).status).toBe(401);
    const guest = await GET(new Request("https://hanbang.ai/api/auth/me?guest_probe=1"));
    expect(guest.status).toBe(200);
    expect(await guest.json()).toEqual({ user: null });
    mocks.signedDemo.mockReturnValue(true);
    const demo = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(demo.status).toBe(200);
    expect(await demo.json()).toEqual({ user: null, demo: true });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("does not repair a profile when the initial lookup failed", async () => {
    mocks.profileRead.mockResolvedValue({ data: null, error: { code: "08006", message: "private profile diagnostic" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private profile diagnostic");
    expect(mocks.profileInsert).not.toHaveBeenCalled();
  });

  it.each(["database rejection", "missing returned row"])("does not return user-only success after a failed profile repair: %s", async scenario => {
    mocks.profileRead.mockResolvedValue({ data: null, error: null });
    mocks.profileInsert.mockResolvedValue({ data: null, error: scenario === "database rejection" ? { code: "08006", message: "private profile diagnostic" } : null });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("user");
    expect(JSON.stringify(body)).not.toContain("private profile diagnostic");
  });

  it("repairs a genuinely missing profile and returns the verified result", async () => {
    mocks.profileRead.mockResolvedValue({ data: null, error: null });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(200);
    expect((await response.json()).profile).toMatchObject(PROFILE);
    expect(mocks.profileInsert).toHaveBeenCalledOnce();
  });

  it.each(["visible profile", "read failure", "missing row"])("re-reads a concurrent 23505 profile repair: %s", async scenario => {
    mocks.profileRead.mockResolvedValueOnce({ data: null, error: null });
    mocks.profileRead.mockResolvedValue({ data: scenario === "visible profile" ? PROFILE : null,
      error: scenario === "read failure" ? { code: "08006", message: "private profile diagnostic" } : null });
    mocks.profileInsert.mockResolvedValue({ data: null, error: { code: "23505", message: "already exists" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(scenario === "visible profile" ? 200 : 503);
    const body = await response.json();
    if (scenario === "visible profile") expect(body.profile).toMatchObject(PROFILE);
    else expect(body).not.toHaveProperty("user");
    expect(mocks.profileRead).toHaveBeenCalledTimes(2);
  });
});
