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
 * 요청 body의 이름/번호를 신뢰하지 않고 저장된 커플 프로필에서 예약 연락처를 결정한다.
 * 현재 사용자의 번호를 우선하며, 없으면 연결된 파트너의 유효한 번호를 사용한다.
 */
export function resolveBookingContact(
  profiles: BookingContactProfile[],
  currentUserId: string,
): ResolvedBookingContact {
  const bride = profiles.find((profile) => profile.role === "bride");
  const groom = profiles.find((profile) => profile.role === "groom");
  const currentUser = profiles.find((profile) => profile.id === currentUserId);
  const contactPhone =
    normalizedMobile(currentUser?.phone ?? null) ??
    profiles.map((profile) => normalizedMobile(profile.phone)).find(Boolean) ??
    null;

  return {
    brideName: normalizedName(bride?.name ?? null),
    groomName: normalizedName(groom?.name ?? null),
    contactPhone,
  };
}
