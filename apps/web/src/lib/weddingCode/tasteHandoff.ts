import { useAuthStore } from "@/stores/authStore";
import { buildWeddingTasteAmoraText, hasWeddingTasteAnswers, parseWeddingTasteDraft, type WeddingTasteDraftV1 } from "./taste";

export const WEDDING_TASTE_REVIEW_PARAM = "wcTasteReview";
export const WEDDING_TASTE_CHAT_PARAM = "wcTasteChat";
export const WEDDING_TASTE_REVIEW_KEY = "hanbang:wedding-taste-login-review";
export const WEDDING_TASTE_CHAT_KEY = "hanbang:wedding-taste-private-chat";
export const WEDDING_TASTE_HANDOFF_TTL_MS = 15 * 60 * 1000;
export const WEDDING_TASTE_AMORA_TEXT_MAX_LENGTH = 1200;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW = "wedding_taste_login_review";
const CHAT = "wedding_taste_private_chat";
const MAX_ENVELOPE_LENGTH = 8192;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 계정·프로필·커플 소속이 모두 확인될 때만 개인 상담으로 연결한다. */
export function getWeddingTasteChatIdentity(): string | null {
  const { user, profile, couple, isDemo, isInitialized, isLoading } = useAuthStore.getState();
  if (!isInitialized || isLoading || isDemo || !user?.id || user.id !== profile?.id
    || !couple?.id || profile.couple_id !== couple.id
    || (profile.role !== "bride" && profile.role !== "groom")
    || (profile.role === "bride" ? couple.bride_id : couple.groom_id) !== user.id) return null;
  return `${user.id}:${couple.id}:${profile.role}`;
}

function create(draft: WeddingTasteDraftV1, purpose: typeof REVIEW | typeof CHAT, scope?: string) {
  const validated = parseWeddingTasteDraft(draft);
  if (!validated || !hasWeddingTasteAnswers(validated) || typeof window === "undefined") return null;
  try {
    if (buildWeddingTasteAmoraText(validated).length > WEDDING_TASTE_AMORA_TEXT_MAX_LENGTH) return null;
    const nonce = globalThis.crypto.randomUUID();
    if (!NONCE.test(nonce)) return null;
    const envelope = JSON.stringify({ version: 1, purpose, nonce, createdAt: Date.now(), draft: validated,
      ...(scope ? purpose === CHAT ? { identity: scope } : { originOwnerId: scope } : {}) });
    if (envelope.length > MAX_ENVELOPE_LENGTH) return null;
    window.sessionStorage.setItem(purpose === REVIEW ? WEDDING_TASTE_REVIEW_KEY : WEDDING_TASTE_CHAT_KEY, envelope);
    return { href: purpose === REVIEW
      ? `${scope ? "/wedding/onboarding" : "/login"}?${new URLSearchParams({ redirect: `/wedding-code/taste?${new URLSearchParams({ [WEDDING_TASTE_REVIEW_PARAM]: nonce })}` })}`
      : `/chat?${new URLSearchParams({ scope: "private", [WEDDING_TASTE_CHAT_PARAM]: nonce })}` };
  } catch { return null; }
}

/** 로그인·기존 온보딩을 마친 뒤 현재 계정에서 다시 확인할 선택만 잠시 보관한다. */
export function createWeddingTasteLoginHandoff(draft: WeddingTasteDraftV1): { href: string } | null {
  const auth = useAuthStore.getState();
  if (!auth.isInitialized || auth.isLoading) return null;
  return create(draft, REVIEW, !auth.isDemo && auth.user?.id ? auth.user.id : undefined);
}

/** 사용자가 전체 전송문을 확인하고 직접 요청한 경우에만 호출한다. 네트워크 쓰기는 없다. */
export function prepareWeddingTasteChat(draft: WeddingTasteDraftV1): { href: string } | null {
  const identity = getWeddingTasteChatIdentity();
  return identity ? create(draft, CHAT, identity) : null;
}

function read(nonce: string, purpose: typeof REVIEW | typeof CHAT, consume: boolean): WeddingTasteDraftV1 | null {
  if (!NONCE.test(nonce) || typeof window === "undefined") return null;
  const key = purpose === REVIEW ? WEDDING_TASTE_REVIEW_KEY : WEDDING_TASTE_CHAT_KEY;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_ENVELOPE_LENGTH) { window.sessionStorage.removeItem(key); return null; }
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.nonce !== nonce) return null;
    const hasOriginOwner = Object.hasOwn(value, "originOwnerId");
    const keys = ["version", "purpose", "nonce", "createdAt", "draft",
      ...(purpose === CHAT ? ["identity"] : hasOriginOwner ? ["originOwnerId"] : [])];
    const draft = parseWeddingTasteDraft(value.draft);
    const valid = Object.keys(value).length === keys.length && Object.keys(value).every(entry => keys.includes(entry))
      && value.version === 1 && value.purpose === purpose
      && typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      && value.createdAt <= Date.now() && Date.now() - value.createdAt < WEDDING_TASTE_HANDOFF_TTL_MS
      && (purpose !== CHAT || (typeof value.identity === "string" && value.identity === getWeddingTasteChatIdentity()))
      && (purpose !== REVIEW || !hasOriginOwner || (typeof value.originOwnerId === "string" && value.originOwnerId.length > 0 && value.originOwnerId === useAuthStore.getState().user?.id))
      && draft && hasWeddingTasteAnswers(draft)
      && buildWeddingTasteAmoraText(draft).length <= WEDDING_TASTE_AMORA_TEXT_MAX_LENGTH;
    if (!valid || consume) window.sessionStorage.removeItem(key);
    return valid ? draft : null;
  } catch { return null; }
}

export function consumeWeddingTasteLoginHandoff(nonce: string): WeddingTasteDraftV1 | null {
  const auth = useAuthStore.getState();
  if (!auth.isInitialized || auth.isLoading || auth.isDemo || !auth.user?.id) return null;
  return read(nonce, REVIEW, true);
}

/** 기존 초안과 충돌하면 소비하지 않고, 같은 탭에서 만료 전 다시 시도할 수 있다. */
export function peekWeddingTasteChat(nonce: string): WeddingTasteDraftV1 | null {
  return read(nonce, CHAT, false);
}
export function consumeWeddingTasteChat(nonce: string): WeddingTasteDraftV1 | null {
  return read(nonce, CHAT, true);
}
export function forgetWeddingTasteChat(nonce: string): void {
  if (!NONCE.test(nonce) || typeof window === "undefined") return;
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(WEDDING_TASTE_CHAT_KEY) ?? "null");
    if (record(value) && value.nonce === nonce) window.sessionStorage.removeItem(WEDDING_TASTE_CHAT_KEY);
  } catch { /* 저장소가 막혀도 다른 초안에는 접근하지 않는다. */ }
}
