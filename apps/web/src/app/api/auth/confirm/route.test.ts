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
        data: { user: user ? { id: USER_ID, user_metadata: metadata } : null },
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

describe("메일 인증 라우트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("token_hash 를 그대로 verifyOtp 에 넘겨 세션을 세운다", async () => {
    const supabase = client();
    mocks.createServerClient.mockReturnValue(supabase);

    await get("https://hanbang.ai/api/auth/confirm?token_hash=tok_abc&type=signup");

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "tok_abc",
    });
  });

  it("가입 인증을 마치면 오류 화면이 아니라 제품으로 보낸다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=signup",
    );

    // 고치기 전의 증상이 정확히 이것이었다.
    expect(location.pathname).not.toBe("/login");
    expect(location.searchParams.get("error")).toBeNull();
    expect(location.pathname).toBe("/wedding/lounge");
  });

  it("비밀번호 재설정은 재설정 화면으로 보낸다 — 다른 관문을 태우지 않는다", async () => {
    // 계정을 되찾는 중인 사람을 동의·온보딩으로 돌리면 되찾을 길이 다시 사라진다.
    mocks.createServerClient.mockReturnValue(client({ metadata: {}, onboardingCompleted: false }));

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=recovery",
    );

    expect(location.pathname).toBe("/reset-password");
  });

  it("동의 기록이 없는 가입자는 제품보다 동의를 먼저 본다", async () => {
    mocks.createServerClient.mockReturnValue(client({ metadata: {} }));

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=signup",
    );

    expect(location.pathname).toBe("/consent");
  });

  it("돌아갈 곳을 실었으면 그리로 데려간다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=signup&redirect=%2Fprice%2Fwishlist",
    );

    expect(location.pathname).toBe("/price/wishlist");
  });

  it("다른 출처로 데려가지 않는다", async () => {
    mocks.createServerClient.mockReturnValue(client());

    const location = await get(
      "https://hanbang.ai/api/auth/confirm?token_hash=tok&type=signup"
        + "&redirect=https%3A%2F%2Fattacker.example%2Fsteal",
    );

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
    mocks.createServerClient.mockReturnValue(
      client({ verifyError: { message: "Token has expired or is invalid" } }),
    );
    const expired = await get("https://hanbang.ai/api/auth/confirm?token_hash=t&type=signup");
    expect(expired.searchParams.get("error")).toBe("link_expired");
  });

  it("Supabase 오류 원문을 URL 로 내보내지 않는다", async () => {
    mocks.createServerClient.mockReturnValue(
      client({ verifyError: { message: "AuthApiError: internal db failure at users.id" } }),
    );

    const location = await get("https://hanbang.ai/api/auth/confirm?token_hash=t&type=signup");

    expect(location.href).not.toContain("internal db failure");
    expect(location.href).not.toContain("AuthApiError");
    expect(location.searchParams.get("error")).toBe("verify_failed");
  });
});
