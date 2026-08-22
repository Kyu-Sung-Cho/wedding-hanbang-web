// @vitest-environment node

/**
 * 이 파일이 지키는 것: **메일로 나가는 링크가 Supabase 의 verify 로 가지 않는다.**
 *
 * 2026-08-22 이전에는 `generateLink` 가 준 `action_link` 를 그대로 실었다. 그
 * 링크는 결과를 `#해시`로 돌려주고, 해시는 서버로 전송되지 않는다. 그래서
 * 가입 인증 메일을 누른 사람은 전원 `/login?error=no_code` 로 떨어졌고,
 * 비밀번호 재설정 화면은 "인증 확인 중"에서 영원히 멈췄다.
 */

import { describe, expect, it } from "vitest";
import {
  EMAIL_CONFIRM_PATH,
  buildEmailConfirmUrl,
  isEmailConfirmType,
} from "../emailConfirmLink";

const SITE = "https://hanbang.ai";

describe("메일 인증 링크", () => {
  it("우리 라우트를 가리킨다 — Supabase verify 로 가지 않는다", () => {
    const url = new URL(
      buildEmailConfirmUrl({ siteUrl: SITE, tokenHash: "abc123", type: "signup" }),
    );

    expect(url.origin).toBe(SITE);
    expect(url.pathname).toBe(EMAIL_CONFIRM_PATH);
    // 이 두 줄이 회귀를 잡는다. action_link 로 되돌리면 호스트가 supabase.co 가 된다.
    expect(url.hostname).not.toContain("supabase");
    expect(url.pathname).not.toContain("/auth/v1/verify");
  });

  it("서버가 교환할 수 있도록 token_hash 와 type 을 싣는다", () => {
    const url = new URL(
      buildEmailConfirmUrl({ siteUrl: SITE, tokenHash: "tok_xyz", type: "recovery" }),
    );
    expect(url.searchParams.get("token_hash")).toBe("tok_xyz");
    expect(url.searchParams.get("type")).toBe("recovery");
  });

  it("돌아갈 곳이 있으면 싣고, 없으면 아예 붙이지 않는다", () => {
    const withPath = new URL(
      buildEmailConfirmUrl({
        siteUrl: SITE,
        tokenHash: "t",
        type: "signup",
        redirectPath: "/price/wishlist",
      }),
    );
    expect(withPath.searchParams.get("redirect")).toBe("/price/wishlist");

    const without = new URL(
      buildEmailConfirmUrl({ siteUrl: SITE, tokenHash: "t", type: "signup" }),
    );
    expect(without.searchParams.has("redirect")).toBe(false);
  });

  it("우리가 만들지 않은 흐름은 받지 않는다", () => {
    for (const ok of ["signup", "recovery", "invite", "email_change"]) {
      expect(isEmailConfirmType(ok), ok).toBe(true);
    }
    for (const no of ["sms", "phone_change", "", null, undefined, 7, {}]) {
      expect(isEmailConfirmType(no), String(no)).toBe(false);
    }
  });
});
