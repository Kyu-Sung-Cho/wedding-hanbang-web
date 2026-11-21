import { isAmoraProactiveChatEnabled } from "@/lib/features/amoraCareFlags";
import { readCareUnsubscribeSecret } from "@/lib/care/careUnsubscribe";

/**
 * "아모라가 먼저 알려 주기" 설정의 서버·클라이언트 공용 계약.
 *
 * 2026-11-13 파운더 결정: 함께 대화에 먼저 남기는 글과 같은 글의 메일을 따로 묻는다.
 * 메일은 함께 대화 글을 켠 사람만 켤 수 있고, 함께 대화 글을 끄면 메일도 같이 꺼진다
 * (DB `20261120100000_amora_care_email_consent.sql` 이 같은 규칙을 다시 지킨다).
 */

export type CareChannels = {
  /** 함께 대화에 먼저 글을 남기는 경로가 지금 돌 수 있는가 */
  chat: boolean;
  /** 같은 글을 메일로 보내는 경로가 지금 돌 수 있는가 */
  email: boolean;
};

export type CareIntensity = "light" | "normal" | "more";

/** 10장 P2: 사람마다 고르는 강도와 받는 시간(한국 시각, 09~20 안에서만 좁힐 수 있다). */
export type CareCadence = {
  intensity: CareIntensity;
  windowStartHour: number;
  windowEndHour: number;
};

/** 두 사람 설정을 합친 값. DB `amora_care_couple_cadence` 가 정본이다. */
export type CoupleCareCadence = CareCadence & {
  dailyLimit: number;
  windowOpen: boolean;
};

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

export type CarePreferenceUpdate = {
  chat?: boolean;
  email?: boolean;
  promptAnswered?: true;
  intensity?: CareIntensity;
  windowStartHour?: number;
  windowEndHour?: number;
};

export const CARE_WINDOW_MIN_HOUR = 9;
export const CARE_WINDOW_MAX_HOUR = 20;
export const DEFAULT_CARE_CADENCE: CareCadence = {
  intensity: "normal",
  windowStartHour: CARE_WINDOW_MIN_HOUR,
  windowEndHour: CARE_WINDOW_MAX_HOUR,
};
const INTENSITIES: readonly CareIntensity[] = ["light", "normal", "more"];

function isIntensity(value: unknown): value is CareIntensity {
  return typeof value === "string" && (INTENSITIES as readonly string[]).includes(value);
}

