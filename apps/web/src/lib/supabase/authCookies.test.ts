import { stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import {
  isReadableSupabaseCookieValue,
  unreadableSupabaseCookieNames,
  withoutUnreadableSupabaseCookies,
} from "./authCookies";

const REF = "slrtobkksjmxgzatjyqb";
const AUTH_TOKEN = `sb-${REF}-auth-token`;

function sessionCookieValue(session: Record<string, unknown>): string {
  return `base64-${stringToBase64URL(JSON.stringify(session))}`;
}

const HEALTHY_SESSION = sessionCookieValue({
  access_token: "header.payload.signature",
  refresh_token: "refresh",
  user: { id: "3ab17abf-c912-4ccb-b5ba-c9a87b5e6c43" },
});

/**
 * 이 두 값이 실제로 던진다는 것이 이 파일 전체의 전제다. 라이브러리가 언젠가
 * 안 던지게 바뀌면 필터도 필요 없어지므로, 전제부터 테스트로 붙잡는다.
 */
describe("@supabase/ssr 이 던지는 조건", () => {
  it.each([
    ["garbage", "잘린 UTF-8"],
    ["!!!!", "base64url 알파벳 밖의 글자"],
  ])("%s 는 디코딩에서 던진다 (%s)", (payload) => {
    expect(() => stringFromBase64URL(payload)).toThrow();
  });

  it("정상 세션은 던지지 않는다", () => {
    expect(() =>
      stringFromBase64URL(HEALTHY_SESSION.slice("base64-".length)),
    ).not.toThrow();
  });
});

describe("isReadableSupabaseCookieValue", () => {
  it("base64- 접두사가 없으면 건드리지 않는다", () => {
    // 접두사가 없으면 디코딩 경로 자체를 타지 않는다 — JSON 파싱 실패는
    // gotrue 가 "세션 없음"으로 삼키므로 500 이 되지 않는다.
    expect(isReadableSupabaseCookieValue("not-base64-at-all")).toBe(true);
    expect(isReadableSupabaseCookieValue("{}")).toBe(true);
  });

  it("디코딩되는 값은 읽을 수 있다고 본다", () => {
    expect(isReadableSupabaseCookieValue(HEALTHY_SESSION)).toBe(true);
    expect(isReadableSupabaseCookieValue("base64-")).toBe(true);
  });

  it("디코딩이 던지는 값만 읽을 수 없다고 본다", () => {
    expect(isReadableSupabaseCookieValue("base64-garbage")).toBe(false);
    expect(isReadableSupabaseCookieValue("base64-!!!!")).toBe(false);
  });
});

describe("withoutUnreadableSupabaseCookies", () => {
  it("살아 있는 세션 쿠키는 그대로 둔다", () => {
    const cookies = [
      { name: AUTH_TOKEN, value: HEALTHY_SESSION },
      { name: "onboarding_complete", value: "true" },
    ];

    expect(withoutUnreadableSupabaseCookies(cookies)).toEqual(cookies);
  });

  it("상한 인증 쿠키만 걷어낸다", () => {
    const result = withoutUnreadableSupabaseCookies([
      { name: AUTH_TOKEN, value: "base64-garbage" },
      { name: "onboarding_complete", value: "true" },
      { name: "demo_mode", value: "true" },
    ]);

    expect(result.map((cookie) => cookie.name)).toEqual([
      "onboarding_complete",
      "demo_mode",
    ]);
  });

  it("Supabase 가 아닌 쿠키는 base64- 로 시작해도 두고 본다", () => {
    // 우리 것이 아닌 쿠키를 지우면 남의 기능이 조용히 꺼진다.
    const cookies = [{ name: "analytics_state", value: "base64-garbage" }];

    expect(withoutUnreadableSupabaseCookies(cookies)).toEqual(cookies);
  });

  it("PKCE code verifier 는 JSON 이 아니어도 남긴다", () => {
    // 이 쿠키 값은 세션 JSON 이 아니라 평문 verifier 다. 같이 지우면 로그인이 끊긴다.
    const cookies = [
      { name: `${AUTH_TOKEN}-code-verifier`, value: "plain-verifier-string" },
    ];

    expect(withoutUnreadableSupabaseCookies(cookies)).toEqual(cookies);
  });

  describe("청크로 쪼개진 쿠키", () => {
    it("이어 붙여서 디코딩되면 조각 하나가 혼자서는 안 되더라도 남긴다", () => {
      // combineChunks 는 조각을 이어 붙인 **뒤에** 한 번 디코딩한다. 조각마다
      // 판정하면 멀쩡한 세션을 로그아웃시킨다.
      const cut = HEALTHY_SESSION.length - 3;
      const chunks = [
        { name: `${AUTH_TOKEN}.0`, value: HEALTHY_SESSION.slice(0, cut) },
        { name: `${AUTH_TOKEN}.1`, value: HEALTHY_SESSION.slice(cut) },
      ];

      expect(withoutUnreadableSupabaseCookies(chunks)).toEqual(chunks);
    });

    it("이어 붙여도 디코딩이 안 되면 같은 이름의 조각을 전부 버린다", () => {
      // 하나만 남기면 남은 조각으로 다시 이어 붙여 같은 자리에서 또 던진다.
      const names = unreadableSupabaseCookieNames([
        { name: `${AUTH_TOKEN}.0`, value: "base64-garba" },
        { name: `${AUTH_TOKEN}.1`, value: "ge" },
        { name: "onboarding_complete", value: "true" },
      ]);

      expect([...names].sort()).toEqual([`${AUTH_TOKEN}.0`, `${AUTH_TOKEN}.1`]);
    });

    it("통짜 쿠키가 있으면 그것만 보고 판정한다", () => {
      // combineChunks 는 통짜 값이 있으면 조각을 읽지 않는다. 우리도 같아야 한다.
      const result = withoutUnreadableSupabaseCookies([
        { name: AUTH_TOKEN, value: HEALTHY_SESSION },
        { name: `${AUTH_TOKEN}.0`, value: "base64-garbage" },
      ]);

      expect(result.map((cookie) => cookie.name)).toEqual([
        AUTH_TOKEN,
        `${AUTH_TOKEN}.0`,
      ]);
    });
  });
});
