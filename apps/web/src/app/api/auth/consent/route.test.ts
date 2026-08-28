// 계정이 **이미 있는** 상태에서 동의만 받아 붙이는 자리. 소셜 로그인이
// 그 경우다 — Supabase 가 계정을 직접 만들었으므로 가입 라우트를 지나지 않았다.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
    // updateUserById 는 user_metadata 를 **통째로 교체한다.** 병합하지 않으면
    // 이름 같은 기존 값이 조용히 사라진다.
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
    expect(patch.user_metadata.name).toBe("김한방");
    expect(patch.user_metadata.avatar_url).toBe("https://example.test/a.png");
  });

  it("본문으로 남의 계정을 지목할 수 없다", async () => {
    await consent(consentRequest({ ...AGREED, userId: "victim", id: "victim" }));

    expect(mocks.updateUserById.mock.calls[0][0]).toBe("user-1");
  });

  it("클라이언트가 보낸 약관 판 번호를 쓰지 않는다", async () => {
    await consent(consentRequest({ ...AGREED, consentPolicyVersion: "1900-01-01" }));

    expect(mocks.updateUserById.mock.calls[0][1].user_metadata.consent_policy_version)
      .toBe(SIGNUP_CONSENT_POLICY_VERSION);
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
