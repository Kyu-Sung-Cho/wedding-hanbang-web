// @vitest-environment node

/**
 * 링크 만료를 **우리가** 검사한다.
 *
 * 2026-08-22 파운더 지적: "한정 시간 안에 해야하게 해야지 안그럼 만료되게".
 * 그때까지 우리 코드에는 만료 검사가 한 줄도 없었고 Supabase 대시보드 설정에
 * 전적으로 기댔는데, 재설정 메일은 "24시간 동안 유효합니다"라고 **단정**하고
 * 있었다 — 참인지 아무도 확인할 수 없는 문장이었다.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMAIL_CONFIRM_TTL_SECONDS,
  buildEmailConfirmUrl,
  describeEmailConfirmTtl,
} from "../emailConfirmLink";
import {
  signEmailConfirm,
  verifyEmailConfirmSignature,
} from "../emailConfirmSignature";

const SITE = "https://hanbang.ai";
const NOW = 1_800_000_000_000; // 고정 시계 — 실제 시각에 의존하면 테스트가 썩는다.

function parse(url: string) {
  const parsed = new URL(url);
  return {
    tokenHash: parsed.searchParams.get("token_hash")!,
    type: parsed.searchParams.get("type")!,
    expiresAt: parsed.searchParams.get("exp"),
    signature: parsed.searchParams.get("sig"),
  };
}

describe("메일 인증 링크 만료", () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  });

  it("재설정 링크는 1시간, 가입 링크는 24시간", () => {
    expect(EMAIL_CONFIRM_TTL_SECONDS.recovery).toBe(3600);
    expect(EMAIL_CONFIRM_TTL_SECONDS.signup).toBe(86400);
    // 재설정 링크는 그 자체로 계정 접근 수단이라 가입 확인보다 짧아야 한다.
    expect(EMAIL_CONFIRM_TTL_SECONDS.recovery)
      .toBeLessThan(EMAIL_CONFIRM_TTL_SECONDS.signup);
  });

  it("메일 문구가 상수에서 나온다 — 하드코딩과 갈라지지 않는다", () => {
    expect(describeEmailConfirmTtl("recovery")).toBe("1시간");
    expect(describeEmailConfirmTtl("signup")).toBe("24시간");
  });

  it("링크에 만료 시각과 서명이 실린다", () => {
    const link = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    expect(link.expiresAt).toBe(String(Math.floor(NOW / 1000) + 3600));
    expect(link.signature).toBeTruthy();
  });

  it("갓 만든 링크는 통과한다", () => {
    const link = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    expect(verifyEmailConfirmSignature({ ...link, nowMs: NOW })).toBe("valid");
  });

  it("시간이 지나면 만료된다", () => {
    const link = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    // 59분 59초: 아직 살아 있다.
    expect(verifyEmailConfirmSignature({ ...link, nowMs: NOW + 3599_000 })).toBe("valid");
    // 1시간 정각: 죽는다.
    expect(verifyEmailConfirmSignature({ ...link, nowMs: NOW + 3600_000 })).toBe("expired");
    expect(verifyEmailConfirmSignature({ ...link, nowMs: NOW + 86400_000 })).toBe("expired");
  });

  it("만료 시각을 늘려 붙이면 걸린다", () => {
    const link = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    const forged = { ...link, expiresAt: String(Number(link.expiresAt) + 999_999) };
    expect(verifyEmailConfirmSignature({ ...forged, nowMs: NOW })).toBe("invalid");
  });

  it("다른 링크의 서명을 떼어 붙이면 걸린다", () => {
    // 만료 시각만 서명하면 이것이 통과한다 — 그래서 토큰과 종류를 함께 묶는다.
    const mine = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "my-token", type: "recovery", nowMs: NOW,
    }));
    const theirs = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "someone-elses-token", type: "recovery", nowMs: NOW,
    }));
    expect(verifyEmailConfirmSignature({
      ...theirs, signature: mine.signature, nowMs: NOW,
    })).toBe("invalid");
  });

  it("종류를 바꿔치기하면 걸린다 — 짧은 만료를 긴 것으로 못 바꾼다", () => {
    const recovery = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    expect(verifyEmailConfirmSignature({
      ...recovery, type: "signup", nowMs: NOW,
    })).toBe("invalid");
  });

  it("서명 없이 exp 만 붙인 링크는 통과하지 못한다", () => {
    expect(verifyEmailConfirmSignature({
      tokenHash: "tok",
      type: "recovery",
      expiresAt: String(Math.floor(NOW / 1000) + 99999),
      signature: null,
      nowMs: NOW,
    })).toBe("invalid");
  });

  it("이 기능 이전의 옛 링크는 만료로 다룬다", () => {
    // 사용자가 할 일이 같다 — 새 메일 받기.
    expect(verifyEmailConfirmSignature({
      tokenHash: "tok", type: "recovery", expiresAt: null, signature: null, nowMs: NOW,
    })).toBe("unsigned");
  });

  it("숫자가 아닌 만료 시각은 받지 않는다", () => {
    for (const bad of ["abc", "1e9", "-1", "1.5", "", " 100", "9".repeat(20)]) {
      const sig = signEmailConfirm("tok", "recovery", Number(bad) || 0);
      expect(verifyEmailConfirmSignature({
        tokenHash: "tok", type: "recovery", expiresAt: bad, signature: sig, nowMs: NOW,
      }), bad).toBe("invalid");
    }
  });

  it("서명 키가 없으면 통과시키지 않는다", () => {
    const link = parse(buildEmailConfirmUrl({
      siteUrl: SITE, tokenHash: "tok", type: "recovery", nowMs: NOW,
    }));
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // 열어 두면 서명 검사가 있으나 마나가 된다.
    expect(verifyEmailConfirmSignature({ ...link, nowMs: NOW })).toBe("invalid");
  });
});
