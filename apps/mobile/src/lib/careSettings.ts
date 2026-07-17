export type CareConsentSnapshot = {
  care_notifications_enabled?: unknown;
  care_notifications_consented_at?: unknown;
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

export function hasActiveCareConsent(
  profile: CareConsentSnapshot | null | undefined,
): boolean {
  return profile?.care_notifications_enabled === true
    && typeof profile.care_notifications_consented_at === "string"
    && profile.care_notifications_consented_at.trim().length > 0;
}

export function maskSignupEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;

  const normalized = email.trim();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
