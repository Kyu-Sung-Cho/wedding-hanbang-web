// @vitest-environment node

/**
 * 동의 관문이 온보딩보다 **먼저** 온다.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * 소셜 로그인은 Supabase 가 계정을 직접 만들기 때문에 동의 기록이 없다. 그 계정이
 * 다시 들어오면 미들웨어가 `onboarding_complete` 쿠키만 보고 `/wedding/onboarding`
 * 으로 돌려세웠다. 그런데 온보딩은 `(auth)` 라우트 그룹이라 동의 관문
 * (`AuthenticatedAppShell`·`(community)/layout`·`postAuthLanding`) **셋 모두의
 * 바깥**이다.
 *
 * 결과: 관문을 하나도 지나지 않은 채 온보딩을 처음부터 끝까지 채우고, 저장을
 * 누르면 `/api/onboarding` 이 `SIGNUP_CONSENT_REQUIRED` 로 400 을 낸다. 화면은 그
 * 문장을 빨간 한 줄로만 그리고 갈 곳을 알려주지 않는다. 다시 눌러도 같은 결과라
 * **첫 실행이 거기서 끝난다.**
 *
 * ## 이 검사가 지키는 것
 *
 * 순서가 계약인 자리다. 온보딩 검사보다 동의 검사가 위에 있어야 하고, 동의 화면
 * 자체는 지나가야 한다(막으면 동의할 방법이 사라진다).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "../middleware";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/supabase/middleware.ts"),
  "utf8",
);

/** 주석을 걷어낸 소스. 설명 주석이 코드로 세어지면 잘못된 초록불이 난다. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^\s*\/\/.*$/gmu, "");

describe("동의 관문 순서", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "synthetic-consent-pending-user", created_at: "2026-08-30T00:00:00.000Z", user_metadata: {} } },
    });
    mocks.createServerClient.mockReset().mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("동의 검사가 온보딩 검사보다 먼저 있다", () => {
    const consentAt = code.indexOf("hasWebSignupConsentAccess");
    const onboardingAt = code.indexOf("onboarding_complete");
    expect(consentAt, "미들웨어가 동의를 보지 않는다").toBeGreaterThan(-1);
    expect(onboardingAt, "온보딩 검사를 찾지 못했다").toBeGreaterThan(-1);
    expect(
      consentAt,
      "온보딩 검사가 먼저 돌면 동의 없는 계정이 온보딩에 갇힌다",
    ).toBeLessThan(onboardingAt);
  });

  it("동의 화면 자체는 지나보낸다", () => {
    // 막으면 동의할 방법이 사라지고 무한 루프가 된다.
    expect(code).toContain("pathname !== SIGNUP_CONSENT_PATH");
  });

  it.each([
    "/wedding/chat",
    "/wedding/chat?amoraSource=c.venue.venue_04",
    "/wedding/chat?amoraSource=g.gift-money.section-2",
    "/wedding/chat?q=%EC%8B%9D%EC%9E%A5%20%26%20%EC%98%88%EC%82%B0%3F%2B%25&mode=shared",
  ])("동의 전 가려던 경로와 쿼리를 함께 보존한다 — %s", async (destination) => {
    // 문자열 구현 대신 실제 307 응답을 본다. 쿼리는 동의 페이지에 풀리지 않고
    // redirect 안에 한 번만 중첩되어야 출처 ID와 기존 질문 초안을 잃지 않는다.
    const request = new NextRequest(`https://hanbang.ai${destination}`);
    const response = await updateSession(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://hanbang.ai");
    expect(location.pathname).toBe(SIGNUP_CONSENT_PATH);
    expect([...location.searchParams.keys()]).toEqual(["redirect"]);
    expect(location.searchParams.get("redirect")).toBe(destination);
    expect(`${request.nextUrl.pathname}${request.nextUrl.search}`).toBe(destination);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("판정을 손으로 짓지 않고 공유 계약을 쓴다", () => {
    // 여기서 `terms_agreed` 를 직접 읽으면 다른 관문과 갈라진다.
    expect(code).toContain("hasWebSignupConsentAccess(user)");
    expect(code.includes("terms_agreed")).toBe(false);
  });

  it("동의 화면 경로는 공유 상수와 같다", () => {
    // 문자열을 옮겨 적으면 관문이 없는 곳으로 보낸다.
    expect(SIGNUP_CONSENT_PATH).toBe("/consent");
    expect(code.includes('"/consent"')).toBe(false);
  });
});
