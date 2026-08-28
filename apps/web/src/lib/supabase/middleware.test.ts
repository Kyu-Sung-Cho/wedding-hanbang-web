import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "./middleware";

describe("vendor admin-preview onboarding boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    // 동의 기록이 있는 계정이 기본값이다. 없으면 미들웨어가 동의 화면으로
    // 돌려세우는 것이 맞는 동작이라(2026-08-28), 그것은 아래 별도 테스트에서 본다.
    mocks.getUser.mockReset().mockResolvedValue({
      data: {
        user: {
          id: "signed-in-user",
          user_metadata: { terms_agreed: true, privacy_agreed: true },
        },
      },
    });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/wedding/vendors?preview=1",
    "/wedding/vendors/vendor-1?preview=1",
  ])("keeps authentication but bypasses onboarding for vendor preview %s", async (path) => {
    const response = await updateSession(
      new NextRequest(`https://hanbang.ai${path}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("still redirects an ordinary vendor request when onboarding is incomplete", async () => {
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/vendors"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding/onboarding?redirect=%2Fwedding%2Fvendors",
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("still requires authentication for preview mode", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/vendors?preview=1"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?redirect=%2Fwedding%2Fvendors%3Fpreview%3D1",
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("keeps a chat handoff nested while an authenticated user finishes onboarding", async () => {
    const handoff = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";
    const response = await updateSession(
      new NextRequest(
        `https://hanbang.ai/wedding/chat?startHereHandoff=${handoff}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://hanbang.ai/wedding/onboarding?redirect=%2Fwedding%2Fchat%3FstartHereHandoff%3D${handoff}`,
    );
  });

  it("keeps a chat handoff nested while an unauthenticated user signs in", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    const handoff = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";
    const response = await updateSession(
      new NextRequest(
        `https://hanbang.ai/wedding/chat?startHereHandoff=${handoff}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://hanbang.ai/login?redirect=%2Fwedding%2Fchat%3FstartHereHandoff%3D${handoff}`,
    );
  });
});

describe("루트는 앱의 문이다 — 진짜 307", () => {
  /**
   * 이 판정은 원래 서버 컴포넌트(`app/page.tsx`)의 `redirect()`에 있었다. 브라우저에서는
   * 잘 동작했지만 응답 자체는 `200 + HTML`이었다 — 세션을 물어보는 사이 스트리밍이
   * 이미 시작돼서 리다이렉트가 클라이언트로 밀린 것이다. 크롤러에게는 리다이렉트가
   * 아니라 폴백 문서가 정답으로 보이고, 사람에게는 그 문서가 한 번 깜빡인다.
   *
   * 그래서 아래 단언은 전부 **상태 코드부터** 본다. 목적지만 맞으면 통과하는 테스트로는
   * 이 회귀를 다시 잡지 못한다.
   */
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("세션이 없으면 307로 로그인에 보낸다", async () => {
    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/login");
  });

  it("세션이 있으면 307로 라운지에 보낸다", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "signed-in" } } });

    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/lounge");
  });

  it("유입 표식을 목적지까지 들고 간다", async () => {
    // 루트에서 쿼리가 끊기면 어느 캠페인에서 온 가입인지가 로그인 직전에 사라진다.
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/?utm_source=kakao&utm_campaign=spring"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?utm_source=kakao&utm_campaign=spring",
    );
  });

  it("위조 가능한 체험 표식만으로 라운지에 보내지 않는다", async () => {
    // `demo_mode`는 위조 가능한 표식이고, 체험의 진짜 자격은 서명된 `demo_session`이다
    // (`lib/demoSession.ts`). 표식만 믿고 라운지로 보내면 **만료된 체험 쿠키를 든 사람이
    // 라운지에 갔다가 다시 로그인으로 튕기고**, 그 튕김이 클라이언트에서 일어나 UTM까지
    // 사라진다. 서명 검증이 불가능해서가 아니라 목적지를 바꾸지 않기로 한 결정이다 —
    // 자세한 이유는 `middleware.ts`의 `redirectAppDoor` 주석에 있다.
    const request = new NextRequest("https://hanbang.ai/?utm_source=kakao");
    request.cookies.set("demo_mode", "true");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/login?utm_source=kakao",
    );
  });

  it("세션을 못 물어봐도 도메인 루트가 오류가 되지 않는다", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("network down"));

    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/login");
  });

  it("갱신된 세션 쿠키를 리다이렉트에 실어 보낸다", async () => {
    // 여기서 흘리면 방금 갱신된 토큰이 사라지고, 다음 요청이 로그아웃 상태로 도착한다.
    mocks.createServerClient.mockImplementationOnce((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
          ]);
          return { data: { user: { id: "signed-in" } } };
        },
      },
    }));

    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });
});

/**
 * 동의 관문이 온보딩보다 먼저 온다 (2026-08-28).
 *
 * 소셜 로그인은 Supabase 가 계정을 직접 만들어 동의 기록이 없다. 그 계정이 다시
 * 들어오면 미들웨어가 온보딩으로 먼저 돌려세웠는데, 온보딩은 `(auth)` 그룹이라
 * 동의 관문 셋 모두의 바깥이다. 그래서 온보딩을 다 채우고 저장에서 400 을 맞은 뒤
 * **갈 곳이 없었다.**
 */
describe("동의 기록이 없는 계정", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "social-user", user_metadata: {} } },
    });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/wedding/onboarding",
    "/wedding/lounge",
    "/wedding/chat",
  ])("%s 에서 동의 화면으로 보낸다", async (path) => {
    const response = await updateSession(new NextRequest(`https://hanbang.ai${path}`));
    const location = response.headers.get("location");
    expect(location, "동의 화면으로 보내지 않았습니다").toContain("/consent");
  });

  it("가려던 곳을 redirect 로 넘긴다", async () => {
    // 동의를 마친 사람은 처음 가려던 화면으로 돌아가야 한다.
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/chat"),
    );
    expect(response.headers.get("location")).toContain(
      `redirect=${encodeURIComponent("/wedding/chat")}`,
    );
  });

  it("한쪽만 동의한 기록은 동의로 치지 않는다", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "half", user_metadata: { terms_agreed: true } } },
    });
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/lounge"),
    );
    expect(response.headers.get("location")).toContain("/consent");
  });
});
