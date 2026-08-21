import { describe, expect, it } from "vitest";

import {
  EMPTY_SIGNUP_CONSENT,
  SIGNUP_CONSENT_ITEMS,
  SIGNUP_CONSENT_POLICY_VERSION,
  buildSignupConsentSubmission,
  isSignupConsentAll,
  isSignupConsentComplete,
  parseSignupConsent,
  setAllSignupConsent,
} from "@hanbang/shared";

// 웹 가입 화면에는 약관·처리방침 링크가 하나도 없었고, 모바일은 화면에서
// 필수 동의를 받아 놓고 서버로는 마케팅 동의만 보냈다. 어느 경로로 가입해도
// 필수 동의 기록이 남지 않던 상태다. 계약을 한 곳에 두는 이유가 그것이다.
describe("가입 동의 계약", () => {
  it("필수는 이용약관과 개인정보 처리방침 둘, 마케팅은 선택이다", () => {
    const required = SIGNUP_CONSENT_ITEMS.filter((item) => item.required);
    expect(required.map((item) => item.key)).toEqual(["terms", "privacy"]);
    expect(SIGNUP_CONSENT_ITEMS.find((item) => item.key === "marketing")?.required)
      .toBe(false);
  });

  it("필수 항목에는 전문으로 가는 링크가 있다", () => {
    for (const item of SIGNUP_CONSENT_ITEMS.filter((i) => i.required)) {
      expect(item.href, item.key).toBeTruthy();
    }
    expect(SIGNUP_CONSENT_ITEMS.find((i) => i.key === "terms")?.href).toBe("/terms");
    expect(SIGNUP_CONSENT_ITEMS.find((i) => i.key === "privacy")?.href).toBe("/privacy");
  });

  it("마케팅만 켠 상태는 가입 조건을 채우지 못한다", () => {
    expect(isSignupConsentComplete({ ...EMPTY_SIGNUP_CONSENT, marketing: true }))
      .toBe(false);
  });

  it("필수 둘만 켜면 마케팅 없이도 가입할 수 있다", () => {
    const state = { terms: true, privacy: true, marketing: false };
    expect(isSignupConsentComplete(state)).toBe(true);
    expect(isSignupConsentAll(state)).toBe(false);
    expect(buildSignupConsentSubmission(state)).toEqual({
      termsAgreed: true,
      privacyAgreed: true,
      marketingAgreed: false,
      consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
    });
  });

  it("필수가 하나라도 빠지면 요청을 만들지 않고 던진다", () => {
    // 조용히 null 로 떨어뜨리면 동의 없는 계정이 만들어진다.
    expect(() => buildSignupConsentSubmission(EMPTY_SIGNUP_CONSENT)).toThrow(
      "SIGNUP_CONSENT_REQUIRED",
    );
    expect(() =>
      buildSignupConsentSubmission({ terms: true, privacy: false, marketing: true }),
    ).toThrow("SIGNUP_CONSENT_REQUIRED");
  });

  it("전체 동의는 선택 항목까지 켜고 끈다", () => {
    expect(setAllSignupConsent(true)).toEqual({
      terms: true, privacy: true, marketing: true,
    });
    expect(isSignupConsentAll(setAllSignupConsent(true))).toBe(true);
    expect(setAllSignupConsent(false)).toEqual(EMPTY_SIGNUP_CONSENT);
  });

  describe("서버가 요청 본문을 읽을 때", () => {
    it("필수 동의가 없으면 null 이다", () => {
      expect(parseSignupConsent(null)).toBeNull();
      expect(parseSignupConsent({})).toBeNull();
      expect(parseSignupConsent({ termsAgreed: true })).toBeNull();
      expect(parseSignupConsent({ privacyAgreed: true })).toBeNull();
      expect(parseSignupConsent([{ termsAgreed: true, privacyAgreed: true }]))
        .toBeNull();
    });

    it("문자열 'true' 같은 값은 동의로 치지 않는다", () => {
      expect(parseSignupConsent({ termsAgreed: "true", privacyAgreed: "true" }))
        .toBeNull();
      expect(parseSignupConsent({ termsAgreed: 1, privacyAgreed: 1 })).toBeNull();
    });

    it("클라이언트가 보낸 약관 판 번호를 믿지 않는다", () => {
      const parsed = parseSignupConsent({
        termsAgreed: true,
        privacyAgreed: true,
        marketingAgreed: true,
        consentPolicyVersion: "1900-01-01",
      });
      expect(parsed?.consentPolicyVersion).toBe(SIGNUP_CONSENT_POLICY_VERSION);
      expect(parsed?.marketingAgreed).toBe(true);
    });
  });
});