function isHour(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isCadence(value: unknown): value is CareCadence {
  if (!isRecord(value)) return false;
  return isIntensity(value.intensity)
    && isHour(value.windowStartHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR - 1)
    && isHour(value.windowEndHour, CARE_WINDOW_MIN_HOUR + 1, CARE_WINDOW_MAX_HOUR)
    && value.windowStartHour < value.windowEndHour;
}

/** 한 사람의 행에서 읽는다. 값이 틀어져 있으면 기본값으로 둔다(DB CHECK 가 막지만 한 번 더). */
export function readCareCadence(row: Record<string, unknown> | null | undefined): CareCadence {
  const candidate = {
    intensity: row?.care_intensity,
    windowStartHour: row?.care_window_start_hour,
    windowEndHour: row?.care_window_end_hour,
  };
  return isCadence(candidate) ? candidate : DEFAULT_CARE_CADENCE;
}

/** DB `amora_care_couple_cadence` 의 응답을 읽는다. 모양이 틀리면 null. */
export function readCoupleCareCadence(value: unknown): CoupleCareCadence | null {
  if (!isRecord(value)) return null;
  const intensity = value.intensity;
  const start = value.window_start_hour;
  const end = value.window_end_hour;
  const limit = value.daily_limit;
  if (
    !isIntensity(intensity)
    || !isHour(start, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isHour(end, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isHour(limit, 1, 3)
    || typeof value.window_open !== "boolean"
  ) {
    return null;
  }
  return {
    intensity,
    windowStartHour: start,
    windowEndHour: end,
    dailyLimit: limit,
    windowOpen: value.window_open,
  };
}

export function soloCoupleCadence(cadence: CareCadence): CoupleCareCadence {
  return {
    ...cadence,
    dailyLimit: cadence.intensity === "more" ? 3 : 1,
    windowOpen: cadence.windowStartHour < cadence.windowEndHour,
  };
}

type EnvLike = Record<string, string | undefined>;

/**
 * 예약 경로 케어(`/api/cron/care-moments`)는 메일 발송기 없이는 통째로 멈춘다
 * (route.ts 가 503 을 낸다). 그래서 발송 스위치와 발송기 키가 둘 다 있어야
 * 그 경로를 "돌 수 있다"고 본다. 화면 열 때 경로는 따로 켤 수 있다.
 */
export function readCareChannels(env: EnvLike = process.env): CareChannels {
  // 10장 P2.7: 수신 거부 링크를 만들 비밀값이 없으면 예약 경로가 503 으로 멈춘다.
  const scheduledCareRunnable = env.AMORA_CARE_OUTBOUND_ENABLED === "true"
    && typeof env.RESEND_API_KEY === "string"
    && env.RESEND_API_KEY.trim().length > 0
    && readCareUnsubscribeSecret(env) !== null;
  return {
    chat: scheduledCareRunnable || isAmoraProactiveChatEnabled(),
    email: scheduledCareRunnable,
  };
}

export function maskSignupEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function consentedAt(enabled: unknown, at: unknown): string | null {
  return enabled === true && isIsoTimestamp(at) ? at : null;
}

export type CareConsentRow = {
  care_notifications_enabled?: unknown;
  care_notifications_consented_at?: unknown;
  care_email_enabled?: unknown;
  care_email_consented_at?: unknown;
  care_prompt_answered_at?: unknown;
};

export function buildCarePreferencePayload(input: {
  channels: CareChannels;
  own: CareConsentRow;
  partner: CareConsentRow | null;
  emailConfirmed: boolean;
  email: string | null | undefined;
  cadence?: CareCadence;
  couple?: CoupleCareCadence;
}): CarePreferencePayload {
  const cadence = input.cadence ?? DEFAULT_CARE_CADENCE;
  const chatAt = consentedAt(
    input.own.care_notifications_enabled,
    input.own.care_notifications_consented_at,
  );
  const emailAt = chatAt
    ? consentedAt(input.own.care_email_enabled, input.own.care_email_consented_at)
    : null;
  return {
    available: input.channels.chat,
    emailAvailable: input.channels.chat && input.channels.email,
    chat: { enabled: chatAt !== null, consentedAt: chatAt },
    email: {
      enabled: emailAt !== null,
      consentedAt: emailAt,
      verified: input.emailConfirmed,
      maskedAddress: input.emailConfirmed ? maskSignupEmail(input.email) : null,
    },
    partner: {
      connected: input.partner !== null,
      chatEnabled: input.partner !== null && consentedAt(
        input.partner.care_notifications_enabled,
        input.partner.care_notifications_consented_at,
      ) !== null,
    },
    promptAnswered: isIsoTimestamp(input.own.care_prompt_answered_at),
    cadence,
    couple: input.couple ?? soloCoupleCadence(cadence),
  };
}

const CONSENT_KEYS = new Set(["chat", "email", "promptAnswered"]);
const CADENCE_KEYS = new Set(["intensity", "windowStartHour", "windowEndHour"]);
const UPDATE_KEYS = new Set([...CONSENT_KEYS, ...CADENCE_KEYS]);

export function isCadenceUpdate(update: CarePreferenceUpdate): boolean {
  return Object.keys(update).some((key) => CADENCE_KEYS.has(key));
}

export function parseCarePreferenceUpdate(value: unknown): CarePreferenceUpdate | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !UPDATE_KEYS.has(key))) return null;
  const update: CarePreferenceUpdate = {};
  if ("chat" in value) {
    if (typeof value.chat !== "boolean") return null;
    update.chat = value.chat;
  }
  if ("email" in value) {
    if (typeof value.email !== "boolean") return null;
    update.email = value.email;
  }
  if ("promptAnswered" in value) {
    if (value.promptAnswered !== true) return null;
    update.promptAnswered = true;
  }
  // 메일을 켜면서 함께 대화 글을 끄라는 요청은 모순이라 어느 쪽으로도 풀지 않는다.
  if (update.email === true && update.chat === false) return null;

  // 강도·시간은 동의와 다른 저장 함수로 간다. 한 요청에 섞이면 둘 중 하나만 저장될 수
  // 있으므로 받지 않는다.
  const hasCadence = keys.some((key) => CADENCE_KEYS.has(key));
  if (hasCadence && keys.some((key) => CONSENT_KEYS.has(key))) return null;
  if ("intensity" in value) {
    if (!isIntensity(value.intensity)) return null;
    update.intensity = value.intensity;
  }
  if ("windowStartHour" in value) {
    if (!isHour(value.windowStartHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR - 1)) return null;
    update.windowStartHour = value.windowStartHour;
  }
  if ("windowEndHour" in value) {
    if (!isHour(value.windowEndHour, CARE_WINDOW_MIN_HOUR + 1, CARE_WINDOW_MAX_HOUR)) return null;
    update.windowEndHour = value.windowEndHour;
  }
  if (
    update.windowStartHour !== undefined
    && update.windowEndHour !== undefined
    && update.windowStartHour >= update.windowEndHour
  ) {
    return null;
  }
  return update;
}

