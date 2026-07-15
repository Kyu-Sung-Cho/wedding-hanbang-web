"use client";

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { readMyChatViewState } from "@/lib/profile/safeProfile";
import { captureEvent } from "@/lib/analytics";
import { dedupeChatAttachments } from "@/lib/chat/attachments";
import { attachmentProviderConsentVersion } from "@hanbang/shared";

/**
 * coupleId당 활성 Realtime 채널 레지스트리.
 * subscribeToMessages가 채널을 구독한 뒤 여기에 등록 → notifyTyping이
 * 같은 채널 인스턴스로 broadcast 송신 (별개 채널 인스턴스는 send 안 됨).
 */
const activeChatChannels = new Map<string, RealtimeChannel>();
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
  ChatMessageTarget,
} from "@/types/database.types";
import type { SSEEvent, WeddingContext } from "@/types/chat.types";
import { useAuthStore } from "./authStore";

type ClearScope = "shared" | "private";

interface ChatAiRequestPayload {
  currentUserMessageId: string;
  coupleId: string;
  senderName: string;
  senderRole: MessageSenderRole;
  weddingContext: WeddingContext;
  isDemo: boolean;
  clientRequestId: string;
  visibility: "shared" | "bride_private" | "groom_private";
  clientCapabilities: { toolCards: true; incrementalSse: true };
  attachments?: Array<{ base64: string; mediaType: string; fileName: string }>;
  attachmentProviderConsentVersion?: typeof attachmentProviderConsentVersion;
}

interface PendingAiRequest {
  payload: ChatAiRequestPayload;
  coupleId: string;
  isDemo: boolean;
  visibility: ChatMessage["visibility"];
}

class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

