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
 *   apps/web/src/app/terms/page.tsx   최종 수정일 2026년 8월 31일
 *   apps/web/src/app/privacy/page.tsx 최종 수정일 2026년 9월 23일
 */
export const SIGNUP_CONSENT_POLICY_VERSION = "2026-09-28";

// 배포된 모바일의 가입을 유지하되, 직전 정식판을 최신판 동의로 바꾸지 않는다.
// 웨딩코드 함께 보기의 저장·공유는 가입 동의와 별도로 해당 기능에서 받는다.
const ACCEPTED_SIGNUP_CONSENT_POLICY_VERSIONS: readonly string[] = [
  SIGNUP_CONSENT_POLICY_VERSION,
  "2026-09-23",
  "2026-09-11",
];

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

export type SignupConsentKey = "terms" | "privacy" | "marketing" | "age14";

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
  {
    key: "age14",
    required: true,
    label: "만 14세 이상입니다",
    href: null,
  },
  { key: "marketing", required: false, label: "마케팅 정보 수신 동의", href: null },
];

export type SignupConsentState = Readonly<Record<SignupConsentKey, boolean>>;

export const EMPTY_SIGNUP_CONSENT: SignupConsentState = {
  terms: false,
  privacy: false,
  age14: false,
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
  return { terms: value, privacy: value, age14: value, marketing: value };
}

export type SignupConsentSubmission = Readonly<{
  termsAgreed: true;
  privacyAgreed: true;
  /** 만 14세 이상 확인. 개인정보보호법 제22조의2 — 만 14세 미만은 법정대리인
   *  동의가 있어야 하는데 이 서비스에는 그 절차가 없다. 그래서 받지 않는다. */
  ageOver14Confirmed: true;
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
    ageOver14Confirmed: true,
    marketingAgreed: state.marketing === true,
    consentPolicyVersion: SIGNUP_CONSENT_POLICY_VERSION,
  };
}

/** 계정에 남기는 동의 기록. 이 모양을 한 곳에서만 만든다. */
export type SignupConsentRecord = Readonly<{
  terms_agreed: true;
  privacy_agreed: true;
  age_over_14_confirmed: true;
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
    age_over_14_confirmed: true,
    marketing_agreed: submission.marketingAgreed,
    consent_policy_version: submission.consentPolicyVersion,
    consent_agreed_at: agreedAtIso,
  };
}

/** Auth의 서버 소유 app_metadata에 유효한 동의 증거가 있는가. user_metadata는 전달하지 않는다. */
export function hasRecordedSignupConsent(metadata: unknown): boolean {
  if (!isConsentObject(metadata) || !isConsentObject(metadata.signup_consent)) return false;
  const evidence = metadata.signup_consent;
  if (evidence.schemaVersion !== 1 || evidence.source !== "hanbang_auth_server"
    || !isConsentObject(evidence.record)) return false;
  const record = evidence.record;
  return record.terms_agreed === true && record.privacy_agreed === true
    && record.age_over_14_confirmed === true && typeof record.marketing_agreed === "boolean"
    && typeof record.consent_policy_version === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(record.consent_policy_version)
    && isConsentTimestamp(record.consent_agreed_at);
}

function isConsentObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConsentTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export type SignupConsentAccess = "server_verified" | "legacy_unverified" | "required" | "configuration_error";
export type SignupConsentUser = Readonly<{ user_metadata?: unknown; app_metadata?: unknown; created_at?: string }>;

/** Auth getUser의 서버 소유 필드만 새 증거로 인정한다. 구회원 호환은 별도 상태다. */
export function getSignupConsentAccess(user: SignupConsentUser, legacyBefore?: string, nowMs = Date.now()): SignupConsentAccess {
  if (hasRecordedSignupConsent(user.app_metadata)) return "server_verified";
  // 서버 증거가 손상된 경우 구기록으로 대체하지 않는다.
  if (isConsentObject(user.app_metadata) && Object.hasOwn(user.app_metadata, "signup_consent")) return "required";
  const legacy = user.user_metadata;
  if (!isConsentObject(legacy) || legacy.terms_agreed !== true || legacy.privacy_agreed !== true) return "required";
  if (!isConsentTimestamp(legacyBefore) || !Number.isFinite(nowMs) || Date.parse(legacyBefore) > nowMs) return "configuration_error";
  if (typeof user.created_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(user.created_at)
    || !Number.isFinite(Date.parse(user.created_at))
    || Date.parse(user.created_at) >= Date.parse(legacyBefore)) return "required";
  return "legacy_unverified";
}

export function buildSignupConsentServerEvidence(submission: SignupConsentSubmission, agreedAtIso: string) {
  if (!isConsentTimestamp(agreedAtIso)) throw new Error("SIGNUP_CONSENT_TIMESTAMP_INVALID");
  return { schemaVersion: 1, source: "hanbang_auth_server", record: buildSignupConsentRecord(submission, agreedAtIso) } as const;
}

/** 동의 기록이 없는 계정을 보내는 곳. 웹 전용 경로다. */
export const SIGNUP_CONSENT_PATH = "/consent";

/**
 * 서버가 요청 본문을 읽는 자리. 클라이언트 판정을 믿지 않고 다시 본다.
 * 필수 동의가 없으면 null 이고, 호출부는 계정을 만들지 않는다.
 */
export function parseSignupConsent(body: unknown): SignupConsentSubmission | null {
  if (!isConsentObject(body)) return null;
  const record = body;
  if (record.termsAgreed !== true || record.privacyAgreed !== true) return null;
  if (record.ageOver14Confirmed !== true) return null;
  if (typeof record.consentPolicyVersion !== "string"
    || !ACCEPTED_SIGNUP_CONSENT_POLICY_VERSIONS.includes(record.consentPolicyVersion)) return null;
  return {
    termsAgreed: true,
    privacyAgreed: true,
    ageOver14Confirmed: true,
    marketingAgreed: record.marketingAgreed === true,
    // 명시적으로 지원하는 판본만 수락하고, 실제로 제출한 판을 그대로 기록한다.
    consentPolicyVersion: record.consentPolicyVersion,
  };
}
