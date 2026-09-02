import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 발송 경로의 **실패 → 통과**를 한 파일에서 보여준다.
//
// CTO 독립 검증: "Consent-complete POST /api/auth/signup → 502 JSON mail error.
// App-mapped 502, not infra crash. Fix the Resend/send path (or surface real
// provider error + retryable status); prove with failing→passing path."
//
// 그래서 `resend` 를 **모킹하지 않는다.** `RESEND_BASE_URL` 로 목적지만 로컬 서버로
// 돌리고, 그 서버는 실제 Resend 처럼 **자격 문자열을 검사한다**:
//
//   Authorization 이 정확히 "Bearer re_valid_key" 가 아니면
//     → 401 {"statusCode":401,"name":"validation_error","message":"API key is invalid"}
//   맞으면 → 200 {"id": "..."}
//
// 그 401 응답 모양은 2026-09-02 에 실제 api.resend.com 에 요청해 받은 것이다.
//
// Turnstile·레이트리밋·Supabase 는 이 검사의 대상이 아니라 모킹한다. 대상은
// **자격 문자열이 제공자에 도착하는 모양과 그 결과의 응답 매핑**이다.

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  logError: vi.fn(),
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

const VALID_KEY = "re_valid_key";
const OUTAGE_KEY = "re_outage_key";
let server: Server;
const authorizations: Array<string | undefined> = [];

/** 라우트가 실제 SDK 를 쓰므로, SDK 가 목적지를 정하기 전에 서버를 세워야 한다. */
let signup: typeof import("../signup/route").POST;

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      authorizations.push(request.headers.authorization);
      // 일시 장애를 흉내내는 자격. 자격 문제(401)와 제공자 장애(5xx)를 같은
      // 경로에서 갈라 볼 수 있어야 한다.
      if (request.headers.authorization === `Bearer ${OUTAGE_KEY}`) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({
          statusCode: 500,
          name: "internal_server_error",
          message: "Something went wrong",
        }));
        return;
      }
      const ok = request.headers.authorization === `Bearer ${VALID_KEY}`;
      if (!ok) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({
          statusCode: 401,
          name: "validation_error",
          message: "API key is invalid",
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "stub-message-id" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no addr");
  // SDK 는 목적지를 모듈 로드 시 한 번만 정한다. 라우트를 그 뒤에 불러온다.
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${address.port}`;
  ({ POST: signup } = await import("../signup/route"));
});

afterAll(async () => {
  delete process.env.RESEND_BASE_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const CONSENT_COMPLETE_BODY = {
  email: "sample@example.test",
  password: "Strong1!",
  name: "샘플 사용자",
  turnstileToken: "proof",
  termsAgreed: true,
  privacyAgreed: true,
  ageOver14Confirmed: true,
};

function signupRequest() {
  return new Request("https://hanbang.ai/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CONSENT_COMPLETE_BODY),
  });
}

describe("가입 발송 경로: 실패 → 통과", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizations.length = 0;
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok_test" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { generateLink: mocks.generateLink } },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("정상 자격이면 발송되고 가입이 끝난다 (기준선)", async () => {
    vi.stubEnv("RESEND_API_KEY", VALID_KEY);

    const response = await signup(signupRequest());

    expect(authorizations).toEqual([`Bearer ${VALID_KEY}`]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "인증 이메일을 발송했습니다.",
    });
  });

  it("자격 앞에 공백이 붙으면 제공자가 거절한다 (실패 재현)", async () => {
    // 다듬지 않고 보내면 헤더가 `Bearer   re_valid_key` 가 되고, 제공자는
    // "API key is invalid" 로 거절한다. 이것이 운영 502 의 모양이다.
    const { Resend } = await import("resend");
    const dirty = `  ${VALID_KEY}`;

    const result = await new Resend(dirty).emails.send({
      from: "웨딩한방 <noreply@hanbang.ai>",
      to: "sample@example.test",
      subject: "probe",
      html: "<p>probe</p>",
    });

    expect(authorizations).toEqual([`Bearer   ${VALID_KEY}`]);
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      statusCode: 401,
      name: "validation_error",
      message: "API key is invalid",
    });
  });

  it("같은 환경값으로 라우트를 부르면 이제 발송된다 (통과)", async () => {
    // 위와 **똑같은** 지저분한 환경값이다. 라우트는 이제 다듬어서 쓴다.
    vi.stubEnv("RESEND_API_KEY", `  ${VALID_KEY}`);

    const response = await signup(signupRequest());

    expect(authorizations).toEqual([`Bearer ${VALID_KEY}`]);
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  it("정말로 거절되는 자격이면 사실대로 말하고 재시도를 권하지 않는다", async () => {
    // 다듬어도 살릴 수 없는 경우(키가 회수·회전된 경우 등). 제공자 응답은 같은
    // 401 "API key is invalid" 이지만, 이제 응답이 원인을 말한다.
    vi.stubEnv("RESEND_API_KEY", "re_revoked_key");

    const response = await signup(signupRequest());
    const payload = await response.json();

    expect(authorizations).toEqual(["Bearer re_revoked_key"]);
    // 설정 문제는 재시도로 해결되지 않는다 → 502(일시 실패)가 아니라 503.
    expect(response.status).toBe(503);
    expect(payload.code).toBe("EMAIL_DELIVERY_CREDENTIAL");
    expect(payload.error).not.toContain("잠시 후 다시 시도");
    // 제공자 원문과 받는 주소는 응답에 실리지 않는다.
    expect(JSON.stringify(payload)).not.toContain("API key is invalid");
    expect(JSON.stringify(payload)).not.toContain("sample@example.test");
    // 운영자가 볼 자리에는 원인이 남는다.
    expect(String(mocks.logError.mock.calls[0]?.[0])).toContain("kind=credential");
  });

  it("일시 장애는 재시도할 수 있는 502 로 남는다", async () => {
    // 자격 문제와 달리 이쪽은 정말로 잠시 후 될 수 있다. 두 경우를 같은 상태로
    // 뭉개면 사용자는 될 리 없는 일을 반복하거나, 될 일을 포기한다.
    vi.stubEnv("RESEND_API_KEY", OUTAGE_KEY);

    const response = await signup(signupRequest());
    const payload = await response.json();

    expect(authorizations).toEqual([`Bearer ${OUTAGE_KEY}`]);
    expect(response.status).toBe(502);
    expect(payload.code).toBe("EMAIL_DELIVERY_PROVIDER_ERROR");
    expect(payload.error).toContain("잠시 후 다시 시도");
  });
});
