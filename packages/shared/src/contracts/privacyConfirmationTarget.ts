/** 확인 시점의 대상이다. 권한 증거가 아니며 서버 트랜잭션에서 다시 검증한다. */
export type PrivacyConfirmationTarget = {
  ownerId: string;
  coupleId: string;
  privacyEpoch: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readPrivacyConfirmationTarget(value: unknown): PrivacyConfirmationTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (typeof target.ownerId !== "string" || !UUID.test(target.ownerId)
    || typeof target.coupleId !== "string" || !UUID.test(target.coupleId)
    || typeof target.privacyEpoch !== "number" || !Number.isSafeInteger(target.privacyEpoch)
    || target.privacyEpoch < 1) return null;
  return { ownerId: target.ownerId.toLowerCase(), coupleId: target.coupleId.toLowerCase(), privacyEpoch: target.privacyEpoch };
}

export const PRIVACY_CONFIRMATION_CHANGED = "계정이나 커플·개인정보 설정이 바뀌었어요. 현재 화면을 다시 불러온 뒤 다시 확인해 주세요.";
