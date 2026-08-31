// @vitest-environment node

/**
 * 로그인·견적 점검 화면이 영어 원문을 사용자에게 보여주지 않는가.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * **로그인** — `signInWithPassword` 오류를 두 가지(잘못된 자격증명, 미인증 이메일)만
 * 우리말로 옮기고 나머지는 `setError(signInError.message)` 로 원문을 그대로 올렸다.
 * 연결이 끊기면 `setError(\`오류: ${msg}\`)` 가 브라우저 원문을 붙여 한국어
 * 서비스에서 **"오류: Failed to fetch"**(Safari 는 "Load failed")를 냈다.
 *
 * **견적 점검** — `res.json()` 을 `res.ok` 검사보다 **먼저** 불렀다. 서버가 JSON 이
 * 아닌 응답(500 HTML, Vercel 챌린지)을 주면 SyntaxError 의 영어 원문
 * ("Unexpected token '<' …")이 빨간 박스로 그려졌다. 이 화면은 로그인 없이 쓰는
 * 곳이라 처음 온 사람이 제품에서 보는 첫 오류 문장이 영어가 된다.
 *
 * 저장소가 이 규칙을 이미 갖고 있다 — `authErrorMessages.ts` 는 *"아는 코드만
 * 우리말로 옮기고, 모르는 값은 버린다"*. 이 두 자리만 그 규칙 밖이었다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

/** 잡은 오류의 원문을 사용자 문구로 쓰는 모양. `&&` 가 끼어도 잡는다. */
const RAW_MESSAGE_IN_STATE =
  /setError\(\s*(?:signInError|err|error|e)\.message\s*\)/u;

describe("웹 로그인", () => {
  const source = read("src/app/(auth)/login/page.tsx");

  it("Supabase 원문을 화면에 올리지 않는다", () => {
    expect(
      RAW_MESSAGE_IN_STATE.test(source),
      "오류 원문을 그대로 setError 하고 있습니다",
    ).toBe(false);
  });

  it("네트워크 실패에 브라우저 원문을 붙이지 않는다", () => {
    // `오류: ${msg}` 가 "오류: Failed to fetch" 를 만들던 자리.
    expect(source).not.toContain("setError(`오류: ${msg}`)");
  });

  it("공유 폴백 문장을 쓴다", () => {
    // 문장을 새로 지으면 콜백·모바일과 갈라진다.
    expect(source).toContain("AUTH_ERROR_FALLBACK");
    expect(source).toContain('from "@/lib/auth/authErrorMessages"');
  });

  it("원문은 콘솔에만 남긴다", () => {
    // 원인 추적은 계속 돼야 한다 — 화면에 안 올릴 뿐이다.
    expect(source).toContain('console.error("Auth error:", msg)');
  });
});

describe("견적 점검", () => {
  const source = read("src/app/(community)/community/quote-check/page.tsx");

  it("본문 파싱 실패를 화면에 올리지 않는다", () => {
    // `json()` 이 던지면 그 SyntaxError 가 사용자 문구가 된다.
    expect(source).toContain("res.json().catch(() => null)");
    expect(source).not.toContain('err instanceof Error ? err.message');
  });

  it("상태를 먼저 본다", () => {
    const parseAt = source.indexOf("res.json().catch");
    const okAt = source.indexOf("!res.ok", parseAt);
    expect(parseAt, "파싱 자리를 찾지 못했습니다").toBeGreaterThan(-1);
    expect(okAt, "상태 검사가 파싱 뒤에 없습니다").toBeGreaterThan(parseAt);
  });

  it("우리말 폴백 문장을 한 곳에서 만든다", () => {
    expect(source).toContain("const QUOTE_CHECK_ERROR");
    const uses = source.match(/QUOTE_CHECK_ERROR/gu) ?? [];
    expect(uses.length, "폴백을 쓰지 않는 갈래가 있습니다").toBeGreaterThanOrEqual(3);
  });
});
