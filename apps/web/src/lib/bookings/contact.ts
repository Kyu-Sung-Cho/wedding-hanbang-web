export interface BookingContactProfile {
  id: string;
  name: string | null;
  role: string | null;
  phone: string | null;
}

export interface ResolvedBookingContact {
  brideName: string;
  groomName: string;
  contactPhone: string | null;
}

const KOREAN_MOBILE_RE = /^01[016789][0-9]{7,8}$/;

function normalizedName(value: string | null): string {
  return value?.trim().slice(0, 80) ?? "";
}

function normalizedMobile(value: string | null): string | null {
  const digits = value?.replace(/[^0-9]/g, "") ?? "";
  return KOREAN_MOBILE_RE.test(digits) ? digits : null;
}

/**
 * 요청 body를 신뢰하지 않고 현재 요청자의 저장 프로필에서만 업체 제공 정보를 결정한다.
 * 파트너가 별도로 동의한 연락처 공유 장부가 생기기 전에는 파트너 PII를 대체값으로 쓰지 않는다.
 */
export function resolveBookingContact(
  profiles: BookingContactProfile[],
  currentUserId: string,
): ResolvedBookingContact {
  const currentUser = profiles.find((profile) => profile.id === currentUserId);
  const currentName = normalizedName(currentUser?.name ?? null);
  const contactPhone = normalizedMobile(currentUser?.phone ?? null);

  return {
    brideName: currentUser?.role === "bride" ? currentName : "",
    groomName: currentUser?.role === "groom" ? currentName : "",
    contactPhone,
  };
}