function createChatRequestId(prefix = "web"): string {
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${value}`.slice(0, 120);
}

async function fetchChatLifecycle(init: RequestInit): Promise<{ response: Response; data: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 360; attempt++) {
    const response = await fetch("/api/chat/messages", init);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status !== 202) return { response, data };
    const retryMs = typeof data.retryAfterMs === "number"
      ? Math.max(500, Math.min(5000, data.retryAfterMs))
      : 1000;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  throw new Error("진행 중인 AI 요청 종료를 기다리는 시간이 초과되었습니다.");
}

function latestIso(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (valid.length === 0) return null;
  return valid.reduce((latest, value) =>
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest
  );
}

function clearStorageKey(coupleId: string, scope: ClearScope) {
  const authState = useAuthStore.getState();
  const userId = authState.profile?.id ?? authState.user?.id ?? "anonymous";
  return `hanbang.chatClearedAt.${userId}.${coupleId}.${scope}`;
}

function readLocalClearedAt(coupleId: string, scope: ClearScope): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(clearStorageKey(coupleId, scope));
  } catch {
    return null;
  }
}

function writeLocalClearedAt(coupleId: string, scope: ClearScope, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(clearStorageKey(coupleId, scope), value);
  } catch {
    // localStorage can be unavailable in private browsing; server timestamp still applies.
  }
}

function currentPrivateVisibility(): ChatMessage["visibility"] | null {
  const role = useAuthStore.getState().profile?.role;
  if (role === "bride") return "bride_private";
  if (role === "groom") return "groom_private";
  return null;
}

function canCurrentUserSeeMessage(message: ChatMessage): boolean {
  if (message.visibility === "shared") return true;
  return message.visibility === currentPrivateVisibility();
}

function isCurrentUserPrivateMessage(message: ChatMessage): boolean {
  const myVisibility = currentPrivateVisibility();
  return !!myVisibility && message.visibility === myVisibility;
}

function isAfterClearedAt(
  message: ChatMessage,
  sharedClearedAt: string | null,
  privateClearedAt: string | null
): boolean {
  if (message.visibility === "shared" && sharedClearedAt) {
    return new Date(message.created_at) > new Date(sharedClearedAt);
  }
  if (isCurrentUserPrivateMessage(message) && privateClearedAt) {
    return new Date(message.created_at) > new Date(privateClearedAt);
  }
  return true;
}

/** 다른 사람(상대방 또는 AI)이 진행 중인 활동을 인지하기 위한 Presence 정보 */
export interface ChatPresence {
  /** 상대방(파트너)이 입력 중일 때 그의 senderRole, 아니면 null */
  partnerTyping: { sender_role: "bride" | "groom"; user_id: string; updated_at: number } | null;
  /** AI(아모라)가 응답 생성 중일 때 누구의 요청에 대한 것인지 / 아니면 null */
  aiResponding: { triggered_by_user_id: string; started_at: number } | null;
}

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;
  pendingAiRequest: PendingAiRequest | null;
  initialLoadDone: boolean;

  /** 구버전 또는 향후 opt-in 제한 서버의 잔여량 이벤트 호환용. 현재 UI는 표시하지 않는다. */
  quotaRemaining: number | null;

  // 본인의 view-reset timestamp — "새 채팅(내 화면만)" 누른 시점.
  // pollNewMessages 등 후속 fetch 에서 이 시점 이전 메시지는 필터링.
  // 이전 사고: poll 이 lastMsg 기준으로만 since 잡아서 새 채팅 직후
  // cleared 메시지가 다시 들어왔음.
  sharedClearedAt: string | null;
  privateClearedAt: string | null;

  // Presence — Realtime broadcast로 동기화되는 상대방/AI 활동 상태
  presence: ChatPresence;

  loadMessages: (coupleId: string) => Promise<void>;
  pollNewMessages: (coupleId: string) => Promise<void>;
  sendMessage: (params: {
    content: string;
    senderId: string;
    senderRole: MessageSenderRole;
    coupleId: string;
    senderName: string;
    weddingContext: WeddingContext;
    images?: Array<{ base64: string; mediaType: string; previewUrl: string }>;
    attachmentProviderConsentVersion?: typeof attachmentProviderConsentVersion;
    target?: ChatMessageTarget;
    visibility?: "shared" | "bride_private" | "groom_private";
  }) => Promise<boolean>;
  retryAiResponse: () => Promise<void>;
  cancelAiResponse: () => void;
  dismissAiError: () => void;
  requestMediation: (params: {
    coupleId: string;
    senderRole: MessageSenderRole;
    senderName: string;
    weddingContext: WeddingContext;
    conflictContext: string;
  }) => Promise<void>;
  clearMessages: (
    coupleId: string,
    mode: "view_reset_shared" | "delete_shared" | "view_reset_private" | "delete_private"
  ) => Promise<void>;

  /** "함께 대화 새로 시작" 요청을 상대방에게 보냄 — 양쪽 동의 시에만 화면 정리.
   *  이전 사고: 한쪽이 누르면 양쪽 DB 즉시 삭제 → 일방적 데이터 손실. */
  requestSharedClear: (coupleId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 받은 요청에 동의/거절 응답. accept 시 양쪽 cleared_at 갱신됨. */
  respondToClearRequest: (
    messageId: string,
    action: "accept" | "decline"
  ) => Promise<{ ok: boolean; error?: string }>;
  subscribeToMessages: (coupleId: string) => () => void;

  /** 입력창에서 호출 — 디바운스된 typing broadcast (자동 stop 포함) */
  notifyTyping: (params: { coupleId: string; userId: string; senderRole: "bride" | "groom" }) => void;

  reset: () => void;
}

let activeAiAbortController: AbortController | null = null;
// Every logout/account switch advances this generation. Async work that began
// in an older user scope must never repopulate the shared Zustand store after
// reset, even when AbortController rejection arrives on a later microtask.
let chatUserScopeGeneration = 0;
const USER_CANCELLED_ABORT_MESSAGE = "hanbang_user_cancelled_ai_response";

function abortWasRequestedByUser(controller: AbortController): boolean {
  return controller.signal.aborted
    && controller.signal.reason instanceof DOMException
    && controller.signal.reason.name === "AbortError"
    && controller.signal.reason.message === USER_CANCELLED_ABORT_MESSAGE;
}

function abortActiveAiRequestByUser(): void {
  if (!activeAiAbortController || activeAiAbortController.signal.aborted) return;
  activeAiAbortController.abort(
    new DOMException(USER_CANCELLED_ABORT_MESSAGE, "AbortError")
  );
}

// 도구 결과를 authStore에 반영
// SSE 스트림 파싱 공통 함수
async function parseSSEStream(
  res: Response,
  callbacks: {
    onTextDelta: (content: string) => void;
    onTextClear?: () => void;
    onToolResult: (result: ToolExecutionResult) => void;
    onSuggestions: (suggestions: string[]) => void;
    onQuota?: (remaining: number) => void;
    onDone: (fullContent: string, metadata: ChatMessageMetadata) => void;
    onError: (message: string, code?: string) => void;
  }
) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;

      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        switch (event.type) {
          case "text_delta":
            callbacks.onTextDelta(event.content);
            break;
          case "text_clear":
            callbacks.onTextClear?.();
            break;
          case "tool_result":
            callbacks.onToolResult(event.result);
            break;
          case "suggestions":
            callbacks.onSuggestions(event.suggestions);
            break;
          case "quota":
            callbacks.onQuota?.(event.remaining);
            break;
          case "done":
            callbacks.onDone(event.fullContent, event.metadata);
            break;
          case "error":
            callbacks.onError(event.message, event.code);
            break;
        }
      } catch (e) {
        console.warn("SSE 파싱 실패:", e);
      }
    }
  }
}

// DB row → 내부 ChatMessage 변환 (sender_type → sender_role)
function dbRowToMessage(row: Record<string, unknown>): ChatMessage {
  const rawVisibility = row.visibility;
  const visibility: ChatMessage["visibility"] =
    rawVisibility === "bride_private" || rawVisibility === "groom_private" ? rawVisibility : "shared";
  return {
    id: row.id as string,
    couple_id: row.couple_id as string,
    sender_id: (row.sender_id as string) ?? null,
    sender_role: (row.sender_type as MessageSenderRole) ?? (row.sender_role as MessageSenderRole) ?? "ai",
    content: row.content as string,
    metadata: (row.metadata as ChatMessageMetadata) ?? null,
    visibility,
    created_at: row.created_at as string,
  };
}

// AI 메시지를 로컬 state에 먼저 추가, 그 다음 DB 저장 시도
async function saveAiMessage(
  set: (fn: ((s: ChatStoreState) => Partial<ChatStoreState>) | Partial<ChatStoreState>) => void,
  params: {
    coupleId: string;
    fullContent: string;
    aiMetadata: ChatMessageMetadata;
    isDemo: boolean;
    visibility?: ChatMessage["visibility"];
  }
) {
  const { coupleId, fullContent, aiMetadata, isDemo } = params;
  const visibility: ChatMessage["visibility"] = params.visibility ?? "shared";

  // 서버에서 이미 INSERT 했으면 그 id/created_at 사용 (모바일 백그라운드 안전)
  const serverMessageId = (aiMetadata as { serverMessageId?: string })?.serverMessageId ?? null;
  const serverCreatedAt = (aiMetadata as { serverCreatedAt?: string })?.serverCreatedAt ?? null;

  if (serverMessageId) {
    // 1) 서버 INSERT 성공 — 그 id로 로컬 추가 (dedup 자동 — 폴링/Realtime이 같은 id 가져와도 중복 안 됨)
    const localMsg: ChatMessage = {
      id: serverMessageId,
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      content: fullContent,
      metadata: aiMetadata,
      visibility,
      created_at: serverCreatedAt ?? new Date().toISOString(),
    };
    set((s) => {
      const exists = s.messages.some((m) => m.id === serverMessageId);
      if (exists) return s;
      return { messages: [...s.messages, localMsg] };
    });
    return;
  }

  // 2) 서버 INSERT 실패 또는 demo 모드 — fallback: 클라이언트에서 처리
  const tempId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const localMsg: ChatMessage = {
    id: tempId,
    couple_id: coupleId,
    sender_id: null,
    sender_role: "ai",
    content: fullContent,
    metadata: aiMetadata,
    visibility,
    created_at: new Date().toISOString(),
  };
  set((s) => ({ messages: [...s.messages, localMsg] }));

  if (!isDemo) {
    try {
      const supabase = createClient();
      const aiStageTag = aiMetadata?.stageTag ?? null;
      const aiSpecialistType = aiMetadata?.specialistType ?? null;

      const { data: aiInserted } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: fullContent,
          metadata: aiMetadata,
          stage_tag: aiStageTag,
          specialist_type: aiSpecialistType,
          visibility,
        })
        .select()
        .single();

      if (aiInserted) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === tempId ? dbRowToMessage(aiInserted as Record<string, unknown>) : m
          ),
        }));
      }
    } catch (err) {
      console.error("AI 메시지 DB 저장 실패 (로컬에는 표시됨):", err);
    }
  }
}

type ChatStoreSet = (
  next:
    | Partial<ChatStoreState>
    | ((state: ChatStoreState) => Partial<ChatStoreState>)
) => void;
type ChatStoreGet = () => ChatStoreState;

async function parseChatApiError(response: Response): Promise<ChatApiError> {
  const fallback = `AI 응답 실패 (${response.status})`;
  const raw = await response.text().catch(() => "");
  if (!raw) return new ChatApiError(fallback, response.status, null);

  try {
    const parsed = JSON.parse(raw) as { error?: unknown; code?: unknown };
    return new ChatApiError(
      typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : fallback,
      response.status,
      typeof parsed.code === "string" ? parsed.code : null
    );
  } catch {
    return new ChatApiError(fallback, response.status, null);
  }
}

function isRetryableAiError(error: unknown): boolean {
  if (!(error instanceof ChatApiError)) return true;
  if (["couple_provider_daily", "global_daily"].includes(error.code ?? "")) {
    return false;
  }
  if (["request_failed", "request_in_progress", "claim_unavailable"].includes(error.code ?? "")) {
    return true;
  }
  // 스트림 내부 오류는 HTTP 200 응답 안에서 도착한다. 명시적인 일일 한도 코드가 아니면 재시도 가능하다.
  if (error.status === 200) return true;
  return error.status === 408 || error.status >= 500;
}

function friendlyAiError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "응답 시간이 초과되었습니다. 답변을 다시 받아주세요.";
  }
  if (error instanceof ChatApiError) {
    if (error.status === 429) {
      return error.message || "지금은 잠시 쉬어가고 있어요. 잠시 후 다시 시도해주세요.";
    }
    return error.message;
  }
  return "AI 응답을 받지 못했습니다. 저장된 질문으로 답변을 다시 받을 수 있어요.";
}

async function executeAiRequest(
  set: ChatStoreSet,
  get: ChatStoreGet,
  request: PendingAiRequest,
  options: { rotateAfterConfirmedFailure: boolean }
): Promise<void> {
  const scopeGeneration = chatUserScopeGeneration;
  const scopeIsCurrent = () => scopeGeneration === chatUserScopeGeneration;
  const scopedSet: ChatStoreSet = (next) => {
    if (scopeIsCurrent()) set(next);
  };
  let currentRequest = request;
  let rotated = false;

  scopedSet({
    isStreaming: true,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [],
    error: null,
  });

  try {
    while (true) {
      const abortController = new AbortController();
      activeAiAbortController = abortController;
      const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(currentRequest.payload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw await parseChatApiError(response);
        }

        let fullContent = "";
        let finalMetadata: ChatMessageMetadata | null = null;
        let gotDone = false;
        let streamError: { message: string; code: string | null } | null = null;

        await parseSSEStream(response, {
          onTextDelta: (content) => scopedSet((state) => ({
            streamingContent: state.streamingContent + content,
          })),
          onTextClear: () => scopedSet({ streamingContent: "" }),
          onToolResult: (result) => {
            if (!scopeIsCurrent()) return;
            scopedSet((state) => ({
              streamingToolResults: [...state.streamingToolResults, result],
            }));
          },
          onSuggestions: (suggestions) => scopedSet({ suggestions }),
          onQuota: (remaining) => scopedSet({ quotaRemaining: remaining }),
          onDone: (content, metadata) => {
            fullContent = content;
            finalMetadata = metadata;
            gotDone = true;
          },
          onError: (message, code) => {
            streamError = { message, code: code ?? null };
          },
        });

        if (streamError) {
          const error = streamError as { message: string; code: string | null };
          throw new ChatApiError(error.message, 200, error.code);
        }
        if (!gotDone || !fullContent) {
          throw new Error("AI 응답 스트림이 완료되기 전에 중단되었습니다.");
        }
        if (!scopeIsCurrent()) return;

        await saveAiMessage(scopedSet, {
          coupleId: currentRequest.coupleId,
          fullContent,
          aiMetadata: finalMetadata ?? {},
          isDemo: currentRequest.isDemo,
          visibility: currentRequest.visibility,
        });


        scopedSet({ pendingAiRequest: null, error: null });
        return;
      } catch (error) {
        if (!scopeIsCurrent()) return;
        if (abortWasRequestedByUser(abortController)) {
          scopedSet({
            error: "답변 생성을 멈췄어요. 저장된 질문으로 언제든 다시 받을 수 있어요.",
            pendingAiRequest: currentRequest,
          });
          return;
        }

        const shouldRotate =
          options.rotateAfterConfirmedFailure &&
          !rotated &&
          error instanceof ChatApiError &&
          error.code === "request_failed";

        if (shouldRotate) {
          rotated = true;
          currentRequest = {
            ...currentRequest,
            payload: {
              ...currentRequest.payload,
              clientRequestId: createChatRequestId("web-retry"),
            },
          };
          scopedSet({
            streamingContent: "",
            streamingToolResults: [],
            pendingAiRequest: currentRequest,
          });
          continue;
        }

        scopedSet({
          error: friendlyAiError(error),
          pendingAiRequest: isRetryableAiError(error) ? currentRequest : null,
        });
        return;
      } finally {
        clearTimeout(fetchTimeout);
        if (activeAiAbortController === abortController) {
          activeAiAbortController = null;
        }
      }
    }
  } finally {
    scopedSet({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
  }
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingToolResults: [],
  suggestions: [],
  error: null,
  pendingAiRequest: null,
  initialLoadDone: false,
  quotaRemaining: null,
  sharedClearedAt: null,
  privateClearedAt: null,
  presence: { partnerTyping: null, aiResponding: null },

  // 메시지 로드 — 스트리밍 중이면 스킵
  loadMessages: async (coupleId: string) => {
    if (get().isStreaming) return;
    const scopeGeneration = chatUserScopeGeneration;
    const scopeIsCurrent = () => scopeGeneration === chatUserScopeGeneration;

    set((state) => ({
      isLoading: true,
      error: state.pendingAiRequest ? state.error : null,
      initialLoadDone: false,
    }));
    try {
      const supabase = createClient();

      // 본인 프로필의 view-reset timestamp 조회 (병렬)
      const [chatViewResult, { data: messagesData, error: messagesErr }] = await Promise.all([
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (!user) return { data: null, error: null };
          return readMyChatViewState(supabase);
        }),
        supabase
          .from("chat_messages")
          .select("*")
          .eq("couple_id", coupleId)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (messagesErr) throw messagesErr;
      if (chatViewResult.error || !chatViewResult.data) {
        throw chatViewResult.error ?? new Error("chat view state unavailable");
      }
      if (!scopeIsCurrent()) return;
      if (get().isStreaming) return;

      const currentState = get();
      const sharedClearedAt = latestIso(
        chatViewResult.data.shared_chat_cleared_at,
        currentState.sharedClearedAt,
        readLocalClearedAt(coupleId, "shared")
      );
      const privateClearedAt = latestIso(
        chatViewResult.data.private_chat_cleared_at,
        currentState.privateClearedAt,
        readLocalClearedAt(coupleId, "private")
      );

      const allMessages = [...(messagesData ?? [])]
        .reverse()
        .map((m) => dbRowToMessage(m as Record<string, unknown>))
        .filter(canCurrentUserSeeMessage)
        .filter((m) => {
          // 본인의 view-reset timestamp 적용
          return isAfterClearedAt(m, sharedClearedAt, privateClearedAt);
        });

      // cleared_at 도 store 에 저장 — pollNewMessages 가 활용
      set({ messages: allMessages, sharedClearedAt, privateClearedAt });
    } catch (err) {
      if (!scopeIsCurrent()) return;
      console.error("채팅 로드 에러:", err);
      set((state) => ({
        error: state.pendingAiRequest
          ? state.error ?? "저장된 질문으로 답변을 다시 받을 수 있어요."
          : "채팅을 불러오지 못했습니다.",
      }));
    } finally {
      if (scopeIsCurrent()) {
        set({ isLoading: false, initialLoadDone: true });
      }
    }
  },

  // Realtime 안전망: 마지막 메시지 이후 새 메시지만 append-fetch (폴링용)
  // - 스트리밍 중 스킵 (race condition 방지)
  // - id 기준 dedup → Realtime이 작동해도 중복 안 됨
  pollNewMessages: async (coupleId: string) => {
    const state = get();
    if (!state.initialLoadDone) return; // 최초 로드 완료 전엔 스킵
    const scopeGeneration = chatUserScopeGeneration;

    const lastMsg = state.messages[state.messages.length - 1];
    const since = lastMsg?.created_at ?? "1970-01-01T00:00:00Z";

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("couple_id", coupleId)
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50);

      if (scopeGeneration !== chatUserScopeGeneration || error || !data?.length) return;
      const fetched = data
        .map((m) => dbRowToMessage(m as Record<string, unknown>))
        .filter(canCurrentUserSeeMessage)
        .filter((m) => !get().isStreaming || m.sender_role !== "ai");
      if (fetched.length === 0) return;
      set((s) => {
        const existing = new Set(s.messages.map((m) => m.id));
        // cleared_at 이전 메시지는 무시 — "새 채팅" 후 cleared 메시지가
        // 다시 들어오는 문제 방지 (이전 사고)
        const toAdd = fetched.filter((m) => {
          if (existing.has(m.id)) return false;
          if (m.visibility === "shared" && s.sharedClearedAt) {
            if (new Date(m.created_at) <= new Date(s.sharedClearedAt)) return false;
          }
          if (isCurrentUserPrivateMessage(m) && s.privateClearedAt) {
            if (new Date(m.created_at) <= new Date(s.privateClearedAt)) return false;
          }
          return true;
        });
        if (toAdd.length === 0) return s;
        return { messages: [...s.messages, ...toAdd] };
      });
    } catch (err) {
      if (scopeGeneration !== chatUserScopeGeneration) return;
      // 폴링 실패는 silent — 다음 tick에 재시도
      if (process.env.NODE_ENV !== "production") {
        console.warn("[poll] 실패 (무시):", err);
      }
    }
  },

  sendMessage: async ({
    content,
    senderId,
    senderRole,
    coupleId,
    senderName,
    weddingContext,
    images,
    attachmentProviderConsentVersion: consentVersion,
    target = "ai",
    visibility,
  }) => {
    // 중복 발사 가드 (모바일 더블탭, 짧은 시간 내 재시도 방지)
    if (get().isStreaming) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[sendMessage] 이미 스트리밍 중 — 무시");
      }
      return false;
    }
    const scopeGeneration = chatUserScopeGeneration;
    const scopeIsCurrent = () => scopeGeneration === chatUserScopeGeneration;
    const isDemo = document.cookie.includes("demo_mode=true");
    const uniqueImages = dedupeChatAttachments(images);
    if (
      uniqueImages.length > 0 &&
      consentVersion !== attachmentProviderConsentVersion
    ) {
      set({
        error: "첨부파일의 OpenAI 전송 동의를 다시 확인해 주세요.",
        pendingAiRequest: null,
      });
      return false;
    }
    captureEvent("chat_message_sent", { target });

    // 메시지 메타데이터 (상대방에게 보내는 경우 target 표시)
    const msgMetadata = target === "partner" ? { target: "partner" as const } : null;

    // Idempotency용 UUID — 같은 sendMessage 호출의 모든 fetch (browser retry 포함)는
    // 동일한 ID를 사용. 서버는 이걸로 chat_messages dedup.
    const clientRequestId = createChatRequestId();

    // 첨부는 현재 요청에서만 OpenAI로 전송하고 Storage에는 복제하지 않는다.
    // private/account/reset 삭제 뒤 blob이 남는 lifecycle을 완성하기 전까지
    // 영구 채팅 첨부 보관은 코드상 비활성화한다.
    const finalMetadata = msgMetadata;

    // visibility 결정: 명시 없으면 senderRole 기반 추론 (private mode면 자기 role의 private)
    // 기본은 'shared' — 사용자가 명시적으로 private 모드 선택 시에만 다른 값
    const finalVisibility = visibility ?? "shared";
    let currentUserMessageId: string | null = null;

    if (!isDemo) {
      try {
        const insertResponse = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coupleId,
            content,
            target: finalMetadata?.target ?? null,
            visibility: finalVisibility,
          }),
        });
        const insertPayload = await insertResponse.json().catch(() => ({}));
        if (!scopeIsCurrent()) return false;
        const inserted = insertPayload?.message;
        if (!insertResponse.ok || !inserted || typeof inserted !== "object"
          || typeof (inserted as Record<string, unknown>).id !== "string") {
          console.error("메시지 저장 에러:", insertPayload?.error);
          set({
            error: "메시지를 저장하지 못했어요. 입력 내용과 첨부는 그대로 두었으니 다시 보내주세요.",
            pendingAiRequest: null,
          });
          return false;
        }
        currentUserMessageId = (inserted as Record<string, unknown>).id as string;

        set((state) => ({
          messages: [...state.messages, dbRowToMessage(inserted as Record<string, unknown>)],
        }));
      } catch (error) {
        if (!scopeIsCurrent()) return false;
        console.error("메시지 저장 에러:", error);
        set({
          error: "메시지를 저장하지 못했어요. 입력 내용과 첨부는 그대로 두었으니 다시 보내주세요.",
          pendingAiRequest: null,
        });
        return false;
      }
    } else {
      const demoMsg: ChatMessage = {
        id: `demo-${Date.now()}`,
        couple_id: coupleId,
        visibility: finalVisibility,
        sender_id: senderId,
        sender_role: senderRole,
        content,
        metadata: finalMetadata,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, demoMsg] }));
      set({ error: "예시 앱에서는 저장·전송 없는 샘플 상담만 볼 수 있어요." });
      return false;
    }

    // 상대방에게 보내는 메시지는 저장만 한다. 자동 갈등 판정·중재는 민감한
    // 대화의 숨은 외부 전송과 비용을 만들 수 있어 현재 베타에서 비활성이다.
    if (target === "partner") {
      return true;
    }

    // 과거 transcript는 브라우저가 보내지 않는다. 서버에 방금 저장된 메시지
    // ID만 넘기고, API가 공개범위·소유권·삭제 경계에 맞춰 정본을 재구성한다.
    if (!currentUserMessageId) {
      set({ error: "저장된 질문을 안전하게 확인하지 못했어요. 다시 보내주세요." });
      return false;
    }

    const MAX_PAYLOAD_SIZE = 3 * 1024 * 1024;
    let totalSize = 0;
    const attachmentPayload = uniqueImages.flatMap((image) => {
      const size = image.base64.length;
      if (totalSize + size > MAX_PAYLOAD_SIZE) {
        console.warn("첨부파일 크기 초과, 건너뜀:", image.mediaType);
        return [];
      }
      totalSize += size;
      return [{
        base64: image.base64,
        mediaType: image.mediaType,
        fileName: String((image as Record<string, unknown>).fileName || "file"),
      }];
    });

    const pendingRequest: PendingAiRequest = {
      coupleId,
      isDemo,
      visibility: finalVisibility,
      payload: {
        currentUserMessageId,
        coupleId,
        senderName,
        senderRole,
        weddingContext,
        isDemo,
        clientRequestId,
        visibility: finalVisibility,
        clientCapabilities: { toolCards: true, incrementalSse: true },
        ...(attachmentPayload.length > 0
          ? {
              attachments: attachmentPayload,
              attachmentProviderConsentVersion: consentVersion,
            }
          : {}),
      },
    };

    if (!scopeIsCurrent()) return false;
    set({ pendingAiRequest: pendingRequest });
    await executeAiRequest(set, get, pendingRequest, {
      rotateAfterConfirmedFailure: false,
    });
    return true;
  },

  retryAiResponse: async () => {
    const pendingRequest = get().pendingAiRequest;
    if (!pendingRequest || get().isStreaming) return;

    captureEvent("chat_ai_response_retry", {});
    await executeAiRequest(set, get, pendingRequest, {
      // 먼저 같은 ID로 replay한다. 서버가 request_failed를 명시한 경우에만
      // 새 AI 요청 ID로 전환하며, 사용자 메시지는 다시 INSERT하지 않는다.
      rotateAfterConfirmedFailure: true,
    });
  },

  cancelAiResponse: () => {
    abortActiveAiRequestByUser();
  },

  dismissAiError: () => set({ error: null, pendingAiRequest: null }),

  // 브라우저가 조립한 커플 대화를 AI에 전달하던 중재 경로는 정본 메시지 ID와
  // 양쪽의 명시적 동의 흐름이 생길 때까지 닫는다.
  requestMediation: async () => {
    set({ error: "자동 갈등 중재는 현재 제공하지 않아요. 필요한 내용은 아모라에게 직접 질문해 주세요." });
  },

  // 대화 초기화
  clearMessages: async (coupleId, mode) => {
    const scopeGeneration = chatUserScopeGeneration;
    const isDemo = document.cookie.includes("demo_mode=true");
    // 서버 응답에서 받은 clearedAt 사용 — DB·클라이언트 동기화
    let serverClearedAt: string | null = null;
    if (!isDemo) {
      const { response: res, data } = await fetchChatLifecycle({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, mode }),
      });
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : "채팅 정리에 실패했습니다.";
        if (scopeGeneration !== chatUserScopeGeneration) return;
        set({ error: message });
        throw new Error(message);
      }
      serverClearedAt = typeof data?.clearedAt === "string" ? data.clearedAt : null;
    }
    if (scopeGeneration !== chatUserScopeGeneration) return;
    const nowIso = serverClearedAt ?? new Date().toISOString();
    if (mode === "view_reset_shared" || mode === "delete_shared") {
      writeLocalClearedAt(coupleId, "shared", nowIso);
    }
    if (mode === "view_reset_private" || mode === "delete_private") {
      writeLocalClearedAt(coupleId, "private", nowIso);
    }

    // 로컬 state 업데이트 — 영향받는 메시지 제거 + cleared_at 갱신
    // (pollNewMessages 가 cleared_at 이후 메시지만 추가하도록 보장)
    set((s) => {
      const filtered = s.messages.filter((m) => {
        if (mode === "view_reset_shared" || mode === "delete_shared") {
          return m.visibility !== "shared";
        }
        if (mode === "view_reset_private" || mode === "delete_private") {
          return !isCurrentUserPrivateMessage(m);
        }
        return true;
      });
      const next: Partial<ChatStoreState> = { messages: filtered, suggestions: [] };
      if (mode === "view_reset_shared" || mode === "delete_shared") {
        next.sharedClearedAt = nowIso;
      }
      if (mode === "view_reset_private" || mode === "delete_private") {
        next.privateClearedAt = nowIso;
      }
      return next as ChatStoreState;
    });
  },

  // "둘 다 새로시작" 요청 보내기
  requestSharedClear: async (coupleId: string) => {
    try {
      const res = await fetch("/api/chat/clear-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", coupleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error ?? "요청 실패" };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "네트워크 오류" };
    }
  },

  // 받은 요청에 동의/거절
  respondToClearRequest: async (messageId: string, action: "accept" | "decline") => {
    const scopeGeneration = chatUserScopeGeneration;
    try {
      const res = await fetch("/api/chat/clear-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (scopeGeneration !== chatUserScopeGeneration) {
        return { ok: false, error: "계정이 변경되어 이전 요청 결과를 적용하지 않았습니다." };
      }
      if (!res.ok) return { ok: false, error: data?.error ?? "응답 실패" };

      // accept 의 경우 양쪽 cleared_at 이 갱신됨 — 본인 store 도 즉시 반영
      if (action === "accept" && typeof data?.clearedAt === "string") {
        const activeCoupleId = useAuthStore.getState().couple?.id;
        if (activeCoupleId) writeLocalClearedAt(activeCoupleId, "shared", data.clearedAt);
        set((s) => {
          // cleared_at 이전 shared 메시지 제거 (clear-request 메시지 자체는
          // 동일 created_at 이라 살아남음 — 카드 상태 업데이트로 표시).
          const filtered = s.messages.filter((m) => {
            if (m.visibility !== "shared") return true;
            return new Date(m.created_at) >= new Date(data.clearedAt);
          });
          return { messages: filtered, sharedClearedAt: data.clearedAt };
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "네트워크 오류" };
    }
  },

  subscribeToMessages: (coupleId: string) => {
    const scopeGeneration = chatUserScopeGeneration;
    const scopeIsCurrent = () => scopeGeneration === chatUserScopeGeneration;
    const supabase = createClient();
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let cancelled = false;
    const isDev = process.env.NODE_ENV !== "production";

    const scheduleReconnect = (reason: string) => {
      if (cancelled || retryTimeout || !scopeIsCurrent()) return;
      // 1s → 2s → 4s → 8s → max 10s 지수 백오프
      const delay = Math.min(1000 * 2 ** retryCount, 10000);
      if (isDev) {
        console.warn(`[realtime] chat:${coupleId} ${reason} → ${delay}ms 후 재연결 (attempt ${retryCount + 1})`);
      }
      retryCount++;
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        if (currentChannel) {
          supabase.removeChannel(currentChannel);
          currentChannel = null;
        }
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled || !scopeIsCurrent()) return;
      currentChannel = supabase
        .channel(`chat:${coupleId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `couple_id=eq.${coupleId}`,
          },
          (payload) => {
            if (!scopeIsCurrent()) return;
            const newMsg = dbRowToMessage(payload.new as Record<string, unknown>);
            // ID 기반 dedup만 사용 — 이전엔 isStreaming 중일 때 모든 AI 메시지를
            // 무시했는데, 그러면 동시 발화 시 파트너의 AI 응답까지 가려졌음.
            // saveAiMessage도 같은 id 기반 dedup을 사용하므로 중복 위험 없음.
            set((s) => {
              const exists = s.messages.some((m) => m.id === newMsg.id);
              if (exists) return s;
              if (!canCurrentUserSeeMessage(newMsg)) return s;
              if (
                newMsg.visibility === "shared" &&
                s.sharedClearedAt &&
                new Date(newMsg.created_at) <= new Date(s.sharedClearedAt)
              ) {
                return s;
              }
              if (
                isCurrentUserPrivateMessage(newMsg) &&
                s.privateClearedAt &&
                new Date(newMsg.created_at) <= new Date(s.privateClearedAt)
              ) {
                return s;
              }

              // 파트너의 새 메시지가 도착했다면 그의 typing indicator는 즉시 클리어
              // (이미 보냈으니까 더 이상 입력 중이 아님)
              const incomingFromPartnerTyping =
                s.presence.partnerTyping &&
                newMsg.sender_id === s.presence.partnerTyping.user_id;

              return {
                messages: [...s.messages, newMsg],
                ...(newMsg.sender_role !== "ai" ? { suggestions: [] } : {}),
                ...(incomingFromPartnerTyping
                  ? { presence: { ...s.presence, partnerTyping: null } }
                  : {}),
              };
            });
          }
        )
        // 메시지 UPDATE — clearRequest 동의/거절 변화 등을 양쪽에 즉시 반영
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chat_messages",
            filter: `couple_id=eq.${coupleId}`,
          },
          (payload) => {
            if (!scopeIsCurrent()) return;
            const updated = dbRowToMessage(payload.new as Record<string, unknown>);
            set((s) => {
              if (!canCurrentUserSeeMessage(updated)) {
                const nextMessages = s.messages.filter((m) => m.id !== updated.id);
                return nextMessages.length === s.messages.length ? s : { messages: nextMessages };
              }
              // 본인 메시지 list 갱신
              const idx = s.messages.findIndex((m) => m.id === updated.id);
              const nextMessages = idx >= 0
                ? s.messages.map((m, i) => (i === idx ? updated : m))
                : s.messages;

              // clearRequest 가 accepted 로 바뀐 케이스 — 요청자(본인) 화면에도
              // 즉시 cleared_at 적용. respondToClearRequest 호출자(=수락자)는
              // 이미 본인 store 에서 갱신했음. 여기서는 요청자 측만 처리.
              const cr = updated.metadata?.clearRequest;
              if (cr?.status === "accepted") {
                const clearedAt = updated.created_at;
                writeLocalClearedAt(coupleId, "shared", clearedAt);
                const filtered = nextMessages.filter((m) => {
                  if (m.visibility !== "shared") return true;
                  return new Date(m.created_at) >= new Date(clearedAt);
                });
                return { messages: filtered, sharedClearedAt: clearedAt };
              }
              return { messages: nextMessages };
            });
          }
        )
        // ───────── Realtime broadcast: typing + AI streaming ─────────
        .on("broadcast", { event: "typing" }, (msg) => {
          if (!scopeIsCurrent()) return;
          const p = msg.payload as
            | { sender_role: "bride" | "groom"; user_id: string; state: "start" | "stop" }
            | undefined;
          if (!p?.user_id) return;
          // 자기 자신의 typing은 무시
          const me = useAuthStore.getState().profile?.id;
          if (p.user_id === me) return;
          set((s) => ({
            presence: {
              ...s.presence,
              partnerTyping:
                p.state === "start"
                  ? { sender_role: p.sender_role, user_id: p.user_id, updated_at: Date.now() }
                  : null,
            },
          }));
        })
        // AI 응답 중 상태는 메시지 타임스탬프로 추론 (서버 broadcast 인프라 불필요)
        .subscribe((status) => {
          if (!scopeIsCurrent()) return;
          if (isDev) console.log(`[realtime] chat:${coupleId} status: ${status}`);
          if (status === "SUBSCRIBED") {
            retryCount = 0; // 재연결 성공 시 카운터 리셋
            // notifyTyping이 같은 채널 인스턴스로 send할 수 있게 등록
            if (currentChannel) activeChatChannels.set(coupleId, currentChannel);
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // 끊긴 채널은 더 이상 broadcast 못 보냄 — 레지스트리에서 제거
            activeChatChannels.delete(coupleId);
            scheduleReconnect(status);
          }
        });
    };

    connect();

    // 스테일 presence 청소 — 파트너 탭 닫혔거나 broadcast가 유실됐을 때 인디케이터가
    // 영원히 떠있는 걸 방지. 5초마다 partnerTyping의 updated_at이 5s+ 지났으면 null 처리.
    const presenceSweep = setInterval(() => {
      if (!scopeIsCurrent()) return;
      const now = Date.now();
      const pt = get().presence.partnerTyping;
      if (pt && now - pt.updated_at > 5000) {
        set((s) => ({ presence: { ...s.presence, partnerTyping: null } }));
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(presenceSweep);
      activeChatChannels.delete(coupleId);
      if (retryTimeout) clearTimeout(retryTimeout);
      if (currentChannel) supabase.removeChannel(currentChannel);
    };
  },

  // typing 브로드캐스트 — 마지막 입력 후 3초간 유지, 그 다음 자동 stop 발송.
  // 같은 채널 인스턴스로 send해야 broadcast가 도달함 → activeChatChannels에서 lookup.
  notifyTyping: (() => {
    let lastSentState: "start" | "stop" = "stop";
    let stopTimer: ReturnType<typeof setTimeout> | null = null;

    return ({ coupleId, userId, senderRole }) => {
      const sendBroadcast = (state: "start" | "stop") => {
        const channel = activeChatChannels.get(coupleId);
        // 아직 구독 전이거나 끊긴 상태 → 조용히 스킵 (다음 입력 때 다시 시도)
        if (!channel) return;
        void channel.send({
          type: "broadcast",
          event: "typing",
          payload: { sender_role: senderRole, user_id: userId, state },
        });
      };

      // 첫 입력일 때만 "start" 발송 (불필요한 broadcast 폭주 방지)
      if (lastSentState !== "start") {
        sendBroadcast("start");
        lastSentState = "start";
      }

      // 마지막 입력 후 3초 뒤 자동 stop
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        sendBroadcast("stop");
        lastSentState = "stop";
        stopTimer = null;
      }, 3000);
    };
  })(),

  reset: () => {
    chatUserScopeGeneration += 1;
    abortActiveAiRequestByUser();
    activeAiAbortController = null;
    set({
      messages: [],
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      pendingAiRequest: null,
      initialLoadDone: false,
      quotaRemaining: null,
      sharedClearedAt: null,
      privateClearedAt: null,
      presence: { partnerTyping: null, aiResponding: null },
    });
  },
}));
