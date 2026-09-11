import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "./route";
import { buildSignupConsentServerEvidence } from "@hanbang/shared";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/me/route.ts"),
  "utf8",
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

describe("/api/auth/me GET guest probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
  });

  it("keeps the normal endpoint authentication-required", async () => {
    const response = await GET(new Request("http://localhost/api/auth/me"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a cache-disabled anonymous result for the exact guest probe", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ user: null });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not enable the probe for a truthy-looking alternative value", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=true"),
    );

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("projects private rows explicitly and keeps invite codes behind their dedicated API", () => {
    expect(routeSource).not.toContain('.select("*")');
    expect(routeSource).not.toMatch(/\.select\(\s*\)/);
    expect(routeSource).not.toMatch(
      /PROFILE_AUTH_COLUMNS[\s\S]*phone|PROFILE_AUTH_COLUMNS[\s\S]*push_token/,
    );
    expect(routeSource).toContain("invite_code: null");
    expect(routeSource).toContain("PRIVATE_NO_STORE_HEADERS");
    expect(routeSource).toMatch(
      /JOURNEY_AUTH_COLUMNS[\s\S]*state_revision/,
    );
    expect(routeSource).toContain("journeyInsertErr?.code === \"23505\"");
  });

  it("legacy와 서버 증거를 구분한 최소 동의 응답은 프로필 생성·조회 없이 반환한다", async () => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    const evidence = buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-08-31" }, "2026-08-31T01:00:00.000Z");
    for (const [expected, user] of [
      ["legacy_unverified", { id: "owner", created_at: "2026-08-30T00:00:00.000000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } }],
      ["server_verified", { id: "owner", app_metadata: { signup_consent: evidence }, user_metadata: {} }],
      ["required", { id: "owner", created_at: "2026-09-01T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true, signup_consent: evidence } }],
    ] as const) {
      mocks.getUser.mockResolvedValue({ data: { user } });
      const response = await GET(new Request("http://localhost/api/auth/me?consent_only=1"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ user: { id: "owner" }, capabilities: {
        neutralPreparationSpace: false, accountDeletionIntake: false,
        signupConsentAccess: expected, requiresSignupConsent: expected === "required",
      } });
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("구회원 전환 설정이 없으면 재동의를 강요하거나 기존 flags를 승격하지 않고 설정 오류를 반환한다", async () => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner", created_at: "2026-08-30T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } } } });
    const response = await GET(new Request("http://localhost/api/auth/me?consent_only=1"));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("SIGNUP_CONSENT_CONFIGURATION_REQUIRED");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
