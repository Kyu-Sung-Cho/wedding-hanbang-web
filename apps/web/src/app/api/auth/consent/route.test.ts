// 계정이 **이미 있는** 상태에서 동의만 받아 붙이는 자리. 소셜 로그인이
// 그 경우다 — Supabase 가 계정을 직접 만들었으므로 가입 라우트를 지나지 않았다.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUserById: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: () => "consent-key",
}));

import { SIGNUP_CONSENT_POLICY_VERSION } from "@hanbang/shared";

import { POST as consent } from "./route";

const ORIGIN = "https://hanbang.ai";

function consentRequest(body: unknown) {
  return new Request(`${ORIGIN}/api/auth/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

const AGREED = {
  termsAgreed: true,
  privacyAgreed: true,
  // 만 14세 확인이 빠지면 서버가 계정을 만들지 않는다(개인정보보호법 제22조의2).
  ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
  marketingAgreed: false,
};

describe("POST /api/auth/consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: { name: "소셜 사용자" } } },
    });
  });

  it("세션이 없으면 401 이고 아무것도 쓰지 않는다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await consent(consentRequest(AGREED));

    expect(response.status).toBe(401);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("필수 동의가 없으면 400 이고 아무것도 쓰지 않는다", async () => {
    for (const body of [
      {},
      { termsAgreed: true },
      { privacyAgreed: true },
      { termsAgreed: "true", privacyAgreed: "true" },
    ]) {
      const response = await consent(consentRequest(body));
      const payload = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(payload.code).toBe("SIGNUP_CONSENT_REQUIRED");
    }
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("동의를 세션 주인의 계정에 기록한다", async () => {
    const response = await consent(consentRequest(AGREED));

    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1);

    const [userId, patch] = mocks.updateUserById.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(patch.user_metadata).toMatchObject({
      terms_agreed: true,
      privacy_agreed: true,
      marketing_agreed: false,
      consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
    });
    expect(typeof patch.user_metadata.consent_agreed_at).toBe("string");
  });

  it("기존 메타데이터를 지우지 않는다", async () => {
    // Auth는 제공된 키만 병합하므로 이름·사진을 재전송하지 않는다.
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          user_metadata: { name: "김한방", avatar_url: "https://example.test/a.png" },
        },
      },
    });

    await consent(consentRequest(AGREED));

    const patch = mocks.updateUserById.mock.calls[0][1];
    expect(patch.user_metadata).not.toHaveProperty("name");
    expect(patch.user_metadata).not.toHaveProperty("avatar_url");
  });

  it("본문으로 남의 계정을 지목할 수 없다", async () => {
    await consent(consentRequest({ ...AGREED, userId: "victim", id: "victim" }));

    expect(mocks.updateUserById.mock.calls[0][0]).toBe("user-1");
  });

  it("실제 세션 주체의 app_metadata를 보존하고 본문의 가짜 서버 증거를 무시한다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner", user_metadata: { name: "기존 이름" }, app_metadata: { provider: "google", owned_role: "unchanged" } } } });
    await consent(consentRequest({ ...AGREED, app_metadata: { owned_role: "admin", signup_consent: { source: "client" } } }));
    const [owner, patch] = mocks.updateUserById.mock.calls[0];
    expect(owner).toBe("owner");
    expect(patch.app_metadata).toEqual({ signup_consent: {
      schemaVersion: 1, source: "hanbang_auth_server", record: expect.objectContaining({
        consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION, age_over_14_confirmed: true,
      }),
    } });
    expect(patch.app_metadata.signup_consent.record.consent_agreed_at).toBe(patch.user_metadata.consent_agreed_at);
  });

  it("동의 조회 뒤 변경된 이름·provider·서버 권한을 과거 값으로 덮어쓰지 않는다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner", user_metadata: { name: "old" }, app_metadata: { provider: "old", role: "old" } } } });
    let stored = { user_metadata: { name: "new" }, app_metadata: { provider: "new", role: "new" } };
    mocks.updateUserById.mockImplementation(async (_id, input: unknown) => {
      const patch = z.object({ user_metadata: z.record(z.string(), z.unknown()), app_metadata: z.record(z.string(), z.unknown()) }).parse(input);
      stored = { user_metadata: { ...stored.user_metadata, ...patch.user_metadata }, app_metadata: { ...stored.app_metadata, ...patch.app_metadata } };
      return { error: null };
    });
    await consent(consentRequest(AGREED));
    expect(stored.user_metadata.name).toBe("new");
    expect(stored.app_metadata.provider).toBe("new");
    expect(stored.app_metadata.role).toBe("new");
  });

  it("직전 정식 모바일의 동의도 세션 주인에게 실제 판본 그대로 기록한다", async () => {
    const consentPolicyVersion = "2026-09-11";
    const response = await consent(consentRequest({ ...AGREED, consentPolicyVersion }));
    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1);
    const [owner, patch] = mocks.updateUserById.mock.calls[0];
    expect(owner).toBe("user-1");
    expect(patch.user_metadata.consent_policy_version).toBe(consentPolicyVersion);
    expect(patch.app_metadata.signup_consent).toMatchObject({
      schemaVersion: 1,
      source: "hanbang_auth_server",
      record: { consent_policy_version: consentPolicyVersion, age_over_14_confirmed: true },
    });
  });

  it("지원하지 않는 판본·누락 판본을 동의로 기록하지 않는다", async () => {
    for (const consentPolicyVersion of ["1900-01-01", "2026-08-22", "2026-08-31", "2026-09-12", "2026-09-24", undefined]) {
      const response = await consent(consentRequest({ ...AGREED, consentPolicyVersion }));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("SIGNUP_CONSENT_VERSION_REQUIRED");
    }
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("다른 출처에서 온 요청은 거절한다", async () => {
    const cross = new Request(`${ORIGIN}/api/auth/consent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.test",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify(AGREED),
    });

    const response = await consent(cross);

    expect(response.status).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("저장에 실패하면 성공이라고 말하지 않는다", async () => {
    mocks.updateUserById.mockResolvedValue({ error: { status: 500, message: "boom" } });

    const response = await consent(consentRequest(AGREED));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.success).toBeUndefined();
    // 내부 오류 원문을 사용자에게 돌려주지 않는다.
    expect(JSON.stringify(payload)).not.toContain("boom");
  });
});