/** 클라이언트가 받은 응답을 그대로 믿지 않고 모양을 다시 본다. */
export function parseCarePreferencePayload(value: unknown): CarePreferencePayload | null {
  if (!isRecord(value)) return null;
  const { chat, email, partner } = value;
  if (
    typeof value.available !== "boolean"
    || typeof value.emailAvailable !== "boolean"
    || typeof value.promptAnswered !== "boolean"
    || !isRecord(chat)
    || !isRecord(email)
    || !isRecord(partner)
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
  const couple = value.couple;
  if (
    !isCadence(value.cadence)
    || !isRecord(couple)
    || !isIntensity(couple.intensity)
    || !isHour(couple.windowStartHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isHour(couple.windowEndHour, CARE_WINDOW_MIN_HOUR, CARE_WINDOW_MAX_HOUR)
    || !isHour(couple.dailyLimit, 1, 3)
    || typeof couple.windowOpen !== "boolean"
  ) {
    return null;
  }
  return {
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
    cadence: {
      intensity: value.cadence.intensity,
      windowStartHour: value.cadence.windowStartHour,
      windowEndHour: value.cadence.windowEndHour,
    },
    couple: {
      intensity: couple.intensity,
      windowStartHour: couple.windowStartHour,
      windowEndHour: couple.windowEndHour,
      dailyLimit: couple.dailyLimit,
      windowOpen: couple.windowOpen,
    },
  };
}

/** 두 사람 설정을 합친 결과를 한 문장으로(파운더가 문구를 정한다, 18장 D-12). */
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

export function formatCareHour(hour: number): string {
  if (hour === 12) return "낮 12시";
  return hour < 12 ? `오전 ${hour}시` : `오후 ${hour - 12}시`;
}

/**
 * 라운지에서 한 번 묻는 카드를 띄울지(2026-11-13 결정: 첫 일정이 생긴 뒤, 거절하면 다시 묻지 않음).
 */
export function shouldAskCareConsentInLounge(input: {
  preference: CarePreferencePayload | null;
  plannedScheduleCount: number;
}): boolean {
  const { preference } = input;
  return preference !== null
    && preference.available
    && !preference.chat.enabled
    && !preference.promptAnswered
    && input.plannedScheduleCount > 0;
}
