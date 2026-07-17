export type CareConsentRecord = {
  id: string;
  care_notifications_enabled: boolean | null;
  care_notifications_consented_at: string | null;
};

export type CareAvailability = {
  outboundEnabled: boolean;
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
    emailVerified: record.emailVerified,
  };
}

export function canChangeCareConsent(
  currentlyConsented: boolean,
  availability: CareAvailability | null,
): boolean {
  return currentlyConsented || availability?.outboundEnabled === true;
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
