// 가입 동의 — 웹과 모바일이 같은 항목을 같은 문구로 받고, 서버가 그 사실을
// 기록한다.
//
// 이 계약이 없던 동안 웹 가입 화면에는 약관·개인정보 링크가 한 개도 없었고
// (login/page.tsx 646줄에 "약관"·"개인정보"·"terms"·"privacy" 0건),
// 모바일은 화면에서 필수 동의를 받아 놓고 서버로는 마케팅 동의만 보냈다.
// 그래서 **어느 쪽 경로로 가입해도 필수 동의 기록이 남지 않았다.**
// 약관 제2조는 "본 약관에 동의하고 계정을 만든 이용자"를 회원으로 정의한다.
//
// 항목 구성(필수 2 / 선택 1)과 라벨은 모바일 구현을 정본으로 옮겼다.

/**
 * 동의를 받은 시점의 약관·처리방침 판.
 *
 * **문서를 고치면 이 값을 함께 올려야 한다.** 안 올리면 동의 기록이 사용자가
 * 실제로 본 적 없는 옛 판을 가리킨다 — 기록이 있으나 틀린 상태이고, 기록이
 * 없는 것보다 나쁘다. 실제로 2026-08-21 에 두 문서 본문을 고치고 이 값을
 * 그대로 두어 그 상태가 됐던 적이 있다.
 *
 * 현재 값의 근거:
 *   apps/web/src/app/terms/page.tsx   최종 수정일 2026년 8월 22일
 *   apps/web/src/app/privacy/page.tsx 최종 수정일 2026년 8월 22일
 */
export const SIGNUP_CONSENT_POLICY_VERSION = "2026-08-22";

/**
 * 가입 화면에서 **동의를 받기 시작한** 시각.
 *
 * 이 시각보다 먼저 만들어진 계정은 동의 기록이 없다 — 옛 가입 화면에는 약관
 * 항목이 아예 없었기 때문이다(그 화면의 소스에 "약관"이라는 글자가 0건이었다).
 * 그 사람들도 동의 관문을 한 번 지나야 하지만, **처음 온 사람이 아니다.**
 *
 * 구분이 필요한 이유는 문구다. 몇 달 써 온 사람에게 "계정은 만들어졌어요"라고
 * 말하면 방금 무슨 일이 일어난 건지 알 수 없고, 자기 계정에 문제가 생긴 것으로
 * 읽힌다(2026-08-22 파운더 지적: "뜬금없다").
 */
export const SIGNUP_CONSENT_INTRODUCED_AT = "2026-08-22T00:00:00.000Z";

/**
 * 동의를 받기 시작하기 **전에** 만들어진 계정인가.
 *
 * 파싱할 수 없는 값이면 false — 확실하지 않을 때는 신규로 보는 편이 안전하다.
 * 신규용 문구는 어느 쪽에도 거짓이 아니지만, 기존 회원용 문구를 방금 가입한
 * 사람에게 보이면 "가입할 때 동의를 안 받았다"는 틀린 말이 된다.
 */
export function isPreConsentAccount(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return created < Date.parse(SIGNUP_CONSENT_INTRODUCED_AT);
}

export type SignupConsentKey = "terms" | "privacy" | "marketing";

export type SignupConsentItem = Readonly<{
  key: SignupConsentKey;
  required: boolean;
  label: string;
  /** 전문을 볼 수 있는 곳. 선택 항목은 별도 문서가 없다. */
  href: string | null;
}>;

export const SIGNUP_CONSENT_ITEMS: readonly SignupConsentItem[] = [
  { key: "terms", required: true, label: "이용약관 동의", href: "/terms" },
  { key: "privacy", required: true, label: "개인정보 처리방침 동의", href: "/privacy" },
  { key: "marketing", required: false, label: "마케팅 정보 수신 동의", href: null },
];

export type SignupConsentState = Readonly<Record<SignupConsentKey, boolean>>;

export const EMPTY_SIGNUP_CONSENT: SignupConsentState = {
  terms: false,
  privacy: false,
  marketing: false,
};

