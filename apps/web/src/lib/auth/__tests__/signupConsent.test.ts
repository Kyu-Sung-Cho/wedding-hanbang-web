import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPTY_SIGNUP_CONSENT,
  SIGNUP_CONSENT_ITEMS,
  SIGNUP_CONSENT_POLICY_VERSION,
  buildSignupConsentRecord,
  buildSignupConsentSubmission,
  hasRecordedSignupConsent,
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

  // 소셜 로그인은 Supabase 가 계정을 직접 만들어서 가입 라우트를 지나지 않는다.
  // 그 계정을 제품에 들여보내기 전에 이 판정으로 막는다.
  describe("계정에 동의 기록이 있는가", () => {
    it("둘 다 true 일 때만 기록으로 친다", () => {
      expect(hasRecordedSignupConsent({ terms_agreed: true, privacy_agreed: true }))
        .toBe(true);
      for (const metadata of [
        {},
        { terms_agreed: true },
        { privacy_agreed: true },
        { terms_agreed: true, privacy_agreed: false },
        { marketing_agreed: true },
        // 소셜 로그인이 채워 놓는 값들만으로는 동의가 아니다.
        { name: "소셜 사용자", avatar_url: "https://example.test/a.png" },
      ]) {
        expect(hasRecordedSignupConsent(metadata), JSON.stringify(metadata)).toBe(false);
      }
    });

    it("문자열이나 숫자를 동의로 치지 않는다", () => {
      expect(hasRecordedSignupConsent({ terms_agreed: "true", privacy_agreed: "true" }))
        .toBe(false);
      expect(hasRecordedSignupConsent({ terms_agreed: 1, privacy_agreed: 1 })).toBe(false);
    });

    it("메타데이터가 없거나 이상한 모양이면 기록 없음이다", () => {
      for (const value of [null, undefined, "yes", 1, [], [{ terms_agreed: true }]]) {
        expect(hasRecordedSignupConsent(value), String(value)).toBe(false);
      }
    });

    it("판 번호가 옛것이어도 기록은 기록이다", () => {
      // 문서를 고칠 때마다 전원을 다시 막는 것은 제품 결정이지 이 함수가
      // 혼자 정할 일이 아니다.
      expect(hasRecordedSignupConsent({
        terms_agreed: true,
        privacy_agreed: true,
        consent_policy_version: "1900-01-01",
      })).toBe(true);
    });
  });

  describe("계정에 남기는 기록의 모양", () => {
    it("가입 경로와 소셜 경로가 같은 모양을 남긴다", () => {
      const submission = buildSignupConsentSubmission({
        terms: true, privacy: true, marketing: true,
      });
      const record = buildSignupConsentRecord(submission, "2026-08-21T00:00:00.000Z");

      expect(record).toEqual({
        terms_agreed: true,
        privacy_agreed: true,
        marketing_agreed: true,
        consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
        consent_agreed_at: "2026-08-21T00:00:00.000Z",
      });
      // 만든 기록은 곧바로 "기록 있음"으로 읽혀야 한다. 두 함수가 갈라지면
      // 동의를 저장하고도 관문이 계속 막는다.
      expect(hasRecordedSignupConsent(record)).toBe(true);
    });
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
