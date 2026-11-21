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

/**
 * "아모라가 먼저 알려 주기"(10장 P1) 응답. 웹 `apps/web/src/lib/care/carePreferences.ts` 의
 * `parseCarePreferencePayload` 와 같은 규칙으로 모양을 다시 본다. 메일은 함께 대화 글을
 * 켠 사람만 켤 수 있다(2026-11-13 파운더 결정, DB 가 다시 지킨다).
 */
export type CarePreferencePayload = {
  available: boolean;
  emailAvailable: boolean;
  chat: { enabled: boolean; consentedAt: string | null };
  email: {
    enabled: boolean;
    consentedAt: string | null;
    verified: boolean;
    maskedAddress: string | null;
  };
  partner: { connected: boolean; chatEnabled: boolean };
  promptAnswered: boolean;
  cadence: CareCadence;
  couple: CoupleCareCadence;
};

/** 10장 P2: 강도와 받는 시간(한국 시각 09~20 안). 웹 carePreferences.ts 와 같은 규칙. */
export type CareIntensity = "light" | "normal" | "more";
export type CareCadence = { intensity: CareIntensity; windowStartHour: number; windowEndHour: number };
export type CoupleCareCadence = CareCadence & { dailyLimit: number; windowOpen: boolean };
export const CARE_WINDOW_MIN_HOUR = 9;
export const CARE_WINDOW_MAX_HOUR = 20;

function isCareIntensity(value: unknown): value is CareIntensity {
  return value === "light" || value === "normal" || value === "more";
}

function isWholeHour(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function formatCareHour(hour: number): string {
  if (hour === 12) return "낮 12시";
  return hour < 12 ? `오전 ${hour}시` : `오후 ${hour - 12}시`;
}

export function describeCoupleCadence(couple: CoupleCareCadence): string {
  if (!couple.windowOpen) {
    return "두 분이 고른 시간이 겹치지 않아 지금은 오지 않아요.";
  }
  const hours = `${formatCareHour(couple.windowStartHour)}부터 ${formatCareHour(couple.windowEndHour)} 전까지`;
  if (couple.intensity === "light") {
    return `두 분 설정을 합쳐 전날 확인만 하루 한 건, ${hours} 와요.`;
  }
  return `두 분 설정을 합쳐 하루 ${couple.dailyLimit === 3 ? "세" : "한"} 건까지, ${hours} 와요.`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

export function parseCarePreferencePayload(value: unknown): CarePreferencePayload | null {
  if (!isPlainRecord(value)) return null;
  const { chat, email, partner } = value;
  if (
    typeof value.available !== "boolean"
    || typeof value.emailAvailable !== "boolean"
    || typeof value.promptAnswered !== "boolean"
    || !isPlainRecord(chat)
    || !isPlainRecord(email)
    || !isPlainRecord(partner)
    || typeof chat.enabled !== "boolean"
    || !(chat.consentedAt === null || isIsoTimestamp(chat.consentedAt))
    || chat.enabled !== (chat.consentedAt !== null)
    || typeof email.enabled !== "boolean"
    || !(email.consentedAt === null || isIsoTimestamp(email.consentedAt))
    || email.enabled !== (email.consentedAt !== null)
    || (email.enabled && !chat.enabled)
    || typeof email.verified !== "boolean"
    || !(email.maskedAddress === null || (typeof email.maskedAddress === "string" && email.maskedAddress.length <= 330))
    || typeof partner.connected !== "boolean"
    || typeof partner.chatEnabled !== "boolean"
    || (partner.chatEnabled && !partner.connected)
  ) {
    return null;
  }
  const { cadence, couple } = value;
  if (
    !isPlainRecord(cadence)
    || !isCareIntensity(cadence.intensity)
    || !isWholeHour(cadence.windowStartHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR - 1)
    || !isWholeHour(cadence.windowEndHour, CARE_WINDOW_MIN_HOUR + 1, CARE_WINDOW_MAX_HOUR)
    || cadence.windowStartHour >= cadence.windowEndHour
    || !isPlainRecord(couple)
    || !isCareIntensity(couple.intensity)
    || !isWholeHour(couple.windowStartHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isWholeHour(couple.windowEndHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isWholeHour(couple.dailyLimit, 1, 3)
    || typeof couple.windowOpen !== "boolean"
  ) {
    return null;
  }
  return {
    cadence: {
      intensity: cadence.intensity,
      windowStartHour: cadence.windowStartHour,
      windowEndHour: cadence.windowEndHour,
    },
    couple: {
      intensity: couple.intensity,
      windowStartHour: couple.windowStartHour,
      windowEndHour: couple.windowEndHour,
      dailyLimit: couple.dailyLimit,
      windowOpen: couple.windowOpen,
    },
    available: value.available,
    emailAvailable: value.emailAvailable,
    chat: { enabled: chat.enabled, consentedAt: chat.consentedAt as string | null },
    email: {
      enabled: email.enabled,
      consentedAt: email.consentedAt as string | null,
      verified: email.verified,
      maskedAddress: email.maskedAddress as string | null,
    },
    partner: { connected: partner.connected, chatEnabled: partner.chatEnabled },
    promptAnswered: value.promptAnswered,
  };
}

/** 라운지에서 한 번 묻는다(2026-11-13 결정: 첫 일정이 생긴 뒤, 거절하면 다시 묻지 않음). */
export function shouldAskCareConsentInLounge(
  preference: CarePreferencePayload | null,
  plannedScheduleCount: number,
): boolean {
  return preference !== null
    && preference.available
    && !preference.chat.enabled
    && !preference.promptAnswered
    && plannedScheduleCount > 0;
}

export function careConsentPartnerLine(preference: CarePreferencePayload): string | null {
  const { chat, partner } = preference;
  if (!partner.connected) {
    return chat.enabled
      ? "혼자 쓰는 동안은 바로 와요. 상대가 연결되면 상대도 켜야 계속 와요."
      : null;
  }
  if (chat.enabled) {
    return partner.chatEnabled ? "두 분 모두 켜 두셨어요." : "상대가 켜면 그날부터 와요.";
  }
  return partner.chatEnabled ? "상대는 켜 두셨어요." : null;
}

export function careEmailDescription(preference: CarePreferencePayload): string {
  if (!preference.email.verified || !preference.email.maskedAddress) {
    return "가입 메일 확인을 마치면 켤 수 있어요.";
  }
  if (!preference.chat.enabled) {
    return "함께 대화 알림을 켜면 고를 수 있어요.";
  }
  return `가입 메일 ${preference.email.maskedAddress}으로 같은 글을 하루 한 통까지 보내요.`;
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
