import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignupConsentServerEvidence, buildSignupConsentSubmission, setAllSignupConsent } from "@hanbang/shared";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), single: vi.fn(), userRpc: vi.fn(),
  createAdmin: vi.fn(), serverRpc: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.userRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdmin }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: mocks.rateLimit, rateLimitKey: () => "synthetic-link" }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
import { POST } from "../route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const CODE = "WH-AAAABBBBCCCC";
const evidence = buildSignupConsentServerEvidence(
  buildSignupConsentSubmission(setAllSignupConsent(true)), "2026-09-11T00:00:00.000Z",
);
const verified = { id: USER_ID, created_at: "2026-09-11T00:00:00.000Z", user_metadata: {}, app_metadata: { signup_consent: evidence } };
const legacy = { id: USER_ID, created_at: "2026-08-30T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true }, app_metadata: {} };
const success = { success: true, joined: true, idempotent: false, couple_id: COUPLE_ID, invite_code: CODE, role: "groom", actor_user_id: USER_ID };

function request(bearer = false) {
  return new Request("https://hanbang.ai/api/couple/link", {
    method: "POST",
    headers: bearer ? { authorization: "Bearer synthetic", "content-type": "application/json" }
      : { origin: "https://hanbang.ai", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ inviteCode: CODE.toLowerCase(), actorUserId: COUPLE_ID, role: "bride" }),
  });
}

describe("커플 연결은 서버 동의 확인 뒤 인증된 본인만 연결한다", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-10T00:00:00.000Z");
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: verified }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: mocks.single }) }) });
    mocks.single.mockResolvedValue({ data: { role: "groom" }, error: null });
    mocks.serverRpc.mockResolvedValue({ data: success, error: null });
    mocks.userRpc.mockResolvedValue({ data: success, error: null });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.serverRpc });
    mocks.rateLimit.mockReturnValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["동의 없음", { ...verified, app_metadata: {} }],
    ["새 계정이 조작한 user_metadata", { ...legacy, created_at: verified.created_at }],
    ["사용자 필드에 복사한 서버 증거", { ...verified, app_metadata: {}, user_metadata: { signup_consent: evidence } }],
    ["손상된 서버 증거와 옛 플래그", { ...legacy, app_metadata: { signup_consent: null } }],
  ])("%s 요청은 profile·rate limit·연결 쓰기 전에 거절한다", async (_name, user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "SIGNUP_CONSENT_REQUIRED" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.serverRpc).not.toHaveBeenCalled();
  });

  it.each([["새 동의", verified], ["기존 가입자", legacy]])("%s는 기존 가입 정책과 정상 초대를 유지한다", async (_name, user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, coupleId: COUPLE_ID, joined: true });
    expect(mocks.serverRpc).toHaveBeenCalledExactlyOnceWith("join_couple_server", {
      p_actor_user_id: USER_ID, p_invite_code: CODE, p_role: "groom",
    });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("모바일 bearer도 같은 서버 동의 정책으로 본인 역할을 사용한다", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(mocks.serverRpc).toHaveBeenCalledExactlyOnceWith("join_couple_server", {
      p_actor_user_id: USER_ID, p_invite_code: CODE, p_role: "groom",
    });
  });

  it("전환 설정이 잘못되면 legacy를 임의로 허용하지 않는다", async () => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "");
    mocks.getUser.mockResolvedValue({ data: { user: legacy }, error: null });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("미인증 요청은 연결하지 않는다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("서버 응답의 actor가 다르면 성공으로 표시하지 않는다", async () => {
    mocks.serverRpc.mockResolvedValue({ data: { ...success, actor_user_id: COUPLE_ID }, error: null });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("같은 연결 재확인은 새 연결로 표시하지 않는다", async () => {
    mocks.serverRpc.mockResolvedValue({ data: { ...success, joined: false, idempotent: true }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, joined: false });
  });
});
