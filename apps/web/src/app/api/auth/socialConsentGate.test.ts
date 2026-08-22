// 소셜 로그인은 Supabase 가 계정을 **직접** 만든다. 그래서 로그인 탭에서
// 카카오·Google·Apple 로 처음 들어온 사람은 가입 화면을 거치지 않고, 동의
// 화면을 본 적도 기록도 없는 계정이 생긴다. 클라이언트의 `mode === "signup"`
// 게이트는 그 경로를 지나가지 못한다(기본 모드가 "login" 이다).
//
// 그래서 관문을 서버에 둔다. 이 파일은 **콜백을 실제로 실행해서** 동의 기록이
// 없는 계정이 제품 화면으로 못 가는 것을 확인한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  from: vi.fn(),
  cookieStore: {
    getAll: vi.fn(() => []),
    set: vi.fn(),
    get: vi.fn(() => undefined),
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => mocks.cookieStore,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
    },
    from: mocks.from,
  }),
}));

import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

import { GET as callback } from "./callback/route";

const ORIGIN = "https://hanbang.ai";

function profileQuery(profile: unknown) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: profile, error: null }),
      }),
    }),
  };
}

function callbackRequest(search: string) {
  return new Request(`${ORIGIN}/api/auth/callback${search}`);
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location") ?? "", ORIGIN);
}

describe("소셜 로그인 계정도 동의 없이는 제품에 못 들어간다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.from.mockImplementation(() => profileQuery({ onboarding_completed: true }));
    mocks.cookieStore.getAll.mockReturnValue([]);
    mocks.cookieStore.get.mockReturnValue(undefined);
  });

  it("동의 기록이 없으면 온보딩도 대시보드도 아닌 동의 화면으로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", user_metadata: { name: "소셜 사용자" } } },
    });

    const response = await callback(callbackRequest("?code=abc"));
    const location = locationOf(response);

    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
    expect(location.pathname).not.toContain("/wedding/");
  });

  it("온보딩을 마친 계정이라도 동의 기록이 없으면 막는다", async () => {
    // 옛 계정(동의 기록이 생기기 전에 만들어진 것)이 여기 해당한다.
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u2", user_metadata: {} } },
    });
    mocks.from.mockImplementation(() => profileQuery({ onboarding_completed: true }));

    const location = locationOf(await callback(callbackRequest("?code=abc")));
    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
  });

  it("동의를 마친 계정은 그대로 통과한다", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "u3",
          user_metadata: { terms_agreed: true, privacy_agreed: true },
        },
      },
    });

    const location = locationOf(await callback(callbackRequest("?code=abc")));
    expect(location.pathname).not.toBe(SIGNUP_CONSENT_PATH);
    expect(location.pathname).toContain("/wedding/");
  });

  it("한쪽만 동의한 기록은 동의로 치지 않는다", async () => {
    for (const metadata of [
      { terms_agreed: true },
      { privacy_agreed: true },
      { terms_agreed: true, privacy_agreed: false },
      // 문자열 "true" 를 받아주면 클라이언트 실수가 조용히 통과한다.
      { terms_agreed: "true", privacy_agreed: "true" },
      { marketing_agreed: true },
    ]) {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u4", user_metadata: metadata } } });
      const location = locationOf(await callback(callbackRequest("?code=abc")));
      expect(location.pathname, JSON.stringify(metadata)).toBe(SIGNUP_CONSENT_PATH);
    }
  });

  it("데모 로그인으로 들어온 소셜 계정도 같은 관문을 지난다", async () => {
    // /demo/login 도 진짜 signInWithOAuth 를 호출한다 — 진짜 계정이 만들어진다.
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u5", user_metadata: {} } } });

    const location = locationOf(await callback(callbackRequest("?code=abc&from=demo")));
    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
  });

  it("동의 화면으로 보낼 때 원래 가려던 곳을 들고 간다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u6", user_metadata: {} } } });
    mocks.from.mockImplementation(() => profileQuery(null));

    const location = locationOf(
      await callback(callbackRequest("?code=abc&redirect=%2Fwedding%2Fchat")),
    );
    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
    // 동의만 하고 나면 원래 가려던 곳으로 이어져야 한다.
    expect(location.searchParams.get("redirect")).toBeTruthy();
  });

  it("동의 관문이 프로필 조회보다 먼저 온다", async () => {
    // 프로필 조회가 먼저면, 조회가 실패하는 계정은 관문에 닿기도 전에
    // 다른 곳으로 새어 나간다.
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u7", user_metadata: {} } } });
    mocks.from.mockImplementation(() => {
      throw new Error("프로필 조회가 먼저 실행됐다");
    });

    const location = locationOf(await callback(callbackRequest("?code=abc")));
    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
