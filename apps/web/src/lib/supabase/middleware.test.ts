import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignupConsentServerEvidence, buildSignupConsentSubmission, setAllSignupConsent } from "@hanbang/shared";

const verifiedConsentMetadata = {
  signup_consent: buildSignupConsentServerEvidence(
    buildSignupConsentSubmission(setAllSignupConsent(true)),
    "2026-09-11T00:00:00.000Z",
  ),
};

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "./middleware";

describe("세션 갱신과 redirect가 함께 일어나는 요청", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.createServerClient.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { name: "동의 화면", path: "/wedding/chat?amoraSource=c.venue", user: "pending", onboarded: false, destination: "/consent" },
    { name: "온보딩", path: "/wedding/chat?amoraSource=c.venue", user: "verified", onboarded: false, destination: "/wedding/onboarding" },
    { name: "고객 로그인", path: "/wedding/chat?amoraSource=c.venue", user: "none", onboarded: false, destination: "/login" },
    { name: "관리자 로그인", path: "/admin/dashboard", user: "none", onboarded: false, destination: "/admin/login" },
    { name: "정상 통과", path: "/wedding/lounge", user: "verified", onboarded: true, destination: null },
  ])("$name 응답에도 갱신·삭제한 모든 쿠키와 속성을 보존한다", async ({ path, user, onboarded, destination }) => {
    const cookies = [
      { name: "sb-synthetic-auth-token.0", value: "new-part-0", options: { path: "/", secure: true, httpOnly: true, sameSite: "lax" as const } },
      { name: "sb-synthetic-auth-token.1", value: "new-part-1", options: { path: "/", secure: true, httpOnly: true, sameSite: "lax" as const } },
      { name: "sb-synthetic-auth-token.2", value: "", options: { path: "/", secure: true, httpOnly: true, sameSite: "lax" as const, maxAge: 0 } },
    ];
    mocks.createServerClient.mockImplementationOnce((_url, _key, options) => ({
      auth: { getUser: async () => {
        options.cookies.setAll(cookies);
        return { data: { user: user === "none" ? null : {
          id: "synthetic-user",
          app_metadata: user === "verified" ? verifiedConsentMetadata : {},
          user_metadata: {},
        } } };
      } },
    }));
    const request = new NextRequest(`https://hanbang.ai${path}`);
    if (onboarded) request.cookies.set("onboarding_complete", "true");

    const response = await updateSession(request);

    expect(response.status).toBe(destination ? 307 : 200);
    if (destination) {
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe(destination);
      if (!path.startsWith("/admin")) expect(location.searchParams.get("redirect")).toBe(path);
    } else expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toHaveLength(cookies.length);
    for (const { name, value, options } of cookies) {
      expect(request.cookies.get(name)?.value).toBe(value);
      expect(response.cookies.get(name)).toMatchObject({ name, value, ...options });
    }
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("vendor admin-preview onboarding boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    // 서버가 기록한 동의 증거가 있는 계정이 기본값이다.
    // 사용자가 수정할 수 있는 user_metadata만으로 관문을 통과시키지 않는다.
    mocks.getUser.mockReset().mockResolvedValue({
      data: {
        user: {
          id: "signed-in-user",
          user_metadata: { terms_agreed: true, privacy_agreed: true },
          app_metadata: verifiedConsentMetadata,
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

describe("`/wedding` 문은 로그인이면 라운지, 아니면 랜딩 — 진짜 307 (2026-11-22 파운더 결정 7)", () => {
  // 2026-11-21 까지 `/wedding` 은 커뮤니티 피드였다. 페이지의 redirect() 로는 루트 loading 경계 때문에
  // 200 + meta refresh 가 나가므로(로컬 dev 실측) 상태 코드부터 본다.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("로그아웃이면 유입 표식을 들고 랜딩으로 보낸다", async () => {
    const response = await updateSession(new NextRequest("https://hanbang.ai/wedding?utm_source=old-feed"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/landing?utm_source=old-feed");
  });

  it("로그인했으면 라운지로 보낸다(동의·온보딩은 라운지 주소에서 다시 건다)", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "signed-in", app_metadata: {}, user_metadata: {} } } });

    const response = await updateSession(new NextRequest("https://hanbang.ai/wedding"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/lounge");
  });

  it("체험 세션은 세션을 묻지 않고 라운지로 보낸다", async () => {
    const request = new NextRequest("https://hanbang.ai/wedding");
    request.cookies.set("demo_mode", "true");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/wedding/lounge");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("세션을 못 물어봐도 오류가 아니라 랜딩으로 보낸다", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("network down"));

    const response = await updateSession(new NextRequest("https://hanbang.ai/wedding"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/landing");
  });
});

describe("루트는 로그인 상태와 관계없이 랜딩으로 보낸다 — 진짜 307", () => {
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

  it("세션이 없으면 307로 랜딩에 보낸다", async () => {
    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/landing");
  });

  it("세션이 있어도 인증을 조회하지 않고 307로 랜딩에 보낸다", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "signed-in" } } });

    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/landing");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each(["", "https://your-project.supabase.co"])(
    "Supabase 설정이 없어도 루트는 307이다: %s",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      const response = await updateSession(new NextRequest("https://hanbang.ai/"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://hanbang.ai/landing");
      expect(mocks.createServerClient).not.toHaveBeenCalled();
    },
  );

  it("유입 표식을 목적지까지 들고 간다", async () => {
    // 루트에서 쿼리가 끊기면 어느 캠페인에서 왔는지가 랜딩 직전에 사라진다.
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/?utm_source=kakao&utm_campaign=spring"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/landing?utm_source=kakao&utm_campaign=spring",
    );
  });

  it("위조 가능한 체험 표식만으로 라운지에 보내지 않는다", async () => {
    // 루트의 공개 목적지는 체험 표식으로도 바뀌지 않는다.
    const request = new NextRequest("https://hanbang.ai/?utm_source=kakao");
    request.cookies.set("demo_mode", "true");

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/landing?utm_source=kakao",
    );
  });

  it("세션을 못 물어봐도 도메인 루트가 오류가 되지 않는다", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("network down"));

    const response = await updateSession(new NextRequest("https://hanbang.ai/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://hanbang.ai/landing");
  });

  // 2026-11-22: 커뮤니티·웨딩코드를 닫으면서 `/wedding`(커뮤니티 피드였음)과 `/wedding-code` 를 이 목록에서
  // 뺐다. `/wedding` 은 이제 로그아웃이면 랜딩으로 보내는 문이다(위 별도 묶음). 견적 확인은 새 주소다.
  it.each([
    "/landing",
    "/price",
    "/wedding/manners",
    "/wedding/quote-check",
    "/start-here",
    "/login",
  ])("루트가 보내는 곳과 랜딩이 부르는 곳은 로그아웃에게 열려 있다 — %s", async (path) => {
    // 루트가 `/landing` 으로 보내는데 그 `/landing` 이 보호 경로가 되면,
    // 처음 온 사람은 `/` → `/landing` → `/login?redirect=/landing` 으로 두 번 튕긴다.
    // 정문이 조용히 막히는 방식이고, 이걸 막는 장치가 없었다.
    //
    // 랜딩이 "로그인 없이 지금 열려 있다" 고 약속하는 경로들도 같이 본다 —
    // 그 약속은 카피가 아니라 미들웨어가 지킨다.
    //
    // `isProtectedPath` 는 `startsWith` 라, 목록에 짧은 접두사가 하나 들어오면
    // 여러 공개 경로가 한꺼번에 막힌다. 그래서 문자열 대조가 아니라 **동작**으로 본다.
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await updateSession(new NextRequest(`https://hanbang.ai${path}`));

    expect(response.status, `${path} 가 로그아웃을 튕겨낸다`).toBe(200);
    expect(response.headers.get("location"), `${path} 가 어딘가로 보낸다`).toBeNull();
  });

  it("루트 이동은 기존 쿠키를 갱신하거나 지우지 않는다", async () => {
    const request = new NextRequest("https://hanbang.ai/?utm_source=existing&tag=a&tag=b");
    request.cookies.set("sb-access-token", "existing-session");
    const before = request.cookies.getAll();

    const response = await updateSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/landing?utm_source=existing&tag=a&tag=b",
    );
    expect(request.cookies.getAll()).toEqual(before);
    expect(response.cookies.getAll()).toEqual([]);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("보호된 앱 경로에서는 갱신된 세션 쿠키를 계속 응답에 실어 보낸다", async () => {
    mocks.createServerClient.mockImplementationOnce((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
          ]);
          return { data: { user: {
            id: "signed-in",
            user_metadata: { terms_agreed: true, privacy_agreed: true },
            app_metadata: verifiedConsentMetadata,
          } } };
        },
      },
    }));

    const request = new NextRequest("https://hanbang.ai/wedding/lounge");
    request.cookies.set("onboarding_complete", "true");
    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });

  it.each([
    "/login?redirect=%2Fwedding%2Fbudget",
    "/login?mode=signup&redirect=%2Fwedding%2Fchat",
    "/consent?redirect=%2Fwedding%2Fchat%3FamoraSource%3Dc.venue",
    "/invite",
    "/api/auth/callback?code=synthetic&redirect=%2Fwedding%2Fbudget",
  ])("명시적인 로그인·동의·초대 복귀 경로를 루트로 취급하지 않는다: %s", async (destination) => {
    const response = await updateSession(new NextRequest(`https://hanbang.ai${destination}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
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

  it.each([
    "/wedding/checklist?category=venue&from=guide",
    "/wedding/chat?amoraSource=c.venue.venue_04",
    `/wedding/chat?${new URLSearchParams({ prefill: "예산 & 준비? 무엇부터 + 확인" })}`,
  ])("동의 뒤 원래 문맥 query도 보존한다: %s", async (destination) => {
    const response = await updateSession(new NextRequest(`https://hanbang.ai${destination}`));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/consent");
    expect(location.searchParams.get("redirect")).toBe(destination);
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

// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)의 새 커플 화면도 라운지와 같은 관문을 지난다.
// 서버 틀(`AuthenticatedAppShell`)도 로그인을 다시 보지만, 온보딩 관문은 여기에만 있다.
describe("새 커플 화면(준비 순서·웨딩홀 비교·편지·상담 확정)도 보호 경로다", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.getUser.mockReset();
    mocks.createServerClient.mockReset().mockReturnValue({ auth: { getUser: mocks.getUser } });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/wedding/journey",
    "/wedding/halls",
    "/wedding/halls/letter",
    "/wedding/halls/consultation",
    "/journey",
    "/halls",
  ])("로그인하지 않았으면 %s 에서 로그인으로 보낸다", async (path) => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await updateSession(new NextRequest(`https://hanbang.ai${path}`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe(path);
  });

  it("온보딩을 마치지 않았으면 웨딩홀 비교에서 온보딩으로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "synthetic-user", app_metadata: verifiedConsentMetadata, user_metadata: {} } },
    });
    const response = await updateSession(new NextRequest("https://hanbang.ai/wedding/halls"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/wedding/onboarding");
  });
});
