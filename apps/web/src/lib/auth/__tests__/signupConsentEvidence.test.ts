import { describe, expect, it } from "vitest";
import {
  SIGNUP_CONSENT_POLICY_VERSION,
  buildSignupConsentRecord,
  buildSignupConsentServerEvidence,
  getSignupConsentAccess,
  parseSignupConsent,
} from "@hanbang/shared";

const submission = {
  termsAgreed: true as const, privacyAgreed: true as const, ageOver14Confirmed: true as const,
  marketingAgreed: false, consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
};
const cutoff = "2026-09-10T00:00:00.000Z";
const oldUser = { created_at: "2026-08-31T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } };

describe("가입 동의의 제출 판본과 서버 소유 출처", () => {
  it("누락·임의·지원하지 않는 과거판·미래판 제출을 동의로 인정하지 않는다", () => {
    for (const consentPolicyVersion of [undefined, "", 20260923, "1900-01-01", "2026-08-22", "2026-08-31", "2026-09-12", "2026-09-24", "2999-01-01", "2026-09-11 ", `${SIGNUP_CONSENT_POLICY_VERSION} `]) {
      expect(parseSignupConsent({ ...submission, consentPolicyVersion })).toBeNull();
    }
    expect(parseSignupConsent(submission)?.consentPolicyVersion).toBe(SIGNUP_CONSENT_POLICY_VERSION);
  });

  it.each([SIGNUP_CONSENT_POLICY_VERSION, "2026-09-11"])("정식 지원판 %s는 제출한 판과 선택값을 그대로 보존한다", consentPolicyVersion => {
    expect(parseSignupConsent({ ...submission, consentPolicyVersion }))
      .toEqual({ ...submission, consentPolicyVersion });
  });

  it("직전 모바일 판본도 필수 동의와 연령 확인의 실제 true를 요구한다", () => {
    for (const field of ["termsAgreed", "privacyAgreed", "ageOver14Confirmed"]) {
      for (const value of [undefined, false, "true", 1, null]) {
        expect(parseSignupConsent({ ...submission, consentPolicyVersion: "2026-09-11", [field]: value })).toBeNull();
      }
    }
  });

  it("새 계정의 복사·조작한 user_metadata는 서버 동의가 아니다", () => {
    const evidence = buildSignupConsentServerEvidence(submission, "2026-09-10T01:00:00.000Z");
    expect(getSignupConsentAccess({
      ...oldUser, created_at: cutoff, user_metadata: { ...oldUser.user_metadata, signup_consent: evidence },
    }, cutoff)).toBe("required");
  });

  it("기존 회원 접근은 보존하지만 구기록을 서버 검증이나 최신판으로 승격하지 않는다", () => {
    const before = JSON.stringify(oldUser);
    expect(getSignupConsentAccess(oldUser, cutoff)).toBe("legacy_unverified");
    expect(JSON.stringify(oldUser)).toBe(before);
    expect(getSignupConsentAccess({ ...oldUser, user_metadata: {} }, cutoff)).toBe("required");
    expect(getSignupConsentAccess({ ...oldUser, created_at: "invalid" }, cutoff)).toBe("required");
  });

  it("미설정·잘못된 전환 시각은 legacy 허용으로 대체되지 않는다", () => {
    for (const value of [undefined, "", "어제", "2026-09-10", "2999-01-01T00:00:00.000Z"]) {
      expect(getSignupConsentAccess(oldUser, value)).toBe("configuration_error");
    }
  });

  it("서버 필드의 정확한 증거는 사용자 metadata가 바뀌어도 유지된다", () => {
    const evidence = buildSignupConsentServerEvidence(submission, "2026-09-10T01:00:00.000Z");
    expect(getSignupConsentAccess({ ...oldUser, user_metadata: {}, app_metadata: { signup_consent: evidence } }, cutoff)).toBe("server_verified");
    expect(evidence.record).toEqual(buildSignupConsentRecord(submission, "2026-09-10T01:00:00.000Z"));
    for (const bad of [null, {}, { ...evidence, schemaVersion: 2 }, { ...evidence, source: "client" }, { ...evidence, record: { ...evidence.record, age_over_14_confirmed: false } }]) {
      expect(getSignupConsentAccess({ ...oldUser, app_metadata: { signup_consent: bad } }, cutoff)).toBe("required");
    }
  });
});
