/**
 * 사업자 식별 정보.
 *
 * 값은 환경변수로만 받는다 — 상호·사업자등록번호는 사실이고, 코드에 박아두면
 * 바뀌었을 때 아무도 모른다. 그리고 **없는 값을 지어내면 허위 표시**가 되므로,
 * 핵심 항목(상호·사업자등록번호)이 비어 있으면 아예 렌더하지 않는다.
 * 자리만 만들어 두고 실제 값이 들어올 때 켜지는 구조다.
 *
 * 공개돼야 하는 정보라 NEXT_PUBLIC_ 접두사를 쓴다(노출이 목적이므로 유출 우려 없음).
 */

export type BusinessInfo = {
  companyName: string;
  registrationNumber: string;
  representative: string | null;
  mailOrderNumber: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

/** 이 모듈이 읽는 공개 환경변수 전체. 테스트가 리터럴 접근 여부를 이 목록으로 검사한다. */
export const BUSINESS_INFO_ENV_KEYS = [
  "NEXT_PUBLIC_BUSINESS_NAME",
  "NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER",
  "NEXT_PUBLIC_BUSINESS_REPRESENTATIVE",
  "NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NUMBER",
  "NEXT_PUBLIC_BUSINESS_ADDRESS",
  "NEXT_PUBLIC_BUSINESS_CONTACT_EMAIL",
  "NEXT_PUBLIC_BUSINESS_CONTACT_PHONE",
] as const;

/**
 * 빌드 시점에 값이 박히는 기본 env 소스.
 *
 * 개인정보처리방침 페이지는 `"use client"`다. Next는 소스에 **리터럴**로 적힌
 * `process.env.NEXT_PUBLIC_X`만 클라이언트 번들에서 값으로 치환한다.
 * 예전처럼 `process.env`를 객체째로 받아 `env[key]`로 꺼내면 브라우저에서는
 * undefined가 되어, 서버 프리렌더 HTML에는 보이던 사업자 정보가
 * 하이드레이션 직후 사라진다(값을 넣고도 안 나오는 것처럼 보이는 함정).
 */
function buildInlinedEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_BUSINESS_NAME: process.env.NEXT_PUBLIC_BUSINESS_NAME,
    NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER:
      process.env.NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER,
    NEXT_PUBLIC_BUSINESS_REPRESENTATIVE: process.env.NEXT_PUBLIC_BUSINESS_REPRESENTATIVE,
    NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NUMBER:
      process.env.NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NUMBER,
    NEXT_PUBLIC_BUSINESS_ADDRESS: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS,
    NEXT_PUBLIC_BUSINESS_CONTACT_EMAIL: process.env.NEXT_PUBLIC_BUSINESS_CONTACT_EMAIL,
    NEXT_PUBLIC_BUSINESS_CONTACT_PHONE: process.env.NEXT_PUBLIC_BUSINESS_CONTACT_PHONE,
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

export function readBusinessInfo(
  env: Record<string, string | undefined> = buildInlinedEnv(),
): BusinessInfo | null {
  const companyName = clean(env.NEXT_PUBLIC_BUSINESS_NAME);
  const registrationNumber = clean(env.NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER);
  // 이 둘이 없으면 사업자를 특정할 수 없다 — 나머지만 띄우면 오히려 오해를 만든다.
  if (!companyName || !registrationNumber) return null;

  return {
    companyName,
    registrationNumber,
    representative: clean(env.NEXT_PUBLIC_BUSINESS_REPRESENTATIVE),
    mailOrderNumber: clean(env.NEXT_PUBLIC_BUSINESS_MAIL_ORDER_NUMBER),
    address: clean(env.NEXT_PUBLIC_BUSINESS_ADDRESS),
    contactEmail: clean(env.NEXT_PUBLIC_BUSINESS_CONTACT_EMAIL),
    contactPhone: clean(env.NEXT_PUBLIC_BUSINESS_CONTACT_PHONE),
  };
}

/** 화면에 뿌릴 (라벨, 값) 목록. 비어 있는 항목은 아예 빠진다. */
export function businessInfoRows(info: BusinessInfo): Array<[string, string]> {
  return ([
    ["상호", info.companyName],
    ["대표자", info.representative],
    ["사업자등록번호", info.registrationNumber],
    ["통신판매업 신고번호", info.mailOrderNumber],
    ["사업장 주소", info.address],
    ["이메일", info.contactEmail],
    ["전화", info.contactPhone],
  ] as Array<[string, string | null]>)
    .filter((row): row is [string, string] => row[1] !== null);
}
