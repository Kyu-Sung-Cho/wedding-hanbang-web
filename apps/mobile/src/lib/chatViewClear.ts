import { compareChatTimestamps } from "@hanbang/shared";
import type { AmoraChatLaneRecord } from "@hanbang/shared/chat-lane";
import { readChatClearRequest } from "@/lib/chatClearRequest";

/**
 * 「대화 화면 정리」 — 웹 채팅 머리의 같은 이름 버튼과 그 창(`ChatContent.tsx` 의 `clearStep`)을 앱으로
 * 옮긴다(2026-09-18).
 *
 * 앱에는 `DELETE /api/chat/messages` 를 부르는 곳이 한 군데도 없었다. 설정의 「기억 초기화」는 요약·기억만
 * 지우고 채팅 원문은 남긴다. 그런데 개인정보처리방침은 "비공개 대화 삭제를 선택하면 원문과 요약·기억을
 * 삭제"한다고 약속하고, 그 약속에 "웹에서만"이라는 단서가 없다. 주 제품인 앱에서 그 약속을 지킬 길을 낸다.
 *
 * 이 파일이 정하는 것:
 * - 창의 단계와 문구. 웹 창과 **글자 그대로** 같다(`chatViewClear.test.mjs` 가 웹 소스와 대조한다).
 *   앱에만 있는 말은 셋이다 — 대기 중인 요청이 있어 「둘 다」를 막는 이유, 비공개 삭제의 두 번째 확인,
 *   상태 코드별 실패 문구.
 * - 앱이 보내는 모드는 세 가지뿐이다. `delete_shared` 는 보내지 않는다(서버도 410 으로 막는다 — 공유 기록은
 *   두 사람의 동의 흐름으로만 정리한다).
 * - 서버가 확인해 준 것만 성공이다. 정리는 2xx·`success: true`·같은 모드·ISO 형식 `clearedAt` 이 모두 있어야,
 *   동의 요청은 돌려받은 메시지가 대기 중인 요청 카드여야 성공이다. 서버 문장은 그리지 않는다.
 * - 정리한 뒤에도 사람이 있던 범위와 쓰던 초안을 잃지 않게 하는 「이어받기」(carry). 앱은 화면 경계가
 *   움직이면 대화 세션을 통째로 다시 불러오고, 그때 범위를 「함께 대화」로 되돌리고 초안을 비운다. 비공개
 *   삭제 직후 「함께 대화」로 튕기지 않게, 다시 불러온 뒤 같은 사람·같은 커플이면 되돌려 놓는다.
 */

export type ChatViewClearScope = "shared" | "private";
export type ChatViewClearTarget = "ai" | "partner";
export type ChatViewClearMode = "view_reset_shared" | "view_reset_private" | "delete_private";
export type ChatViewClearStep = "closed" | "shared_choose" | "shared_confirm_both" | "private_confirm";

/** 앱이 `DELETE /api/chat/messages` 로 보내는 모드 전부. 여기에 없는 모드는 보내지 않는다. */
export const CHAT_VIEW_CLEAR_MODES: readonly ChatViewClearMode[] = [
  "view_reset_shared",
  "view_reset_private",
  "delete_private",
];

/** 창이 응답을 기다리는 최대 시간. 넘으면 연결 실패로 본다 — 비공개 삭제는 결과를 모르는 것으로 다룬다. */
export const CHAT_VIEW_CLEAR_TIMEOUT_MS = 30_000;

const KEEPS_WHAT = "해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.";

