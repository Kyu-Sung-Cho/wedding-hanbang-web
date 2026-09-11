// @vitest-environment node

/**
 * 메일 링크가 도착하는 자리. **동작**으로 지킨다 — 소스에 특정 문자열이 있는지
 * 보는 검사는 조건을 뒤집어도 통과한다(이 저장소에서 실제로 그랬다).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));
vi.mock("@/lib/demoSession", () => ({ clearDemoCookies: vi.fn() }));

import { GET } from "./route";
import { buildEmailConfirmUrl } from "@/lib/auth/emailConfirmLink";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CONSENTED = { terms_agreed: true, privacy_agreed: true };

function client({
  verifyError = null as { message: string } | null,
  metadata = CONSENTED as unknown,
  onboardingCompleted = true,
  user = true,
} = {}) {
  return {
    auth: {
      verifyOtp: vi.fn().mockResolvedValue({ error: verifyError }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: user ? { id: USER_ID, created_at: "2026-08-30T00:00:00.000Z", user_metadata: metadata } : null },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { onboarding_completed: onboardingCompleted },
            error: null,
          }),
        })),
      })),
    })),
  };
}

async function get(url: string) {
  const response = await GET(new Request(url));
  return new URL(response.headers.get("location") ?? "", "https://hanbang.ai");
}

/** 갓 발송된 것처럼 서명된 링크. 만료 검사가 생긴 뒤로는 이것이 정상 입력이다. */
function signedLink(
  opts: { tokenHash?: string; type?: "signup" | "recovery"; redirect?: string; nowMs?: number } = {},
) {
  return buildEmailConfirmUrl({
    siteUrl: "https://hanbang.ai",
    tokenHash: opts.tokenHash ?? "tok",
    type: opts.type ?? "signup",
    redirectPath: opts.redirect ?? null,
    nowMs: opts.nowMs,
  });
}

