import { beforeEach, describe, expect, it, vi } from "vitest";

// 서버 동의 관문을 **실행해서** 확인한다.
//
// 그동안 이 계약을 지키던 것은 signupExistingAccount.test.ts 의 소스 문자열
// 정규식뿐이었다. 그래서 거절 블록을 generateLink 아래로 옮기기만 해도 그
// 검사는 통과한다 — 동의 없이 계정이 만들어지는데 초록불이 뜬다.
// 라우트를 실제로 호출하는 테스트는 mobileTurnstileBoundary.test.ts 하나였고,
// 그 파일의 signup 케이스는 전부 동의를 채워 보낸다.

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: (value: string) => value.toLowerCase(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: () => "ip-key",
  rateLimitSubjectKey: () => "subject-key",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { SIGNUP_CONSENT_POLICY_VERSION } from "@hanbang/shared";

import { POST as signup } from "./signup/route";

const VALID_BODY = {
  email: "sample@example.test",
  password: "Strong1!",
  name: "샘플 사용자",
  turnstileToken: "proof",
  termsAgreed: true,
  privacyAgreed: true,
  marketingAgreed: false,
};

function signupRequest(body: unknown) {
  return new Request("https://hanbang.ai/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("가입 동의 서버 관문 (실행)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://example.test/action" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { generateLink: mocks.generateLink } },
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  const MISSING = [
    { label: "동의 필드가 아예 없다", patch: {} as Record<string, unknown> },
    { label: "약관만 동의했다", patch: { privacyAgreed: false } },
    { label: "처리방침만 동의했다", patch: { termsAgreed: false } },
    { label: "둘 다 거부했다", patch: { termsAgreed: false, privacyAgreed: false } },
    // 문자열 "true" 를 동의로 받아주면 클라이언트 실수가 조용히 통과한다.
    { label: '문자열 "true" 를 보냈다', patch: { termsAgreed: "true", privacyAgreed: "true" } },
    { label: "숫자 1 을 보냈다", patch: { termsAgreed: 1, privacyAgreed: 1 } },
  ];

  for (const item of MISSING) {
    it(`${item.label} → 400 이고 계정을 만들지 않는다`, async () => {
      const body: Record<string, unknown> = { ...VALID_BODY, ...item.patch };
      if (Object.keys(item.patch).length === 0) {
        delete body.termsAgreed;
        delete body.privacyAgreed;
      }

      const response = await signup(signupRequest(body));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.code).toBe("SIGNUP_CONSENT_REQUIRED");
      // 계정 생성도 메일 발송도 일어나면 안 된다.
      expect(mocks.generateLink).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  }

  it("필수 동의가 있으면 계정을 만들고 동의 사실을 함께 저장한다", async () => {
    const response = await signup(signupRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);

    const options = mocks.generateLink.mock.calls[0]?.[0]?.options;
    expect(options?.data).toMatchObject({
      name: "샘플 사용자",
      terms_agreed: true,
      privacy_agreed: true,
      marketing_agreed: false,
      consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
    });
    // 언제 동의했는지가 없으면 기록으로 쓸 수 없다.
    expect(typeof options?.data?.consent_agreed_at).toBe("string");
    expect(Number.isNaN(Date.parse(options.data.consent_agreed_at))).toBe(false);
  });

  it("마케팅 동의는 선택이고, 보낸 값 그대로 저장된다", async () => {
    await signup(signupRequest({ ...VALID_BODY, marketingAgreed: true }));

    expect(mocks.generateLink.mock.calls[0]?.[0]?.options?.data)
      .toMatchObject({ marketing_agreed: true });
  });

  it("클라이언트가 보낸 약관 판 번호는 저장에 쓰지 않는다", async () => {
    await signup(signupRequest({ ...VALID_BODY, consentPolicyVersion: "1900-01-01" }));

    expect(mocks.generateLink.mock.calls[0]?.[0]?.options?.data?.consent_policy_version)
      .toBe(SIGNUP_CONSENT_POLICY_VERSION);
  });

  it("동의 거절 응답이 그 주소의 가입 여부를 드러내지 않는다", async () => {
    // 열거 방어: 동의 오류는 계정 존재와 무관하게 같은 문장이어야 한다.
    const response = await signup(signupRequest({ ...VALID_BODY, termsAgreed: false }));
    const text = JSON.stringify(await response.json());

    for (const leak of ["이미 가입", "already registered", "exists", "not found"]) {
      expect(text, leak).not.toContain(leak);
    }
    // 계정 조회 자체가 일어나지 않아야 응답 시간으로도 새지 않는다.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