export const CHAT_VIEW_CLEAR_COPY = {
  /** 머리 버튼의 읽어 주는 이름 — 웹 버튼의 `aria-label` 과 같다. */
  entryLabel: "대화 화면 정리",
  cancel: "취소",
  shared: {
    title: "함께 대화 화면 정리",
    intro: `화면에 보이는 이전 대화를 정리할 방법을 골라주세요. ${KEEPS_WHAT}`,
    introNote: "비공개 상담 기록은 영향받지 않아요.",
    ownTitle: "내 화면만 정리 (추천)",
    ownDescription: "상대방 화면은 그대로 두고, 내 화면에서만 이전 메시지를 정리해요.",
    bothTitle: "둘의 화면 함께 정리 (상대방 동의 필요)",
    // 웹은 가운데 한 마디를 굵게 쓴다(`<strong>`). 앱도 같은 자리를 굵게 그린다.
    bothDescription: {
      before: "상대방에게 동의 요청을 보내요. 상대방이 [동의] 누르면 양쪽 화면이 함께 정리되고 이전 대화는 이후 상담에서 제외돼요. ",
      strong: "원문과 저장한 예산·일정·결정은 유지",
      after: "돼요.",
    },
    // 앱에만 있는 말. 서버는 커플당 대기 요청을 하나로 막지 않는다 — 불러온 대화에 대기 카드가 있으면 막는다.
    bothPendingReason: "이미 보낸 동의 요청이 대화에 남아 있어요. 상대방이 답한 뒤에 다시 요청할 수 있어요.",
  },
  sharedBoth: {
    title: "둘의 화면 정리 동의를 요청할게요",
    body: "채팅에 동의 카드가 올라가고 상대방이 [동의] 누르면 양쪽 화면이 정리됩니다. 거절되면 그대로 유지돼요.",
    note: KEEPS_WHAT,
    back: "돌아가기",
    submit: "동의 요청 보내기",
    submitting: "동의 요청 보내는 중…",
  },
  private: {
    title: "비공개 상담 화면 정리",
    intro: "화면만 정리할지, 비공개 대화·기억까지 삭제할지 선택해주세요.",
    introNote: "상대방의 비공개 상담에는 영향이 없어요.",
    ownTitle: "내 화면만 정리 (추천)",
    ownDescription: KEEPS_WHAT,
    deleteTitle: "비공개 대화·아모라 기억 삭제",
    deleteDescription: "이 대화와 아모라가 만든 요약·기억을 삭제하고 비공개 기억 사용을 꺼요. 이 비공개 대화에서 저장한 개인 할 일도 함께 삭제됩니다. 별도 저장 메모·법적/보안 로그·백업은 각 보관 정책에 따라 처리돼요.",
  },
  // 앱에만 있는 두 번째 확인. 앱의 다른 되돌릴 수 없는 동작(설정 「기억 초기화」)처럼 네이티브 창으로 한 번 더 묻는다.
  deleteConfirm: {
    title: "비공개 대화·아모라 기억을 삭제할까요?",
    message: "삭제한 비공개 대화와 아모라 기억은 되돌릴 수 없어요.",
    cancel: "취소",
    confirm: "삭제",
  },
} as const;

/** 정리 실패 문구. 서버 문장 대신 상태 코드로 고른다. 모두 "요"로 끝난다. */
export const CHAT_VIEW_CLEAR_FAILURE = {
  unauthorized: "로그인이 만료됐어요. 다시 로그인한 뒤 정리해 주세요.",
  forbidden: "이 대화를 정리할 권한이 없어요. 커플 연결 상태를 확인해 주세요.",
  rateLimited: "정리 요청이 잠시 몰렸어요. 조금 뒤 다시 눌러 주세요.",
  server: "대화를 안전하게 정리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  network: "연결을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.",
  rejected: "대화를 정리하지 못했어요. 대화를 다시 불러온 뒤 시도해 주세요.",
  unconfirmed: "정리 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  /** 비공개 삭제의 결과를 모를 때. "삭제되지 않았어요"라고 단정하지 않는다 — 서버에서는 지워졌을 수 있다. */
  deleteUnknown: "비공개 대화 삭제 결과를 확인하지 못했어요. 대화를 다시 불러왔으니 남아 있는 대화가 있는지 확인해 주세요.",
} as const;

/** 「둘 다」 동의 요청 실패 문구. 5xx 문구는 웹 창의 문장과 같다. */
export const SHARED_CHAT_CLEAR_REQUEST_FAILURE = {
  unauthorized: "로그인이 만료됐어요. 다시 로그인한 뒤 요청해 주세요.",
  forbidden: "동의 요청을 보낼 권한이 없어요. 커플 연결 상태를 확인해 주세요.",
  rateLimited: "요청이 잠시 몰렸어요. 조금 뒤 다시 눌러 주세요.",
  server: "동의 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
  network: "연결을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.",
  rejected: "동의 요청을 보내지 못했어요. 대화를 다시 불러온 뒤 시도해 주세요.",
} as const;

