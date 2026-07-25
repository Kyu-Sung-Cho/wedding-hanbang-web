export type CareConsentRecord = {
  id: string;
  care_notifications_enabled: boolean | null;
  care_notifications_consented_at: string | null;
};

export type CareAvailability = {
  /** 이메일 등 앱 밖으로 나가는 발송 채널 */
  outboundEnabled: boolean;
  /** 앱 안에서 아모라가 먼저 말을 거는 채널 (이메일과 독립 스위치) */
  proactiveChatEnabled?: boolean;
  emailVerified: boolean;
};

export function parseCareAvailability(value: unknown): CareAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.outboundEnabled !== "boolean" ||
    typeof record.emailVerified !== "boolean"
  ) {
    return null;
  }
  return {
    outboundEnabled: record.outboundEnabled,
    proactiveChatEnabled: record.proactiveChatEnabled === true,
    emailVerified: record.emailVerified,
  };
}

/** 켜져 있는 케어 채널이 하나라도 있는가 (인앱·이메일은 독립) */
export function careChannelsAvailable(availability: CareAvailability | null): boolean {
  return availability?.outboundEnabled === true || availability?.proactiveChatEnabled === true;
}

export function canChangeCareConsent(
  currentlyConsented: boolean,
  availability: CareAvailability | null,
): boolean {
  // 인앱 선제 대화만 켜진 상태에서도 동의할 수 있어야 한다.
  // (이메일 스위치에만 묶으면 인앱 케어를 켤 방법이 사라진다.)
  return currentlyConsented || careChannelsAvailable(availability);
}

export function hasCareConsent(
  record: Pick<CareConsentRecord, "care_notifications_enabled" | "care_notifications_consented_at">,
): boolean {
  return record.care_notifications_enabled === true
    && typeof record.care_notifications_consented_at === "string"
    && record.care_notifications_consented_at.trim().length > 0;
}

export function hasSameCareMemberRoster(
  expectedMemberIds: readonly string[],
  currentMemberIds: readonly string[],
): boolean {
  const expected = new Set(expectedMemberIds);
  const current = new Set(currentMemberIds);
  if (
    expected.size === 0
    || expected.size !== expectedMemberIds.length
    || current.size !== currentMemberIds.length
    || expected.size !== current.size
  ) {
    return false;
  }
  return [...expected].every((id) => current.has(id));
}

export function hasUnanimousCareConsent(
  memberIds: readonly string[],
  records: readonly CareConsentRecord[],
): boolean {
  if (memberIds.length === 0) return false;
  const consented = new Set(
    records
      .filter(hasCareConsent)
      .map((record) => record.id),
  );
  return memberIds.every((id) => consented.has(id));
}