describe("메일 인증 라우트", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  it("token_hash 를 그대로 verifyOtp 에 넘겨 세션을 세운다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    await get(signedLink({ tokenHash: "tok_abc" }));

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "tok_abc",
    });
  });

  it("가입 인증을 마치면 오류 화면이 아니라 제품으로 보낸다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(signedLink());

    // 고치기 전의 증상이 정확히 이것이었다.
    expect(location.pathname).not.toBe("/login");
    expect(location.searchParams.get("error")).toBeNull();
    expect(location.pathname).toBe("/wedding/lounge");
  });

  it("비밀번호 재설정은 재설정 화면으로 보낸다 — 다른 관문을 태우지 않는다", async () => {
    // 계정을 되찾는 중인 사람을 동의·온보딩으로 돌리면 되찾을 길이 다시 사라진다.
    mocks.createServerClient.mockReturnValue(client({ metadata: {}, onboardingCompleted: false }));

    const location = await get(signedLink({ type: "recovery" }));

    expect(location.pathname).toBe("/reset-password");
  });

  it("동의 기록이 없는 가입자는 제품보다 동의를 먼저 본다", async () => {
    mocks.createServerClient.mockReturnValue(client({ metadata: {} }));

    const location = await get(signedLink());

    expect(location.pathname).toBe("/consent");
  });

  it("돌아갈 곳을 실었으면 그리로 데려간다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(signedLink({ redirect: "/price/wishlist" }));

    expect(location.pathname).toBe("/price/wishlist");
  });

  it("다른 출처로 데려가지 않는다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(signedLink({ redirect: "https://attacker.example/steal" }));

    expect(location.origin).toBe("https://hanbang.ai");
    expect(location.href).not.toContain("attacker.example");
  });

  it("우리가 만들지 않은 흐름은 교환조차 하지 않는다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=sms",
    );

    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });

  it("token_hash 가 없으면 교환하지 않는다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get("https://hanbang.ai/api/auth/confirm?type=signup");

    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });

  it("만료된 링크와 잘못된 링크를 구분해서 알려준다", async () => {
    // 죽은 링크를 세션 없는 브라우저에서 여는 사람이다. 재설정 링크로 본다 —
    // 가입 링크는 "이미 인증됐을 수 있다"로 따로 갈린다(별도 테스트).
    mocks.createServerClient.mockReturnValue(
      client({ verifyError: { message: "Token has expired or is invalid" }, user: false }),
    );
    const expired = await get(signedLink({ tokenHash: "t", type: "recovery" }));
    expect(expired.searchParams.get("error")).toBe("link_expired");
  });

  it("만료된 링크는 **교환하기 전에** 막는다", async () => {
    // verifyOtp 를 먼저 부르면 만료된 링크로도 세션이 서고, 그 뒤에 막아 봐야 늦다.
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const location = await get(signedLink({ type: "recovery", nowMs: twoHoursAgo }));

    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(location.searchParams.get("error")).toBe("link_expired");
  });

  it("만료 시각을 늘려 붙인 링크는 교환하지 않는다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const url = new URL(signedLink({ type: "recovery" }));
    url.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 999999));
    const location = await get(url.toString());

    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(location.searchParams.get("error")).toBe("link_invalid");
  });

  it("서명 없는 옛 링크는 새 메일을 받으라고 한다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=old&type=recovery",
    );

    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    expect(location.searchParams.get("error")).toBe("link_expired");
  });

  it("메일 스캐너의 HEAD 로는 토큰이 타지 않는다", async () => {
    // Next 는 HEAD 핸들러가 없으면 GET 으로 처리한다. 그러면 메일 서비스가
    // 링크를 훑는 것만으로 일회용 토큰이 소진돼, 정작 사용자는 죽은 링크를 받는다.
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    const { HEAD } = await import("./route");
    const response = await HEAD();

    expect(response.status).toBe(200);
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("같은 브라우저에서 두 번 열면 오류 대신 그냥 들여보낸다", async () => {
    // 뒤로가기·두 번 탭. 이미 세션이 서 있으니 오류를 보여줄 이유가 없다.
    const supabase = client({ verifyError: { message: "Token has expired or is invalid" } });
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get(signedLink());

    expect(location.searchParams.get("error")).toBeNull();
    expect(location.pathname).not.toBe("/login");
  });

  it("가입 링크가 이미 쓰였으면 '새 메일'이 아니라 '로그인'으로 안내한다", async () => {
    // 한국 모바일 메일 앱은 링크를 앱 내부 웹뷰로 먼저 열어 토큰을 태운다.
    // 사용자가 진짜 브라우저에서 다시 열면 계정은 이미 인증돼 있는데,
    // "새 메일을 받으세요"는 틀린 안내다 — 할 일은 그냥 로그인이다.
    const supabase = client({
      verifyError: { message: "Email link is invalid or has expired" },
      user: false,
    });
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get(signedLink({ type: "signup" }));

    expect(location.searchParams.get("error")).toBe("signup_link_used");
    expect(location.searchParams.get("error")).not.toBe("link_expired");
  });

  it("재설정 링크가 만료되면 그때는 새 메일이 맞다", async () => {
    // 비밀번호가 아직 안 바뀌었으므로 로그인하라고 하면 안 된다.
    const supabase = client({
      verifyError: { message: "Token has expired" },
      user: false,
    });
    mocks.createServerClient.mockReturnValue(supabase);

    const location = await get(signedLink({ type: "recovery" }));

    expect(location.searchParams.get("error")).toBe("link_expired");
  });

  it("Supabase 오류 원문을 URL 로 내보내지 않는다", async () => {
    mocks.createServerClient.mockReturnValue(
      client({
        verifyError: { message: "AuthApiError: internal db failure at users.id" },
        user: false,
      }),
    );

    const location = await get(signedLink({ tokenHash: "t", type: "recovery" }));

    expect(location.href).not.toContain("internal db failure");
    expect(location.href).not.toContain("AuthApiError");
    expect(location.searchParams.get("error")).toBe("verify_failed");
  });
});
