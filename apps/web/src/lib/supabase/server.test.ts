import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

// base64url 헬퍼는 진짜를 쓴다 — 상한 쿠키 판정이 라이브러리와 갈리면 안 된다.
vi.mock("@supabase/ssr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/ssr")>()),
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import { createClientFromRequest } from "./server";

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe("createClientFromRequest authorization precedence", () => {
  beforeEach(() => {
    mocks.createServerClient.mockReset();
    mocks.cookies.mockReset();
    mocks.createServerClient.mockReturnValue({ client: true });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
  });

  it("uses the shared case-insensitive Bearer parser", async () => {
    await createClientFromRequest(new Request("https://hanbang.example/api/favorites", {
      headers: { authorization: "bearer access.token-value" },
    }));

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global.headers.Authorization).toBe("Bearer access.token-value");
    expect(options.cookies.getAll()).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("uses an anonymous client rather than cookies for any invalid Authorization header", async () => {
    await createClientFromRequest(new Request("https://hanbang.example/api/favorites", {
      headers: {
        authorization: "Basic attacker-controlled",
        cookie: "sb-session=ambient-cookie",
      },
    }));

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
    expect(options.cookies.getAll()).toEqual([]);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("inherits the current Next cookie session when a synthetic request has no Authorization header", async () => {
    const cookieRows = [{ name: "sb-session", value: "ambient-cookie" }];
    const cookieStore = {
      getAll: vi.fn(() => cookieRows),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);

    await createClientFromRequest(new Request(
      "http://localhost/internal-admin-preview",
    ));

    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.global).toBeUndefined();
    expect(options.cookies.getAll()).toEqual(cookieRows);
  });

  /**
   * 상한 인증 쿠키를 그대로 넘기면 `auth.getUser()` 가 던지고, 그 예외가 RSC 밖으로
   * 나가 화면 전체가 「화면을 불러오지 못했어요」가 된다 (2026-09-02 운영 실측).
   * 자세한 내용은 `lib/supabase/authCookies.ts`.
   */
  it("디코딩되지 않는 인증 쿠키는 Supabase 에 넘기지 않는다", async () => {
    const cookieStore = {
      getAll: vi.fn(() => [
        { name: "sb-slrtobkksjmxgzatjyqb-auth-token", value: "base64-garbage" },
        { name: "onboarding_complete", value: "true" },
      ]),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);

    await createClientFromRequest(
      new Request("https://hanbang.example/api/community/posts"),
    );

    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([
      { name: "onboarding_complete", value: "true" },
    ]);
  });
});
