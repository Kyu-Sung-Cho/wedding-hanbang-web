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
  createUser: vi.fn(),
  updateUserById: vi.fn(),
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

import { SIGNUP_CONSENT_POLICY_VERSION, buildSignupConsentServerEvidence } from "@hanbang/shared";

import { POST as signup } from "./signup/route";

const VALID_BODY = {
  email: "sample@example.test",
  password: "Strong1!",
  name: "샘플 사용자",
  turnstileToken: "proof",
  termsAgreed: true,
  privacyAgreed: true,
  ageOver14Confirmed: true,
  consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
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
      data: { user: { id: "synthetic-new-user", email: "sample@example.test", app_metadata: { provider: "email" } }, properties: { hashed_token: "tok_test" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { createUser: mocks.createUser, generateLink: mocks.generateLink, updateUserById: mocks.updateUserById } },
    });
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.createUser.mockResolvedValue({ data: { user: { id: "synthetic-new-user", email: "sample@example.test" } }, error: null });
    vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  const MISSING = [
    { label: "동의 필드가 아예 없다", patch: {} as Record<string, unknown> },
    { label: "약관만 동의했다", patch: { privacyAgreed: false } },
    { label: "처리방침만 동의했다", patch: { termsAgreed: false } },
    { label: "둘 다 거부했다", patch: { termsAgreed: false, privacyAgreed: false } },
    // 만 14세 확인은 화면에서만 막으면 안 된다 — 앱을 거치지 않는 요청이
    // 그대로 통과한다. 개인정보보호법 제22조의2는 만 14세 미만 아동의 개인정보를
    // 법정대리인 동의 없이 처리하지 못하게 하는데 이 서비스에는 그 절차가 없다.
    { label: "만 14세 확인이 없다", patch: { ageOver14Confirmed: undefined } },
    { label: "만 14세 확인을 거부했다", patch: { ageOver14Confirmed: false } },
    { label: '만 14세 확인에 문자열 "true" 를 보냈다', patch: { ageOver14Confirmed: "true" } },
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
      expect(mocks.createUser).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  }

  it("필수 동의가 있으면 계정을 만들고 동의 사실을 함께 저장한다", async () => {
    const response = await signup(signupRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);

    const created = mocks.createUser.mock.calls[0]?.[0];
    expect(created?.user_metadata).toMatchObject({
      name: "샘플 사용자",
      terms_agreed: true,
      privacy_agreed: true,
      marketing_agreed: false,
      consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
    });
    // 언제 동의했는지가 없으면 기록으로 쓸 수 없다.
    expect(typeof created?.user_metadata?.consent_agreed_at).toBe("string");
    expect(Number.isNaN(Date.parse(created.user_metadata.consent_agreed_at))).toBe(false);
  });

  it("마케팅 동의는 선택이고, 보낸 값 그대로 저장된다", async () => {
    await signup(signupRequest({ ...VALID_BODY, marketingAgreed: true }));

    expect(mocks.createUser.mock.calls[0]?.[0]?.user_metadata)
      .toMatchObject({ marketing_agreed: true });
  });

  it("새 계정과 서버 증거를 원자 생성하고 미인증 상태에서 같은 주체의 링크만 발송한다", async () => {
    await signup(signupRequest(VALID_BODY));
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: VALID_BODY.email, password: VALID_BODY.password, email_confirm: false,
      user_metadata: expect.objectContaining({ name: VALID_BODY.name }),
      app_metadata: { signup_consent: {
        schemaVersion: 1, source: "hanbang_auth_server", record: expect.objectContaining({
          terms_agreed: true, privacy_agreed: true, age_over_14_confirmed: true,
          consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
        }),
      } },
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.createUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateLink.mock.invocationCallOrder[0]);
    expect(mocks.generateLink.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
  });

  it("증거 저장 실패면 인증 메일이나 성공 응답을 보내지 않는다", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { message: "sensitive-diagnostic" } });
    const response = await signup(signupRequest(VALID_BODY));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive-diagnostic");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("기존 미인증 계정의 서버 증거는 제3자의 재가입 요청으로 바꾸지 않는다", async () => {
    const evidence = buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-08-31" }, "2026-08-31T01:00:00.000Z");
    const before = JSON.stringify(evidence);
    for (const app_metadata of [{ signup_consent: evidence }, { signup_consent: null }, { signup_consent: { source: "malformed" } }, {}]) {
      const beforeMetadata = JSON.stringify(app_metadata);
      mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } });
      mocks.generateLink.mockResolvedValue({ data: { user: { id: "existing-unconfirmed", email: "sample@example.test", app_metadata }, properties: { hashed_token: "tok" } }, error: null });
      const response = await signup(signupRequest({ ...VALID_BODY, marketingAgreed: true }));
      expect(response.status).toBe(200);
      expect(mocks.updateUserById).not.toHaveBeenCalled();
      expect(JSON.stringify(app_metadata)).toBe(beforeMetadata);
    }
    expect(JSON.stringify(evidence)).toBe(before);
    expect(mocks.send).toHaveBeenCalledTimes(4);
    expect(mocks.generateLink.mock.calls.every(([input]) => input.type === "recovery")).toBe(true);
  });

  it("가입 반환 주체가 없거나 요청 이메일과 다르면 다른 주체에 증거를 붙이지 않는다", async () => {
    for (const user of [null, { id: "other", email: VALID_BODY.email }, { id: "synthetic-new-user", email: "other@example.test" }]) {
      mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "tok" }, user }, error: null });
      const response = await signup(signupRequest(VALID_BODY));
      expect(response.status).toBe(503);
    }
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("생성 후 링크 실패의 재시도는 기존 계정 안내로 복구하며 동의를 다시 쓰지 않는다", async () => {
    mocks.generateLink.mockResolvedValueOnce({ data: null, error: { message: "synthetic link failed" } });
    expect((await signup(signupRequest(VALID_BODY))).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists", message: "already registered" } });
    expect((await signup(signupRequest({ ...VALID_BODY, marketingAgreed: true }))).status).toBe(200);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.generateLink.mock.calls.map(([input]) => input.type)).toEqual(["signup", "recovery"]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("계정 생성 예외와 잘못된 생성 주체는 링크·메일 없이 고정 오류로 끝난다", async () => {
    mocks.createUser.mockRejectedValueOnce(new Error("sensitive-create-diagnostic"));
    const failed = await signup(signupRequest(VALID_BODY));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("sensitive-create-diagnostic");
    mocks.createUser.mockResolvedValueOnce({ data: { user: { id: "other", email: "other@example.test" } }, error: null });
    expect((await signup(signupRequest(VALID_BODY))).status).toBe(503);
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("직전 정식 모바일의 가입은 허용하고 실제 동의판을 서버 증거에 보존한다", async () => {
    const consentPolicyVersion = "2026-09-11";
    const response = await signup(signupRequest({ ...VALID_BODY, consentPolicyVersion }));
    expect(response.status).toBe(200);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    const created = mocks.createUser.mock.calls[0]?.[0];
    expect(created?.user_metadata?.consent_policy_version).toBe(consentPolicyVersion);
    expect(created?.app_metadata?.signup_consent).toMatchObject({
      schemaVersion: 1,
      source: "hanbang_auth_server",
      record: { consent_policy_version: consentPolicyVersion, age_over_14_confirmed: true },
    });
  });

  it("지원하지 않는 판본이나 판본 없는 요청은 새 계정·서버 증거·메일을 만들지 않는다", async () => {
    for (const consentPolicyVersion of ["1900-01-01", "2026-08-22", "2026-08-31", "2026-09-12", "2026-09-24", undefined]) {
      const response = await signup(signupRequest({ ...VALID_BODY, consentPolicyVersion }));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("SIGNUP_CONSENT_VERSION_REQUIRED");
    }
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
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
