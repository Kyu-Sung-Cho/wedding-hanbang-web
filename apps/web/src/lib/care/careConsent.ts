export type CareConsentRecord = {
  id: string;
  care_notifications_enabled: boolean | null;
  care_notifications_consented_at: string | null;
};

export function hasUnanimousCareConsent(
  memberIds: readonly string[],
  records: readonly CareConsentRecord[],
): boolean {
  if (memberIds.length === 0) return false;
  const consented = new Set(
    records
      .filter((record) => record.care_notifications_enabled === true
        && typeof record.care_notifications_consented_at === "string"
        && record.care_notifications_consented_at.trim().length > 0)
      .map((record) => record.id),
  );
  return memberIds.every((id) => consented.has(id));
}
