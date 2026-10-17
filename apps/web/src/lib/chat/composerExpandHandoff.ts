import { useAuthStore } from "@/stores/authStore";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { AMORA_COMPOSER_EXPAND_KEY, getAmoraTextDraftRecoveryEpoch } from "./textDraftRecoveryStorage";

export const AMORA_COMPOSER_EXPAND_PARAM = "amoraExpand";
export const AMORA_COMPOSER_EXPAND_TTL_MS = 2 * 60 * 1000;
export type ComposerExpandLane = "shared_ai" | "shared_partner" | "private_ai";
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT = 10_000;
type Actor = { actorId: string; coupleId: string; partnerId: string | null; epoch: number };
export interface ComposerExpandDraft {
  input: string;
  attachments: readonly unknown[];
  retryClientRequestId: string | null;
  pendingAttachmentReads?: number;
  preparation?: unknown;
  tasteHandoffNonce?: string;
}
export type ComposerExpandEnvelope = Actor & {
  version: 1; purpose: "amora_composer_expand"; nonce: string; createdAt: number;
  lane: ComposerExpandLane; input: string; retryClientRequestId: string | null;
};

/** 표시 역할 대신 인증된 본인과 현재 커플 소속을 경계로 삼는다. */
export function getComposerExpandActor(): Actor | null {
  const { user, profile, couple, isInitialized, isLoading, isDemo } = useAuthStore.getState();
  if (!isInitialized || isLoading || isDemo || !user?.id || user.id !== profile?.id
    || !couple?.id || profile.couple_id !== couple.id
    || (profile.role !== "bride" && profile.role !== "groom")
    || (profile.role === "bride" ? couple.bride_id : couple.groom_id) !== user.id) return null;
  const partnerId = couple.bride_id === user.id ? couple.groom_id
    : couple.groom_id === user.id ? couple.bride_id : undefined;
  if (partnerId === undefined || partnerId === user.id) return null;
  return { actorId: user.id, coupleId: couple.id, partnerId: partnerId ?? null, epoch: getAmoraTextDraftRecoveryEpoch() };
}

export function isExpandableComposerDraft(draft: ComposerExpandDraft): boolean {
  return typeof draft.input === "string" && draft.input.length <= MAX_TEXT
    && !hasAmoraSafetySignal(draft.input, "chat") && !draft.attachments.length
    && !draft.pendingAttachmentReads && !draft.preparation && !draft.tasteHandoffNonce
    && (draft.retryClientRequestId === null || typeof draft.retryClientRequestId === "string" && REQUEST_ID.test(draft.retryClientRequestId));
}

/** 명시적 확대에만 쓰는 같은 탭의 일회 인계. 본문은 URL로 내보내지 않는다. */
export function prepareComposerExpand(lane: ComposerExpandLane, draft: ComposerExpandDraft, sourceEpoch: number): { href: string; nonce: string } | null {
  const actor = getComposerExpandActor();
  if (!actor || actor.epoch !== sourceEpoch || !isExpandableComposerDraft(draft)
    || lane === "shared_partner" && !actor.partnerId || typeof window === "undefined") return null;
  try {
    const nonce = globalThis.crypto.randomUUID();
    if (!NONCE.test(nonce)) return null;
    const envelope: ComposerExpandEnvelope = { ...actor, partnerId: lane === "shared_partner" ? actor.partnerId : null,
      version: 1, purpose: "amora_composer_expand", nonce, createdAt: Date.now(), lane,
      input: draft.input, retryClientRequestId: draft.retryClientRequestId };
    window.sessionStorage.setItem(AMORA_COMPOSER_EXPAND_KEY, JSON.stringify(envelope));
    return { nonce, href: `/chat?${new URLSearchParams({ scope: lane === "private_ai" ? "private" : "shared", [AMORA_COMPOSER_EXPAND_PARAM]: nonce })}` };
  } catch { return null; }
}

export function forgetComposerExpand(nonce: string): boolean {
  if (!NONCE.test(nonce) || typeof window === "undefined") return false;
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(AMORA_COMPOSER_EXPAND_KEY) ?? "null");
    if (record(value) && value.nonce === nonce) {
      window.sessionStorage.removeItem(AMORA_COMPOSER_EXPAND_KEY); return true;
    }
  } catch { /* 저장소 실패가 다른 초안을 지우지 않게 한다. */ }
  return false;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function peekComposerExpand(nonce: string): ComposerExpandEnvelope | null {
  if (!NONCE.test(nonce) || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AMORA_COMPOSER_EXPAND_KEY);
    if (!raw || raw.length > MAX_TEXT * 8) return null;
    const value: unknown = JSON.parse(raw);
    const actor = getComposerExpandActor();
    if (!record(value) || value.nonce !== nonce) return null;
    const keys = ["actorId", "coupleId", "partnerId", "epoch", "version", "purpose", "nonce", "createdAt", "lane", "input", "retryClientRequestId"];
    const valid = actor && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
      && value.version === 1 && value.purpose === "amora_composer_expand"
      && value.actorId === actor.actorId && value.coupleId === actor.coupleId && value.epoch === actor.epoch
      && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt <= Date.now()
      && Date.now() - value.createdAt < AMORA_COMPOSER_EXPAND_TTL_MS
      && (value.lane === "shared_ai" || value.lane === "private_ai" || value.lane === "shared_partner")
      && (value.lane === "shared_partner" ? Boolean(actor.partnerId) && value.partnerId === actor.partnerId : value.partnerId === null)
      && typeof value.input === "string" && isExpandableComposerDraft({ input: value.input, attachments: [], retryClientRequestId: value.retryClientRequestId as string | null });
    if (!valid) return null;
    return value as ComposerExpandEnvelope;
  } catch { return null; }
}

export function consumeComposerExpand(nonce: string): ComposerExpandEnvelope | null {
  const value = peekComposerExpand(nonce);
  return value && forgetComposerExpand(nonce) ? value : null;
}
