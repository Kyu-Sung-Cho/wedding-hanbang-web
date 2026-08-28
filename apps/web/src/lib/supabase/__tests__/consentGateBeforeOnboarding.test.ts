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
import { describe, expect, it } from "vitest";
import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/supabase/middleware.ts"),
  "utf8",
);

/** 주석을 걷어낸 소스. 설명 주석이 코드로 세어지면 잘못된 초록불이 난다. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^\s*\/\/.*$/gmu, "");

describe("동의 관문 순서", () => {
  it("동의 검사가 온보딩 검사보다 먼저 있다", () => {
    const consentAt = code.indexOf("hasRecordedSignupConsent");
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

  it("가려던 곳을 잃지 않는다", () => {
    // 동의를 마친 사람은 처음 가려던 화면으로 돌아가야 한다.
    expect(code).toMatch(/redirect=\$\{encodeURIComponent\(pathname\)\}/u);
  });

  it("판정을 손으로 짓지 않고 공유 계약을 쓴다", () => {
    // 여기서 `terms_agreed` 를 직접 읽으면 다른 관문과 갈라진다.
    expect(code).toContain("hasRecordedSignupConsent(user.user_metadata)");
    expect(code.includes("terms_agreed")).toBe(false);
  });

  it("동의 화면 경로는 공유 상수와 같다", () => {
    // 문자열을 옮겨 적으면 관문이 없는 곳으로 보낸다.
    expect(SIGNUP_CONSENT_PATH).toBe("/consent");
    expect(code.includes('"/consent"')).toBe(false);
  });
});