/** 필수 항목이 모두 체크됐는가. 선택 항목은 제출을 막지 않는다. */
export function isSignupConsentComplete(state: SignupConsentState): boolean {
  return SIGNUP_CONSENT_ITEMS.every(
    (item) => !item.required || state[item.key] === true,
  );
}

/** "전체 동의"가 켜진 상태인가 — 선택 항목까지 포함해서 본다. */
export function isSignupConsentAll(state: SignupConsentState): boolean {
  return SIGNUP_CONSENT_ITEMS.every((item) => state[item.key] === true);
}

export function setAllSignupConsent(value: boolean): SignupConsentState {
  return { terms: value, privacy: value, marketing: value };
}

export type SignupConsentSubmission = Readonly<{
  termsAgreed: true;
  privacyAgreed: true;
  marketingAgreed: boolean;
  consentPolicyVersion: string;
}>;

/**
 * 요청 본문에 실을 동의 필드.
 *
 * 필수 동의가 빠진 상태로는 **던진다.** 날짜처럼 조용히 null 로 떨어뜨리면
 * 안 되는 값이다 — 동의 없이 만들어진 계정이 정확히 문제이기 때문이다.
 */
export function buildSignupConsentSubmission(
  state: SignupConsentState,
): SignupConsentSubmission {
  if (!isSignupConsentComplete(state)) {
    throw new Error("SIGNUP_CONSENT_REQUIRED");
  }
  return {
    termsAgreed: true,
    privacyAgreed: true,
    marketingAgreed: state.marketing === true,
    consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
  };
}

/** 계정에 남기는 동의 기록. 이 모양을 한 곳에서만 만든다. */
export type SignupConsentRecord = Readonly<{
  terms_agreed: true;
  privacy_agreed: true;
  marketing_agreed: boolean;
  consent_policy_version: string;
  consent_agreed_at: string;
}>;

export function buildSignupConsentRecord(
  submission: SignupConsentSubmission,
  agreedAtIso: string,
): SignupConsentRecord {
  return {
    terms_agreed: true,
    privacy_agreed: true,
    marketing_agreed: submission.marketingAgreed,
    consent_policy_version: submission.consentPolicyVersion,
    consent_agreed_at: agreedAtIso,
  };
}

/**
 * 이 계정에 필수 동의 기록이 남아 있는가.
 *
 * 이메일 가입은 /api/auth/signup 이 기록하지만, **소셜 로그인은 Supabase 가
 * 계정을 직접 만들기 때문에 아무 기록도 남지 않는다.** 로그인 탭에서 카카오·
 * Google·Apple 로 처음 들어온 사람이 정확히 그 경우다 — 동의 화면을 본 적도
 * 없고 기록도 없다. 그 계정을 제품에 들여보내기 전에 여기서 판정한다.
 *
 * 판 번호는 보지 않는다. 문서를 고칠 때마다 전원을 다시 막으면 그건 제품
 * 결정이지 이 함수가 혼자 정할 일이 아니다. 기록의 **존재**만 본다.
 */
export function hasRecordedSignupConsent(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  return record.terms_agreed === true && record.privacy_agreed === true;
}

/** 동의 기록이 없는 계정을 보내는 곳. 웹 전용 경로다. */
export const SIGNUP_CONSENT_PATH = "/consent";

/**
 * 서버가 요청 본문을 읽는 자리. 클라이언트 판정을 믿지 않고 다시 본다.
 * 필수 동의가 없으면 null 이고, 호출부는 계정을 만들지 않는다.
 */
export function parseSignupConsent(body: unknown): SignupConsentSubmission | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.termsAgreed !== true || record.privacyAgreed !== true) return null;
  return {
    termsAgreed: true,
    privacyAgreed: true,
    marketingAgreed: record.marketingAgreed === true,
    // 클라이언트가 보낸 판 번호는 신뢰하지 않는다. 서버가 아는 현재 판을 남긴다.
    consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
  };
}