type FailureCopy = { unauthorized: string; forbidden: string; rateLimited: string; server: string; rejected: string };

function failureForStatus(copy: FailureCopy, status: number): string {
  if (status === 401) return copy.unauthorized;
  if (status === 403) return copy.forbidden;
  if (status === 429) return copy.rateLimited;
  if (status >= 500) return copy.server;
  return copy.rejected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 서버가 돌려주는 정리 시점. 앱이 프로필 경계를 읽을 때와 같은 ISO 형식이어야 한다(`chatPrivacyScope.ts`). */
export function isChatViewClearedAt(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function chatViewClearScope(mode: ChatViewClearMode): ChatViewClearScope {
  return mode === "view_reset_shared" ? "shared" : "private";
}

/** 머리 버튼을 누르면 여는 첫 단계. 웹과 같다 — 함께 대화는 고르기부터, 나만 상담은 확인 단계부터. */
export function openingChatViewClearStep(scope: ChatViewClearScope): Exclude<ChatViewClearStep, "closed" | "shared_confirm_both"> {
  return scope === "private" ? "private_confirm" : "shared_choose";
}

type AuthenticatedRequest = (path: string, init: RequestInit) => Promise<Response>;

/** 요청과 응답 본문 읽기를 합쳐 시간 제한을 둔다. 넘으면 호출부가 연결 실패로 받는다. */
async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export type ChatViewClearResult =
  | { ok: true; mode: ChatViewClearMode; clearedAt: string }
  /** `unknown`: 연결 실패·5xx·확인할 수 없는 성공 응답 — 서버에서 이미 처리됐을 수 있다. */
  | { ok: false; error: string; outcome: "rejected" | "unknown" };

/**
 * 화면을 정리하거나 비공개 대화를 삭제한다. `request` 는 누른 사람에 결박된 인증 요청이다
 * (화면은 `apiFetchForExpectedUser` 를 넘긴다).
 */
export async function requestChatViewClear(
  request: AuthenticatedRequest,
  coupleId: string,
  mode: ChatViewClearMode,
  { timeoutMs = CHAT_VIEW_CLEAR_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ChatViewClearResult> {
  if (!CHAT_VIEW_CLEAR_MODES.includes(mode)) {
    return { ok: false, error: CHAT_VIEW_CLEAR_FAILURE.rejected, outcome: "rejected" };
  }
  let exchange: { status: number; ok: boolean; payload: unknown };
  try {
    exchange = await withTimeout(timeoutMs, async (signal) => {
      const response = await request("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, mode }),
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, payload };
    });
  } catch {
    return { ok: false, error: CHAT_VIEW_CLEAR_FAILURE.network, outcome: "unknown" };
  }
  if (!exchange.ok) {
    return {
      ok: false,
      error: failureForStatus(CHAT_VIEW_CLEAR_FAILURE, exchange.status),
      outcome: exchange.status >= 500 ? "unknown" : "rejected",
    };
  }
  const payload = exchange.payload;
  if (!isRecord(payload) || payload.success !== true || payload.mode !== mode || !isChatViewClearedAt(payload.clearedAt)) {
    return { ok: false, error: CHAT_VIEW_CLEAR_FAILURE.unconfirmed, outcome: "unknown" };
  }
  return { ok: true, mode, clearedAt: payload.clearedAt };
}

export type SharedChatClearRequestResult =
  | { ok: true; message: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * 「둘의 화면 함께 정리」 동의 요청을 보낸다. 서버가 돌려준 메시지가 이 사람이 보낸 대기 중인 요청 카드일
 * 때만 성공이다 — 그 메시지를 화면에 바로 붙여, 새로고침하지 않아도 대기 카드가 보이게 한다.
 */
export async function requestSharedChatClear(
  request: AuthenticatedRequest,
  coupleId: string,
  requesterId: string,
  { timeoutMs = CHAT_VIEW_CLEAR_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<SharedChatClearRequestResult> {
  let exchange: { status: number; ok: boolean; payload: unknown };
  try {
    exchange = await withTimeout(timeoutMs, async (signal) => {
      const response = await request("/api/chat/clear-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", coupleId }),
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, payload };
    });
  } catch {
    return { ok: false, error: SHARED_CHAT_CLEAR_REQUEST_FAILURE.network };
  }
  if (!exchange.ok) return { ok: false, error: failureForStatus(SHARED_CHAT_CLEAR_REQUEST_FAILURE, exchange.status) };
  const payload = exchange.payload;
  const message = isRecord(payload) && payload.success === true && isRecord(payload.message) ? payload.message : null;
  const view = message
    && message.couple_id === coupleId
    && (message.sender_id === null || typeof message.sender_id === "string")
    && typeof message.visibility === "string"
    ? readChatClearRequest({ sender_id: message.sender_id, visibility: message.visibility, metadata: message.metadata })
    : null;
  if (!message || !view || view.status !== "pending" || view.requestedBy !== requesterId) {
    return { ok: false, error: SHARED_CHAT_CLEAR_REQUEST_FAILURE.server };
  }
  return { ok: true, message };
}

/** 불러온 공유 메시지에 누가 보냈든 아직 답이 없는 「함께 새로 시작」 요청 카드가 있는가. */
export function hasPendingSharedChatClearRequest(
  messages: readonly { sender_id: string | null; visibility: string; metadata?: unknown }[],
): boolean {
  return messages.some((message) => readChatClearRequest(message)?.status === "pending");
}

/**
 * 서버가 확인한 정리 시점까지의 메시지를 그 범위에서 곧바로 뺀다. 세션을 다시 불러오기 전 잠깐 동안
 * 지운 대화가 다시 보이지 않게 한다. 다른 범위의 메시지는 건드리지 않는다.
 */
export function removeMessagesClearedFromView<T extends { visibility: string; created_at?: string | null }>(
  messages: readonly T[],
  visibility: string | null,
  clearedAt: string,
): T[] {
  if (visibility === null) return [...messages];
  return messages.filter((message) => (
    message.visibility !== visibility
    || (typeof message.created_at === "string" && compareChatTimestamps(message.created_at, clearedAt) === 1)
  ));
}

export type ChatViewClearDrafts = AmoraChatLaneRecord<string>;

/**
 * 정리하는 동안 붙잡아 두는 「어디에 있었고 무엇을 쓰고 있었나」.
 *
 * 세션 리셋(`scheduleChatSessionReload`)이 비우지 않는 따로 둔 자리에 담는다. 정리가 성공하면 서버가 프로필의
 * 경계를 옮기고, 실시간 프로필 UPDATE 와 범위 재확인(`verifyLoadedChatBoundary`) 둘 중 먼저 본 쪽이 세션을
 * 리셋한다 — 그 둘이 응답보다 먼저 올 수도 있어서, 요청을 **보내기 전에** 담는다.
 */
export interface ChatViewClearCarry {
  requestId: number;
  userId: string;
  coupleId: string;
  scope: ChatViewClearScope;
  target: ChatViewClearTarget;
  drafts: ChatViewClearDrafts;
  /** pending: 응답을 기다린다. confirmed: 서버가 `clearedAt` 을 확인했다. unknown: 결과를 모른다. */
  outcome: "pending" | "confirmed" | "unknown";
  clearedAt: string | null;
  /** 결과를 모르게 된 시각. 그 뒤 {@link CHAT_VIEW_CLEAR_UNKNOWN_CARRY_TTL_MS} 안의 불러오기에만 쓴다. */
  unknownAt?: number;
  /** 이 carry 를 이미 적용한 불러오기가 본 그 범위의 경계. 아직 적용 전이면 없다. */
  appliedCursor?: string | null;
}

/**
 * 결과를 모르는 정리의 carry 를 붙잡아 두는 시간. 응답만 잃고 서버에서는 정리됐으면 곧 실시간 이벤트나 재연결
 * 확인이 세션을 다시 불러온다 — 그때를 위한 것이다. 한참 뒤의 다른 불러오기가 옛 초안을 되살리면 안 된다.
 */
export const CHAT_VIEW_CLEAR_UNKNOWN_CARRY_TTL_MS = 120_000;

export function armChatViewClearCarry(input: {
  requestId: number;
  userId: string;
  coupleId: string;
  scope: ChatViewClearScope;
  target: ChatViewClearTarget;
  drafts: ChatViewClearDrafts;
}): ChatViewClearCarry {
  return { ...input, drafts: { ...input.drafts }, outcome: "pending", clearedAt: null };
}

function cursorReflects(cursor: string | null | undefined, clearedAt: string): boolean {
  if (typeof cursor !== "string") return false;
  // 비교할 수 없는 값이면 붙잡아 두지 않는다 — 오래된 carry 가 나중의 다른 불러오기를 덮으면 안 된다.
  return compareChatTimestamps(cursor, clearedAt) !== -1;
}

/**
 * 요청 결과를 carry 에 적는다. 다른 요청의 carry 는 건드리지 않는다.
 *
 * - 실패(거절): 경계가 움직이지 않았으니 붙잡을 것이 없다.
 * - 성공: 경계를 이미 반영한 불러오기가 carry 를 적용했으면 끝이다. 아니면 그 경계를 반영하는 불러오기가
 *   올 때까지 붙잡는다.
 * - 결과 모름: 다음 불러오기 한 번이 쓰고 비운다(정해진 시간 안일 때만). 이미 적용한 불러오기가 있었으면 끝이다.
 */
export function settleChatViewClearCarry(
  carry: ChatViewClearCarry | null,
  requestId: number,
  outcome: { clearedAt: string } | "unknown" | "rejected",
  now: number = Date.now(),
): ChatViewClearCarry | null {
  if (!carry || carry.requestId !== requestId) return carry;
  if (outcome === "rejected") return null;
  const applied = carry.appliedCursor !== undefined;
  if (outcome === "unknown") return applied ? null : { ...carry, outcome: "unknown", unknownAt: now };
  if (applied && cursorReflects(carry.appliedCursor, outcome.clearedAt)) return null;
  return { ...carry, outcome: "confirmed", clearedAt: outcome.clearedAt };
}

/**
 * 세션을 다 불러온 끝에 부른다. 같은 사람·같은 커플이면 범위·대상·초안을 되돌리고, 더 붙잡을지 정한다.
 * 다른 사람·다른 커플이면 버린다(계정·커플이 바뀐 뒤에는 되돌리지 않는다).
 */
export function takeChatViewClearCarry(
  carry: ChatViewClearCarry | null,
  loaded: {
    userId: string;
    coupleId: string;
    cursors: { shared: string | null; private: string | null };
    canUsePrivate: boolean;
    hasLinkedPartner: boolean;
  },
  now: number = Date.now(),
): {
  restore: { scope: ChatViewClearScope; target: ChatViewClearTarget; drafts: ChatViewClearDrafts } | null;
  keep: ChatViewClearCarry | null;
} {
  if (!carry || carry.userId !== loaded.userId || carry.coupleId !== loaded.coupleId) {
    return { restore: null, keep: null };
  }
  if (carry.outcome === "unknown" && now - (carry.unknownAt ?? 0) > CHAT_VIEW_CLEAR_UNKNOWN_CARRY_TTL_MS) {
    return { restore: null, keep: null };
  }
  const scope: ChatViewClearScope = carry.scope === "private" && !loaded.canUsePrivate ? "shared" : carry.scope;
  const target: ChatViewClearTarget = scope === "shared" && carry.target === "partner" && loaded.hasLinkedPartner
    ? "partner"
    : "ai";
  // 상대 연결이 끊겼으면 상대에게 쓰던 글은 되살리지 않는다(연결이 끊길 때 화면이 그 칸을 비우는 것과 같다).
  const drafts = loaded.hasLinkedPartner ? { ...carry.drafts } : { ...carry.drafts, shared_partner: "" };
  const cursor = loaded.cursors[carry.scope];
  const settled = carry.outcome === "unknown"
    || (carry.outcome === "confirmed" && carry.clearedAt !== null && cursorReflects(cursor, carry.clearedAt));
  return {
    restore: { scope, target, drafts },
    keep: settled ? null : { ...carry, appliedCursor: cursor },
  };
}
