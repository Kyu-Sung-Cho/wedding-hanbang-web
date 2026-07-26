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

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

export function readBusinessInfo(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
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
