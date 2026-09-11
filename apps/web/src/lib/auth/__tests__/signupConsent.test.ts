import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPTY_SIGNUP_CONSENT,
  SIGNUP_CONSENT_ITEMS,
  SIGNUP_CONSENT_INTRODUCED_AT,
  SIGNUP_CONSENT_POLICY_VERSION,
  buildSignupConsentRecord,
  buildSignupConsentServerEvidence,
  buildSignupConsentSubmission,
  hasRecordedSignupConsent,
  isSignupConsentAll,
  isPreConsentAccount,
  isSignupConsentComplete,
  parseSignupConsent,
  setAllSignupConsent,
} from "@hanbang/shared";

// 웹 가입 화면에는 약관·처리방침 링크가 하나도 없었고, 모바일은 화면에서
// 필수 동의를 받아 놓고 서버로는 마케팅 동의만 보냈다. 어느 경로로 가입해도
// 필수 동의 기록이 남지 않던 상태다. 계약을 한 곳에 두는 이유가 그것이다.
describe("가입 동의 계약", () => {
  it("필수는 이용약관·처리방침·만 14세 확인 셋, 마케팅은 선택이다", () => {
    const required = SIGNUP_CONSENT_ITEMS.filter((item) => item.required);
    expect(required.map((item) => item.key)).toEqual(["terms", "privacy", "age14"]);
    expect(SIGNUP_CONSENT_ITEMS.find((item) => item.key === "marketing")?.required)
      .toBe(false);
  });

  it("문서가 있는 필수 항목에는 전문으로 가는 링크가 있다", () => {
    // `age14` 는 문서 동의가 아니라 본인 확인이라 전문이 없다. 링크를 만들어
    // 붙이면 없는 문서를 가리키게 된다.
    const DOCUMENT_ITEMS = ["terms", "privacy"] as const;
    for (const item of SIGNUP_CONSENT_ITEMS.filter((i) => DOCUMENT_ITEMS.includes(
      i.key as (typeof DOCUMENT_ITEMS)[number],
    ))) {
      expect(item.href, item.key).toBeTruthy();
    }
    expect(SIGNUP_CONSENT_ITEMS.find((i) => i.key === "age14")?.href).toBeNull();
    expect(SIGNUP_CONSENT_ITEMS.find((i) => i.key === "terms")?.href).toBe("/terms");
    expect(SIGNUP_CONSENT_ITEMS.find((i) => i.key === "privacy")?.href).toBe("/privacy");
  });

  it("마케팅만 켠 상태는 가입 조건을 채우지 못한다", () => {
    expect(isSignupConsentComplete({ ...EMPTY_SIGNUP_CONSENT, marketing: true }))
      .toBe(false);
  });

  it("필수 둘만 켜면 마케팅 없이도 가입할 수 있다", () => {
    const state = { terms: true, privacy: true, age14: true, marketing: false };
    expect(isSignupConsentComplete(state)).toBe(true);
    expect(isSignupConsentAll(state)).toBe(false);
    expect(buildSignupConsentSubmission(state)).toEqual({
      termsAgreed: true,
      privacyAgreed: true,
      ageOver14Confirmed: true,
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
      buildSignupConsentSubmission({ terms: true, privacy: false, age14: true, marketing: true }),
    ).toThrow("SIGNUP_CONSENT_REQUIRED");
  });

  it("전체 동의는 선택 항목까지 켜고 끈다", () => {
    expect(setAllSignupConsent(true)).toEqual({
      terms: true, privacy: true, age14: true, marketing: true,
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

    it("현재 동의 묶음 판본은 가장 최근 문서 수정일이다", () => {
      expect(DOCS.map(doc => lastModifiedIso(doc.path)).sort().at(-1)).toBe(SIGNUP_CONSENT_POLICY_VERSION);
    });

    for (const doc of DOCS) {
      it(`${doc.label}의 최종 수정일과 일치한다`, () => {
        const iso = lastModifiedIso(doc.path);
        expect(iso, `${doc.path} 에서 최종 수정일을 찾지 못했다`).not.toBeNull();
        expect(
          Date.parse(iso ?? ""),
          `${doc.label} 본문을 고쳤으면 SIGNUP_CONSENT_POLICY_VERSION 도 올려야 한다`,
        ).not.toBeGreaterThan(Date.parse(SIGNUP_CONSENT_POLICY_VERSION));
      });
    }
  });

  // 소셜 로그인은 Supabase 가 계정을 직접 만들어서 가입 라우트를 지나지 않는다.
  // 그 계정을 제품에 들여보내기 전에 이 판정으로 막는다.
  describe("서버 소유 app_metadata의 동의 기록", () => {
    it("사용자 편집 flags만으로는 검증된 기록으로 치지 않는다", () => {
      for (const value of [null, undefined, {}, [], { terms_agreed: true, privacy_agreed: true }]) {
        expect(hasRecordedSignupConsent(value)).toBe(false);
      }
    });
    it("과거 판본의 진짜 서버 기록도 그대로 인정한다", () => {
      const evidence = buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-08-31" }, "2026-08-31T01:00:00.000Z");
      expect(hasRecordedSignupConsent({ signup_consent: evidence })).toBe(true);
      expect(evidence.record.consent_policy_version).toBe("2026-08-31");
    });
  });

  describe("계정에 남기는 기록의 모양", () => {
    it("가입 경로와 소셜 경로가 같은 모양을 남긴다", () => {
      const submission = buildSignupConsentSubmission({
        terms: true, privacy: true, age14: true, marketing: true,
      });
      const record = buildSignupConsentRecord(submission, "2026-08-21T00:00:00.000Z");

      expect(record).toEqual({
        terms_agreed: true,
        privacy_agreed: true,
        age_over_14_confirmed: true,
        marketing_agreed: true,
        consent_policy_version: SIGNUP_CONSENT_POLICY_VERSION,
        consent_agreed_at: "2026-08-21T00:00:00.000Z",
      });
      // 만든 기록은 곧바로 "기록 있음"으로 읽혀야 한다. 두 함수가 갈라지면
      // 동의를 저장하고도 관문이 계속 막는다.
      expect(hasRecordedSignupConsent({ signup_consent: buildSignupConsentServerEvidence(submission, record.consent_agreed_at) })).toBe(true);
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
        ageOver14Confirmed: true,
        marketingAgreed: true,
        consentPolicyVersion: "1900-01-01",
      });
      expect(parsed).toBeNull();
    });
  });
});

describe("동의를 받기 시작하기 전에 만들어진 계정", () => {
  it("그 전에 만들어졌으면 기존 회원으로 본다", () => {
    // 옛 가입 화면에는 약관 항목이 아예 없었다 — 기록이 없는 게 정상이다.
    expect(isPreConsentAccount("2026-03-01T09:00:00.000Z")).toBe(true);
    expect(isPreConsentAccount("2026-08-21T23:59:59.000Z")).toBe(true);
  });

  it("그 뒤에 만들어졌으면 신규로 본다", () => {
    expect(isPreConsentAccount(SIGNUP_CONSENT_INTRODUCED_AT)).toBe(false);
    expect(isPreConsentAccount("2026-09-01T00:00:00.000Z")).toBe(false);
  });

  it("읽을 수 없는 값이면 신규 쪽으로 기운다", () => {
    // 기존 회원용 문구를 방금 가입한 사람에게 보이면 "가입할 때 동의를 안 받았다"는
    // 틀린 말이 된다. 반대 방향의 실수는 문구가 덜 친절해질 뿐이다.
    for (const bad of [null, undefined, "", "어제", "not-a-date"]) {
      expect(isPreConsentAccount(bad as string | null | undefined), String(bad)).toBe(false);
    }
  });
});

/**
 * 만 14세 미만 아동 (2026-08-28 출시 전 감사).
 *
 * 방침 전문에 "14세"·"법정대리인"·"아동" 이 한 번도 없었고, 가입 동의 항목도
 * 이용약관·개인정보·마케팅 셋뿐이라 **만 14세 미만이 가입해도 아무것도 걸러지지
 * 않았다.** 개인정보보호법 제22조의2는 만 14세 미만 아동의 개인정보를 법정대리인
 * 동의 없이 처리하지 못하게 하는데, 이 서비스에는 그 절차가 없다.
 *
 * 생년월일을 새로 수집하지 않는다 — 거르는 데 필요하지 않은 정보를 더 받는 것은
 * 최소수집 원칙에 어긋난다. 확인 항목 하나로 처리한다.
 */
describe("만 14세 이상 확인", () => {
  it("필수 항목이다", () => {
    const item = SIGNUP_CONSENT_ITEMS.find((i) => i.key === "age14");
    expect(item, "만 14세 확인 항목이 없습니다").toBeTruthy();
    expect(item?.required, "선택으로 두면 걸러지지 않는다").toBe(true);
  });

  it("빠지면 가입 요청을 만들지 않는다", () => {
    expect(() =>
      buildSignupConsentSubmission({
        terms: true, privacy: true, age14: false, marketing: false,
      }),
    ).toThrow("SIGNUP_CONSENT_REQUIRED");
  });

  it("서버가 클라이언트 판정을 믿지 않는다", () => {
    // 확인 없이 온 요청은 계정을 만들지 않는다. 화면만 고치면 앱을 거치지 않는
    // 요청이 그대로 통과한다.
    expect(
      parseSignupConsent({ termsAgreed: true, privacyAgreed: true, marketingAgreed: false }),
    ).toBeNull();
    expect(
      parseSignupConsent({
        termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: false, marketingAgreed: false,
      }),
    ).toBeNull();
    expect(
      parseSignupConsent({
        termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
      }),
    ).not.toBeNull();
  });

  it("계정 기록에 남는다", () => {
    const record = buildSignupConsentRecord(
      buildSignupConsentSubmission({
        terms: true, privacy: true, age14: true, marketing: false,
      }),
      "2026-08-28T00:00:00.000Z",
    );
    expect(record.age_over_14_confirmed).toBe(true);
  });

  it("생년월일을 새로 받지 않는다", () => {
    // 최소수집. 항목 목록에 연령·생년월일 입력이 생기면 여기서 걸린다.
    for (const item of SIGNUP_CONSENT_ITEMS) {
      expect(item.label).not.toMatch(/생년월일|생일|나이를 입력/u);
    }
  });
});
