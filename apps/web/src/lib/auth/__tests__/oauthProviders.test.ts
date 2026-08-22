// @vitest-environment node

/**
 * 2026-08-22 운영 실측:
 *
 *   kakao  -> 400  {"msg":"Unsupported provider: provider is not enabled"}
 *   google -> 302
 *   apple  -> 302
 *
 * 웹 로그인 화면은 셋을 조건 없이 렌더했고 카카오가 **첫 자리**였다. 한국
 * 사용자가 가장 먼저 손이 가는 버튼에서 "소셜 로그인 오류"를 받는다.
 *
 * 고치면서 더 위험한 실수가 하나 있다 — **잘 되는 Google·Apple 까지 숨기는 것.**
 * 그건 고치려던 문제보다 크다. 그래서 기본값을 provider 마다 다르게 뒀고,
 * 이 파일이 그 비대칭을 고정한다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NEXT_PUBLIC_KAKAO_OAUTH_ENABLED",
  "NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED",
  "NEXT_PUBLIC_APPLE_OAUTH_ENABLED",
] as const;

async function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  vi.resetModules();
  return import("../oauthProviders");
}

describe("웹 소셜 로그인 버튼 노출", () => {
  const original = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("아무것도 설정하지 않으면 카카오만 숨는다", async () => {
    // 운영의 현재 상태다. 배포하는 순간 이 동작이어야 한다.
    const m = await load({});
    expect(m.isWebOAuthProviderEnabled("kakao")).toBe(false);
    expect(m.isWebOAuthProviderEnabled("google")).toBe(true);
    expect(m.isWebOAuthProviderEnabled("apple")).toBe(true);
    expect(m.enabledWebOAuthProviders()).toEqual(["google", "apple"]);
  });

  it("잘 되는 provider 를 환경변수 부재로 숨기지 않는다", async () => {
    // 이 실수가 고치려던 문제보다 크다 — 로그인 수단이 통째로 사라진다.
    for (const value of [undefined, "", "yes", "1", "TRUE"]) {
      const m = await load({ NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: value });
      expect(m.isWebOAuthProviderEnabled("google"), `google=${value}`).toBe(true);
    }
  });

  it("카카오는 정확히 \"true\" 일 때만 보인다", async () => {
    for (const value of [undefined, "", "false", "TRUE", "yes", "1"]) {
      const m = await load({ NEXT_PUBLIC_KAKAO_OAUTH_ENABLED: value });
      expect(m.isWebOAuthProviderEnabled("kakao"), `kakao=${value}`).toBe(false);
    }
    const on = await load({ NEXT_PUBLIC_KAKAO_OAUTH_ENABLED: "true" });
    expect(on.isWebOAuthProviderEnabled("kakao")).toBe(true);
    expect(on.enabledWebOAuthProviders()).toEqual(["kakao", "google", "apple"]);
  });

  it("운영에서 꺼진 provider 는 \"false\" 로 즉시 숨길 수 있다", async () => {
    const m = await load({
      NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: "false",
      NEXT_PUBLIC_APPLE_OAUTH_ENABLED: "false",
    });
    expect(m.enabledWebOAuthProviders()).toEqual([]);
    expect(m.hasAnyWebOAuthProvider()).toBe(false);
  });

  it("하나라도 켜져 있으면 소셜 자리를 보여준다", async () => {
    const m = await load({});
    expect(m.hasAnyWebOAuthProvider()).toBe(true);
  });
});

describe("화면이 그 규칙을 실제로 쓴다", () => {
  const SCREENS = [
    "src/app/(auth)/login/page.tsx",
    "src/app/demo/login/page.tsx",
  ];

  function source(relative: string) {
    return readFileSync(resolve(process.cwd(), relative), "utf8");
  }

  // ⚠️ 여기 있던 검사는 `html.toContain('isWebOAuthProviderEnabled("kakao")')`
  // 였다. **조건을 뒤집어도(`!isWebOAuthProviderEnabled`) 통과하고, 게이트를
  // 주석으로 만들어도 통과한다.** 감사자가 뮤테이션으로 실증했다.
  // 렌더 결과를 보는 단언은 아래 describe 로 옮겼다. 여기 남기는 것은
  // 문자열로만 확인 가능한 것 — "규칙이 한 곳에 있는가" 뿐이다.
  it("규칙이 화면마다 복제되지 않고 한 곳에 있다", () => {
    for (const screen of SCREENS) {
      const html = source(screen);
      // 화면이 환경변수를 직접 읽으면 두 화면이 갈라진다.
      expect(html, `${screen} 이 환경변수를 직접 읽는다`)
        .not.toContain("NEXT_PUBLIC_KAKAO_OAUTH_ENABLED");
    }
  });
});

describe("새 환경변수가 문서에 있다", () => {
  it(".env.example 이 세 플래그를 설명한다", () => {
    // 운영자가 켜는 법을 모르면 켜진 날에도 버튼이 안 돌아온다.
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    for (const key of ENV_KEYS) {
      expect(example, `${key} 가 .env.example 에 없다`).toContain(key);
    }
    expect(example).toContain("provider is not enabled");
  });
});
