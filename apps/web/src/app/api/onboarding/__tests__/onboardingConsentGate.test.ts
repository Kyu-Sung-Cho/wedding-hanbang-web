// 온보딩은 `(auth)` 라우트 그룹이라 AuthenticatedAppShell 의 동의 관문 밖에
// 있다. 콜백이 /consent 로 돌려세워도 주소를 직접 치면 그 화면에 닿는다.
// 그리고 그 화면이 부르는 이 라우트에서 **커플과 예식일이 실제로 만들어진다.**
// 화면이 아니라 쓰는 자리를 막아야 모바일 등 다른 클라이언트도 함께 덮인다.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAdminClient: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: () => "onboarding-key",
  rateLimitSubjectKey: () => "onboarding-subject",
}));

import { POST as onboarding } from "../route";

const ORIGIN = "https://hanbang.ai";

function onboardingRequest(body: unknown) {
  return new Request(`${ORIGIN}/api/onboarding`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

const NEUTRAL_BODY = {
  membershipMode: "neutral_preparation_space",
  coupleAction: "create",
  weddingDate: "2027-05-20",
  venue: null,
  totalBudget: null,
  progress: {},
};

function userWith(metadata: Record<string, unknown>) {
  return {
    data: {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        created_at: "2026-08-30T00:00:00.000Z", user_metadata: metadata,
      },
    },
  };
}

describe("온보딩은 동의 없이 아무것도 만들지 않는다", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("동의 관문을 지나기 전에 관리자 클라이언트를 만들었다");
    });
  });

  it("동의 기록이 없으면 400 이고 커플을 만들지 않는다", async () => {
    mocks.getUser.mockResolvedValue(userWith({ name: "소셜 사용자" }));

    const response = await onboarding(onboardingRequest(NEUTRAL_BODY));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe("SIGNUP_CONSENT_REQUIRED");
    // 커플 생성은커녕 관리자 클라이언트조차 만들어지면 안 된다.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("한쪽만 동의한 기록으로는 통과하지 못한다", async () => {
    for (const metadata of [
      { terms_agreed: true },
      { privacy_agreed: true },
      { terms_agreed: true, privacy_agreed: false },
      { terms_agreed: "true", privacy_agreed: "true" },
      { marketing_agreed: true },
    ]) {
      mocks.getUser.mockResolvedValue(userWith(metadata));

      const response = await onboarding(onboardingRequest(NEUTRAL_BODY));

      expect(response.status, JSON.stringify(metadata)).toBe(400);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    }
  });

  it("동의 관문이 레이트리밋보다 먼저 온다", async () => {
    // 뒤에 있으면 동의 없는 요청이 남의 몫까지 한도를 깎는다.
    mocks.getUser.mockResolvedValue(userWith({}));

    await onboarding(onboardingRequest(NEUTRAL_BODY));

    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("동의한 계정은 이 관문에서 막히지 않는다", async () => {
    mocks.getUser.mockResolvedValue(
      userWith({ terms_agreed: true, privacy_agreed: true }),
    );

    const response = await onboarding(onboardingRequest(NEUTRAL_BODY));
    const payload = await response.json().catch(() => ({}));

    // 이 파일은 관문만 본다. 뒤에서 무엇으로 끝나든 상관없지만,
    // **동의 때문에** 막히지는 않아야 한다.
    expect(payload.code).not.toBe("SIGNUP_CONSENT_REQUIRED");
  });
});
