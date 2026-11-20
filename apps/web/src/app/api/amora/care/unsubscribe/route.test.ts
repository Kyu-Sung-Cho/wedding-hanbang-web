import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCareUnsubscribeToken,
  buildCareUnsubscribeUrl,
  readCareUnsubscribeSecret,
  verifyCareUnsubscribeToken,
} from "@/lib/care/careUnsubscribe";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-care-unsubscribe:test"),
}));

const SECRET = "care-unsubscribe-test-secret-0123456789abcdef";
const USER_ID = "00000000-0000-4000-8000-0000000000aa";

function url(token: string | null) {
  return token === null
    ? "http://localhost/api/amora/care/unsubscribe"
    : buildCareUnsubscribeUrl("http://localhost", token);
}

describe("care email unsubscribe token", () => {
  it("is stable for one person and verifies only with the same secret", () => {
    const token = buildCareUnsubscribeToken(SECRET, USER_ID);
    expect(buildCareUnsubscribeToken(SECRET, USER_ID)).toBe(token);
    expect(verifyCareUnsubscribeToken(SECRET, token)).toBe(USER_ID);
    expect(verifyCareUnsubscribeToken(`${SECRET}-other`, token)).toBeNull();
  });

  it("rejects a token re-pointed at another person or tampered with", () => {
    const token = buildCareUnsubscribeToken(SECRET, USER_ID);
    const [version, , signature] = token.split(".");
    const other = "00000000-0000-4000-8000-0000000000bb";
    expect(verifyCareUnsubscribeToken(SECRET, `${version}.${other}.${signature}`)).toBeNull();
    expect(verifyCareUnsubscribeToken(SECRET, `${token}x`)).toBeNull();
    expect(verifyCareUnsubscribeToken(SECRET, `v2${token.slice(2)}`)).toBeNull();
    expect(verifyCareUnsubscribeToken(SECRET, "not-a-token")).toBeNull();
    expect(verifyCareUnsubscribeToken(SECRET, null)).toBeNull();
  });

  it("refuses a missing or short secret instead of signing with it", () => {
    expect(readCareUnsubscribeSecret({ AMORA_CARE_UNSUBSCRIBE_SECRET: "" })).toBeNull();
    expect(readCareUnsubscribeSecret({ AMORA_CARE_UNSUBSCRIBE_SECRET: "short" })).toBeNull();
    expect(readCareUnsubscribeSecret({ AMORA_CARE_UNSUBSCRIBE_SECRET: SECRET })).toBe(SECRET);
    expect(() => buildCareUnsubscribeToken(SECRET, "member-1")).toThrow();
  });
});

describe("/api/amora/care/unsubscribe", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", SECRET);
    rpc.mockResolvedValue({ data: { profile: {} }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("only shows a confirmation when the link is opened, so a mail scanner changes nothing", async () => {
    const response = await GET(new Request(url(buildCareUnsubscribeToken(SECRET, USER_ID))));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("아모라 메일을 그만 받을까요?");
    expect(html).toContain('method="post"');
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns off only this person's care email on the one-click POST", async () => {
    const response = await POST(new Request(url(buildCareUnsubscribeToken(SECRET, USER_ID)), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: USER_ID,
      p_care_email_enabled: false,
    });
    expect(await response.text()).toContain("함께 대화의 글은 그대로 오고");
  });

  it("refuses a forged or missing token without touching the database", async () => {
    const forged = buildCareUnsubscribeToken(`${SECRET}-attacker`, USER_ID);
    for (const request of [
      new Request(url(forged), { method: "POST" }),
      new Request(url(null), { method: "POST" }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
    }
    expect((await GET(new Request(url(forged)))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses every link while the server has no secret", async () => {
    vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", "");
    const response = await POST(new Request(url(buildCareUnsubscribeToken(SECRET, USER_ID)), { method: "POST" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the same way for an account that no longer exists", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "PROFILE_PATCH_PROFILE_NOT_FOUND" } });
    const response = await POST(new Request(url(buildCareUnsubscribeToken(SECRET, USER_ID)), { method: "POST" }));
    expect(response.status).toBe(200);
  });

  it("keeps the button when saving fails so the person can try again", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const response = await POST(new Request(url(buildCareUnsubscribeToken(SECRET, USER_ID)), { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('method="post"');
  });
});
