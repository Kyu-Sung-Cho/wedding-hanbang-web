import {
  isAmoraPersonalizationChanges,
  type AmoraPersonalizationChanges,
} from "@/lib/amora/personalization";

export const WEDDING_CODE_AMORA_HANDOFF_PARAM = "wcAmoraHandoff";
export const WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY = "hanbang:wedding-code-amora-handoff";
export const WEDDING_CODE_AMORA_HANDOFF_TTL_MS = 15 * 60 * 1000;

const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE = "wedding_code_personal_help_review";
const MAX_ENVELOPE_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExplicitChanges(value: unknown): value is AmoraPersonalizationChanges {
  return isAmoraPersonalizationChanges(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

/** 사용자가 직접 고른 설정만 현재 탭에 잠시 보관한다. 원응답·문장은 받지 않는다. */
export function createWeddingCodeAmoraHandoff(
  changes: AmoraPersonalizationChanges,
): { href: string } | null {
  if (!isExplicitChanges(changes) || typeof window === "undefined") return null;
  try {
    const nonce = globalThis.crypto.randomUUID();
    if (!NONCE.test(nonce)) return null;
    const envelope = JSON.stringify({
      version: 1, purpose: PURPOSE, nonce, createdAt: Date.now(), changes,
    });
    if (envelope.length > MAX_ENVELOPE_LENGTH) return null;
    window.sessionStorage.setItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY, envelope);
    return { href: `/settings/amora-style?${new URLSearchParams({ [WEDDING_CODE_AMORA_HANDOFF_PARAM]: nonce })}` };
  } catch {
    return null;
  }
}

/** 로그인한 현재 계정이 검토할 초안으로 한 번만 읽는다. 저장 API는 호출하지 않는다. */
export function consumeWeddingCodeAmoraHandoff(nonce: string): AmoraPersonalizationChanges | null {
  if (!NONCE.test(nonce) || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    if (raw.length > MAX_ENVELOPE_LENGTH) {
      window.sessionStorage.removeItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY);
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.nonce !== nonce) return null;
    window.sessionStorage.removeItem(WEDDING_CODE_AMORA_HANDOFF_STORAGE_KEY);
    const keys = ["version", "purpose", "nonce", "createdAt", "changes"];
    if (Object.keys(value).length !== keys.length || !Object.keys(value).every((key) => keys.includes(key))
      || value.version !== 1 || value.purpose !== PURPOSE
      || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)
      || value.createdAt > Date.now() || Date.now() - value.createdAt > WEDDING_CODE_AMORA_HANDOFF_TTL_MS
      || !isExplicitChanges(value.changes)) return null;
    return value.changes;
  } catch {
    return null;
  }
}
