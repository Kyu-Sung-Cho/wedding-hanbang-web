import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  // 문서 본문을 고치고 판 번호를 그대로 두면, 동의 기록이 사용자가 본 적 없는
  // 옛 판을 가리킨다. 기록이 있으나 틀린 상태이고 없는 것보다 나쁘다.
  // 2026-08-21 에 실제로 그 상태를 만들었다가 감사에서 잡혔다.
  describe("동의 판 번호가 실제 문서와 같은 날을 가리킨다", () => {
    const DOCS = [
      { label: "이용약관", path: "src/app/terms/page.tsx" },
      { label: "개인정보 처리방침", path: "src/app/privacy/page.tsx" },
    ];

    function lastModifiedIso(path: string): string | null {
      const html = readFileSync(resolve(process.cwd(), path), "utf8");
      const match = html.match(/최종 수정일:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/u);
      if (!match) return null;
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    for (const doc of DOCS) {
      it(`${doc.label}의 최종 수정일과 일치한다`, () => {
        const iso = lastModifiedIso(doc.path);
        expect(iso, `${doc.path} 에서 최종 수정일을 찾지 못했다`).not.toBeNull();
        expect(
          iso,
          `${doc.label} 본문을 고쳤으면 SIGNUP_CONSENT_POLICY_VERSION 도 올려야 한다`,
        ).toBe(SIGNUP_CONSENT_POLICY_VERSION);
      });
    }
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
