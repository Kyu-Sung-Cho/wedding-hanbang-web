import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 가입은 인증 메일이 나가야 끝난다. 그 발송이 실패했을 때 이 라우트가 무엇을
// 말하는지가 여기서 정하는 계약이다.
//
// 예전에는 어떤 실패든 한 문장이었다 — "인증 메일을 보내지 못했어요. 잠시 후 다시
// 시도해 주세요." 키가 거절되거나 보내는 도메인이 등록돼 있지 않으면 잠시 후에도
// 같은 결과인데, 그 사람은 될 리 없는 일을 반복했다. 실패 원인은 서버 콘솔 한 줄로만
// 남아 Sentry 에 오르지 않아 안에서도 무엇이 고장 났는지 알 수 없었다.

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
  logError: vi.fn(),
  constructedWithKey: [] as string[],
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

vi.mock("@/utils/log", () => ({
  log: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("resend", () => ({
  Resend: class {
    constructor(key?: string) {
      // 실제 SDK 를 실행해 확인한 동작을 그대로 흉내낸다(resend 6.10.0):
      //   new Resend(undefined) → throws
      //   new Resend("")        → throws
      //   new Resend("   ")     → 던지지 않고 그 값을 그대로 들고 간다
      // 그 마지막 줄이 운영 502 의 후보였다 — 값이 있으면 SDK 는 검사하지 않는다.
      if (!key) throw new Error("Missing API key.");
      mocks.constructedWithKey.push(key);
    }
    emails = { send: mocks.send };
  },
}));

import { POST as signup } from "../signup/route";

const VALID_BODY = {
  email: "sample@example.test",
  password: "Strong1!",
  name: "샘플 사용자",
  turnstileToken: "proof",
  termsAgreed: true,
  privacyAgreed: true,
  ageOver14Confirmed: true,
};

function signupRequest(body: unknown = VALID_BODY) {
  return new Request("https://hanbang.ai/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 이미 가입된(확인 완료) 주소로 다시 가입을 시도한 상태를 만든다. */
function makeEmailAlreadyRegistered() {
  mocks.generateLink.mockImplementation(async ({ type }: { type: string }) =>
    type === "signup"
      ? { data: null, error: { message: "Email address already registered by another user" } }
      : { data: { properties: { hashed_token: "tok_recovery" } }, error: null },
  );
}

describe("인증 메일이 나가지 못했을 때", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.constructedWithKey.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok_test" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { generateLink: mocks.generateLink } },
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * 환경변수에 값을 붙여 넣을 때 끝에 줄바꿈이 따라오는 것은 아주 흔하다. 그런데
   * SDK 는 값이 있기만 하면 검사하지 않고 `Bearer <값>` 을 만들어 보내고, 제공자는
   * "API key is invalid" 로 거절한다. 그 한 글자 때문에 가입이 전부 막힌다.
   */
  describe("자격 문자열이 지저분할 때", () => {
    it("앞뒤 공백과 줄바꿈은 없애고 보낸다", async () => {
      vi.stubEnv("RESEND_API_KEY", "  re_real_key\n");

      const response = await signup(signupRequest());

      expect(response.status).toBe(200);
      // 다듬지 않으면 제공자가 이 값을 거절하고 가입이 502 로 끝난다.
      expect(mocks.constructedWithKey).toEqual(["re_real_key"]);
    });

    it("공백만 있는 값은 자격이 없는 것으로 본다", async () => {
      // SDK 는 "   " 를 받아도 던지지 않는다. 그래서 우리가 먼저 봐야 한다.
      vi.stubEnv("RESEND_API_KEY", "   ");

      const response = await signup(signupRequest());
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload.code).toBe("EMAIL_DELIVERY_UNCONFIGURED");
      expect(mocks.generateLink).not.toHaveBeenCalled();
    });

    const UNUSABLE = [
      ["가운데에 줄바꿈이 있다", "re_abc\ndef"],
      ["가운데에 공백이 있다", "re_abc def"],
      ["따옴표로 싸여 있다", '"re_abc"'],
      ["작은따옴표로 싸여 있다", "'re_abc'"],
    ] as const;

    for (const [label, value] of UNUSABLE) {
      it(`${label} → 계정을 만들기 전에 되돌아간다`, async () => {
        vi.stubEnv("RESEND_API_KEY", value);

        const response = await signup(signupRequest());
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload.code).toBe("EMAIL_DELIVERY_CREDENTIAL");
        // 어떤 형식의 키도 이런 문자를 품지 않는다. 보내 봐야 거절되고,
        // 그 전에 인증할 수 없는 계정만 남는다.
        expect(mocks.generateLink).not.toHaveBeenCalled();
      });
    }

    it("낯선 접두사만으로는 막지 않는다", async () => {
      // 제공자가 키 형식을 바꾸면 그 검사가 유효한 키를 막아 가입을 통째로 세운다 —
      // 고치려던 것보다 큰 사고를 우리가 만드는 셈이다.
      vi.stubEnv("RESEND_API_KEY", "rsnd_v2_abcdefghijklmnop");

      expect((await signup(signupRequest())).status).toBe(200);
    });
  });

  describe("발송 자격이 없는 배포", () => {
    it("계정을 만들기 전에 되돌아가고, 설정 문제라고 말한다", async () => {
      vi.stubEnv("RESEND_API_KEY", "");

      const response = await signup(signupRequest());
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload.code).toBe("EMAIL_DELIVERY_UNCONFIGURED");
      // 인증할 수단이 없는 계정을 만들어 두면 그 주소는 가입도 로그인도 못 하게 된다.
      expect(mocks.generateLink).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it("다시 시도하라고 말하지 않는다", async () => {
      vi.stubEnv("RESEND_API_KEY", "");

      const { error } = await (await signup(signupRequest())).json();

      // 될 리 없는 일을 반복시키는 것이 원래의 문제였다.
      expect(error).not.toContain("잠시 후 다시 시도");
      expect(error).toContain("다시 시도해도 같은 결과");
    });

    it("운영자가 볼 수 있는 자리에 원인을 남긴다", async () => {
      vi.stubEnv("RESEND_API_KEY", "");

      await signup(signupRequest());

      expect(mocks.logError).toHaveBeenCalledTimes(1);
      expect(String(mocks.logError.mock.calls[0]?.[0])).toContain("kind=unconfigured");
    });
  });

  describe("제공자가 발송을 거절할 때", () => {
    const CASES = [
      {
        label: "보내는 도메인이 등록돼 있지 않다",
        error: {
          name: "validation_error",
          statusCode: 403,
          message: "The hanbang.ai domain is not verified. Please, add and verify your domain.",
        },
        code: "EMAIL_DELIVERY_SENDER_DOMAIN",
        status: 503,
        kind: "sender_domain",
      },
      {
        // 2026-09-02 Resend API 실측 응답. 이름이 `invalid_api_key` 가 아니라
        // `validation_error` 로 오고, 상태 코드도 부르는 자리마다 401/400 으로
        // 갈린다. 그래서 판정이 상태 코드만 보면 안 된다.
        label: "키가 거절됐다 (401 validation_error)",
        error: { name: "validation_error", statusCode: 401, message: "API key is invalid" },
        code: "EMAIL_DELIVERY_CREDENTIAL",
        status: 503,
        kind: "credential",
      },
      {
        label: "키가 거절됐다 (400 validation_error)",
        error: { name: "validation_error", statusCode: 400, message: "API key is invalid" },
        code: "EMAIL_DELIVERY_CREDENTIAL",
        status: 503,
        kind: "credential",
      },
      {
        label: "키가 없다고 제공자가 답했다",
        error: { name: "missing_api_key", statusCode: 401, message: "Missing API Key" },
        code: "EMAIL_DELIVERY_CREDENTIAL",
        status: 503,
        kind: "credential",
      },
      {
        label: "하루 한도를 넘겼다",
        error: {
          name: "daily_quota_exceeded",
          statusCode: 429,
          message: "You have reached your daily email sending quota.",
        },
        code: "EMAIL_DELIVERY_RATE_LIMITED",
        status: 429,
        kind: "rate_limit",
      },
      {
        label: "받는 주소를 거절했다",
        error: {
          name: "validation_error",
          statusCode: 422,
          message: "Invalid `to` field. The email address is not valid.",
        },
        code: "EMAIL_DELIVERY_RECIPIENT_REJECTED",
        status: 400,
        kind: "recipient",
      },
      {
        label: "제공자가 흔들렸다",
        error: { name: "internal_server_error", statusCode: 500, message: "Something went wrong" },
        code: "EMAIL_DELIVERY_PROVIDER_ERROR",
        status: 502,
        kind: "provider",
      },
      {
        // SDK 소스에서 그대로 가져온 문장이다(resend 6.10.0 `fetchRequest` 의
        // 바깥 catch). 네트워크가 끊기면 SDK 는 던지지 않고 이 모양으로 **반환**
        // 하므로, 이것도 502 로 도착한다. 다시 시도해 볼 만한 쪽이어야 한다.
        label: "요청이 제공자에 닿지 못했다",
        error: {
          name: "application_error",
          statusCode: null,
          message: "Unable to fetch data. The request could not be resolved.",
        },
        code: "EMAIL_DELIVERY_PROVIDER_ERROR",
        status: 502,
        kind: "provider",
      },
    ];

    for (const testCase of CASES) {
      it(`${testCase.label} → ${testCase.code}`, async () => {
        mocks.send.mockResolvedValue({ data: null, error: testCase.error });

        const response = await signup(signupRequest());
        const payload = await response.json();

        expect(response.status).toBe(testCase.status);
        expect(payload.code).toBe(testCase.code);
        expect(String(mocks.logError.mock.calls[0]?.[0]))
          .toContain(`kind=${testCase.kind}`);
      });
    }

    it("설정이 원인이면 다시 시도하라고 말하지 않고, 잠깐이면 말한다", async () => {
      mocks.send.mockResolvedValue({
        data: null,
        error: { name: "validation_error", statusCode: 400, message: "API key is invalid" },
      });
      const config = await (await signup(signupRequest())).json();
      expect(config.error).not.toContain("잠시 후 다시 시도");

      mocks.send.mockResolvedValue({
        data: null,
        error: { name: "internal_server_error", statusCode: 500, message: "boom" },
      });
      const transient = await (await signup(signupRequest())).json();
      expect(transient.error).toContain("잠시 후 다시 시도");
    });

    it("제공자 원문과 받는 주소를 응답에 싣지 않는다", async () => {
      mocks.send.mockResolvedValue({
        data: null,
        error: {
          name: "validation_error",
          statusCode: 403,
          message: "tenant secret-detail for sample@example.test is not verified",
        },
      });

      const body = JSON.stringify(await (await signup(signupRequest())).json());

      expect(body).not.toContain("secret-detail");
      expect(body).not.toContain("sample@example.test");
    });

    it("응답이 없으면 성공으로 세지 않는다", async () => {
      // 제공자가 200 을 주고도 메시지 id 를 주지 않으면 발송된 증거가 없다.
      mocks.send.mockResolvedValue({ data: {}, error: null });

      const response = await signup(signupRequest());

      expect(response.status).toBe(502);
      expect((await response.json()).code).toBe("EMAIL_DELIVERY_PROVIDER_ERROR");
    });
  });

  describe("계정이 있는지 밖에서 알 수 없어야 한다", () => {
    it("발송이 실패하면 신규 주소와 기존 주소가 같은 응답을 받는다", async () => {
      // 예전에는 여기서 갈라졌다: 신규는 502, 기존은 "발송했습니다". 그 차이 자체가
      // 그 주소가 이 서비스에 있다는 신호였고, 동시에 거짓말이었다.
      const providerError = {
        name: "validation_error",
        statusCode: 403,
        message: "The hanbang.ai domain is not verified.",
      };
      mocks.send.mockResolvedValue({ data: null, error: providerError });

      const fresh = await signup(signupRequest());
      const freshBody = await fresh.json();

      makeEmailAlreadyRegistered();
      const existing = await signup(signupRequest());
      const existingBody = await existing.json();

      expect(existing.status).toBe(fresh.status);
      expect(existingBody).toEqual(freshBody);
    });

    it("발송이 되면 두 주소가 같은 성공 문장을 받는다", async () => {
      const fresh = await signup(signupRequest());
      const freshBody = await fresh.json();

      makeEmailAlreadyRegistered();
      const existing = await signup(signupRequest());
      const existingBody = await existing.json();

      expect(existing.status).toBe(fresh.status);
      expect(existingBody).toEqual(freshBody);
      expect(freshBody).toEqual({
        success: true,
        message: "인증 이메일을 발송했습니다.",
      });
    });
  });
});
