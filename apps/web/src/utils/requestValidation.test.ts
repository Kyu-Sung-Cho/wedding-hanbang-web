import { describe, expect, it } from "vitest";

import {
  cookieHeaderHasAuthCredential,
  hasPresentedAuthCredential,
} from "./requestValidation";

/**
 * 이 판정 하나가 공개 글이 본문째로 내려가느냐를 가른다.
 *
 * 참이면 커뮤니티 읽기 경로는 "자격 증명을 제시했는데 확인에 실패했다"로 보고
 * 503 이나 빈 껍데기를 준다. 거짓이면 로그아웃 방문자로 보고 공개 본문을 그린다.
 * 그래서 **무엇을 자격 증명으로 세는지**가 정확해야 한다.
 */
describe("cookieHeaderHasAuthCredential", () => {
  const REF = "slrtobkksjmxgzatjyqb";

  it("값이 있는 인증 쿠키는 자격 증명이다", () => {
    expect(
      cookieHeaderHasAuthCredential(`sb-${REF}-auth-token=base64-eyJhIjoxfQ`),
    ).toBe(true);
  });

  it("청크로 쪼개진 인증 쿠키도 자격 증명이다", () => {
    expect(
      cookieHeaderHasAuthCredential(`a=1; sb-${REF}-auth-token.0=base64-eyJ; b=2`),
    ).toBe(true);
  });

  it("빈 값은 자격 증명이 아니다", () => {
    // 로그아웃과 상한 쿠키 정리가 모두 `...auth-token=; Max-Age=0` 을 내려보내고,
    // 그 응답을 만든 요청의 downstream 은 그 빈 쿠키를 그대로 본다.
    expect(cookieHeaderHasAuthCredential(`sb-${REF}-auth-token=`)).toBe(false);
    expect(
      cookieHeaderHasAuthCredential(`a=1; b=2; sb-${REF}-auth-token=`),
    ).toBe(false);
    expect(
      cookieHeaderHasAuthCredential(`sb-${REF}-auth-token=; onboarding_complete=true`),
    ).toBe(false);
  });

  it("인증 쿠키가 아예 없으면 자격 증명이 아니다", () => {
    expect(cookieHeaderHasAuthCredential("a=1; b=2")).toBe(false);
    expect(cookieHeaderHasAuthCredential("")).toBe(false);
    expect(cookieHeaderHasAuthCredential(null)).toBe(false);
    expect(cookieHeaderHasAuthCredential(undefined)).toBe(false);
  });

  it("다른 쿠키 값 안에 이름이 들어 있어도 속지 않는다", () => {
    expect(
      cookieHeaderHasAuthCredential("note=sb-fake-auth-token=value"),
    ).toBe(false);
  });
});

describe("hasPresentedAuthCredential", () => {
  const REF = "slrtobkksjmxgzatjyqb";

  function requestWith(headers: Record<string, string>): Request {
    return new Request("https://hanbang.ai/api/community/posts", { headers });
  }

  it("Authorization 헤더는 값과 무관하게 자격 증명이다", () => {
    // 형식이 틀린 Bearer 도 "제시했다"에는 해당한다 — 조용히 익명으로 떨어뜨리지 않는다.
    expect(requestWith({ authorization: "Bearer x" })).toBeTruthy();
    expect(hasPresentedAuthCredential(requestWith({ authorization: "Bearer x" }))).toBe(true);
    expect(hasPresentedAuthCredential(requestWith({ authorization: "Basic x" }))).toBe(true);
  });

  it("빈 인증 쿠키만 든 요청은 로그아웃 방문자로 본다", () => {
    expect(
      hasPresentedAuthCredential(
        requestWith({ cookie: `sb-${REF}-auth-token=; onboarding_complete=true` }),
      ),
    ).toBe(false);
  });

  it("값이 있는 인증 쿠키를 든 요청은 자격 증명을 제시한 것이다", () => {
    expect(
      hasPresentedAuthCredential(
        requestWith({ cookie: `sb-${REF}-auth-token=base64-eyJhIjoxfQ` }),
      ),
    ).toBe(true);
  });
});
