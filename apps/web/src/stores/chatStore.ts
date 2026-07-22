"use client";

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { captureEvent } from "@/lib/analytics";
import { prepareChatAttachmentPayload } from "@/lib/chat/attachments";
import { resolveMonotonicSharedClearCursor } from "@/lib/chat/clearCursor";

/**
 * coupleId당 활성 Realtime 채널 레지스트리.
 * subscribeToMessages가 채널을 구독한 뒤 여기에 등록 → notifyTyping이
 * 같은 채널 인스턴스로 broadcast 송신 (별개 채널 인스턴스는 send 안 됨).
 */
const activeChatChannels = new Map<string, RealtimeChannel>();
let chatLifecycleEpoch = 0;
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
  ChatMessageTarget,
} from "@/types/database.types";
import type { SSEEvent, WeddingContext } from "@/types/chat.types";
import { determineStage } from "@/lib/ai/stage-router";
import {
  EPHEMERAL_PLACE_SEARCH_TOOL,
  getPersistableToolResults,
} from "@/lib/ai/placeSearchResultPolicy";
import type { AmoraActionItem } from "@/lib/amora/actions";
import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";
import { useAuthStore } from "./authStore";

type ClearScope = "shared" | "private";

function createClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("안전한 요청 식별자를 만들 수 없습니다.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

type ChatVisibility = "shared" | "bride_private" | "groom_private";

export interface FailedChatRequest {
  /** Client idempotency key. Reused verbatim for provider-only retry. */
  clientRequestId: string;
  /** Durable user row id issued by the server/database; never INSERTed again. */
  userMessageId: string | null;
  coupleId: string;
  content: string;
  visibility: ChatVisibility;
  /** Exact explicit action confirmation, if this request came from an action card. */
  confirmedActionId: string | null;
  attachmentCount: number;
  canRetry: boolean;
  unavailableReason: string | null;
  /** Immutable JSON snapshot, including safe base64 attachment copies. */
  requestBody: string;
  isDemo: boolean;
}

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;
  initialLoadDone: boolean;

  /** 베타 무료 상담 잔여 횟수 — 임계 이하일 때만 서버가 알려줌(소진 예고 배너용). */
  quotaRemaining: number | null;

  /** Last provider request that failed after the user message was accepted. */
  failedRequest: FailedChatRequest | null;
  /** Synchronous persistence/upload lock, set before the first await. */
  isSending: boolean;
  isRetrying: boolean;

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
    images?: Array<{ base64: string; mediaType: string; previewUrl: string; fileName?: string }>;
    target?: ChatMessageTarget;
    visibility?: "shared" | "bride_private" | "groom_private";
    confirmedActionId?: string;
  }) => Promise<void>;
  retryFailedMessage: () => Promise<void>;
  dismissFailedMessageRetry: () => void;
  requestInitialGreeting: (params: {
    coupleId: string;
    senderRole: MessageSenderRole;
    senderName: string;
    weddingContext: WeddingContext;
  }) => Promise<void>;
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

// 일정/예산/예약 등 journey.progress 를 변경하는 tool 들 — 처리 후 백엔드와
// sync 가 누락된 케이스 대비 refreshJourney 트리거.
const PROGRESS_AFFECTING_TOOLS = new Set<string>(MUTATING_TOOL_NAMES);

// 도구 결과를 authStore에 반영
function syncToolResult(result: ToolExecutionResult) {
  if (!result.success) return;
  const authStore = useAuthStore.getState();

  switch (result.toolName) {
    case "update_budget":
      authStore.updateJourneyLocal({
        total_budget: result.toolOutput.total_budget as number,
      });
      break;
    case "update_wedding_date":
      authStore.updateJourneyLocal({
        wedding_date: result.toolOutput.wedding_date as string,
      });
      break;
    case "update_task_status": {
      const category = result.toolInput.category as string;
      const status = result.toolInput.status as string;
      const currentProgress = authStore.journey?.progress ?? {};
      authStore.updateJourneyLocal({
        progress: {
          ...currentProgress,
          [category]: { category, status } as { category: string; status: "not_started" | "in_progress" | "completed" },
        },
      });
      break;
    }
    case "update_venue":
      authStore.updateJourneyLocal({
        venue: result.toolOutput.venue as string,
      });
      break;
    case "update_category_budget": {
      const catBudget = result.toolInput.category as string;
      const curProgressBudget = authStore.journey?.progress ?? {};
      const existingCatBudget = curProgressBudget[catBudget];
      const budgetUpdates: Record<string, unknown> = {};
      if (result.toolInput.budget !== undefined) budgetUpdates.budget = result.toolInput.budget;
      if (result.toolInput.spent !== undefined) budgetUpdates.spent = result.toolInput.spent;
      authStore.updateJourneyLocal({
        progress: {
          ...curProgressBudget,
          [catBudget]: {
            ...(existingCatBudget ?? { category: catBudget, status: "not_started" }),
            category: catBudget,
            ...budgetUpdates,
          },
        },
      });
      break;
    }
    case "apply_budget_plan": {
      // 예산 인터뷰 결과 일괄 반영 — total_budget + 모든 allocations 의 budget 필드 갱신.
      // 서버 executor 는 잔여분을 reserve 로 자동 보강하므로 input.allocations 외에 reserve 도
      // 별도로 검사. toolOutput.remainder_to_reserve 가 있으면 reserve 카테고리에 추가 가산.
      const totalBudget = result.toolOutput.total_budget as number | undefined;
      const allocations = (result.toolInput.allocations ?? []) as Array<{
        category: string;
        budget: number;
      }>;
      const remainder = (result.toolOutput.remainder_to_reserve as number | undefined) ?? 0;
      const curProgress = authStore.journey?.progress ?? {};
      const nextProgress: Record<string, unknown> = { ...curProgress };
      for (const alloc of allocations) {
        const existing = (nextProgress[alloc.category] ?? {
          category: alloc.category,
          status: "not_started",
        }) as Record<string, unknown>;
        nextProgress[alloc.category] = {
          ...existing,
          category: alloc.category,
          budget: alloc.budget,
        };
      }
      // 잔여분이 reserve 로 자동 추가됐다면 그것도 반영
      if (remainder > 0) {
        const reserveExisting = (nextProgress.reserve ?? {
          category: "reserve",
          status: "not_started",
        }) as Record<string, unknown>;
        const reserveAllocated = allocations.find((a) => a.category === "reserve")?.budget ?? 0;
        nextProgress.reserve = {
          ...reserveExisting,
          category: "reserve",
          budget: reserveAllocated + remainder,
        };
      }
      authStore.updateJourneyLocal({
        ...(totalBudget !== undefined ? { total_budget: totalBudget } : {}),
        progress: nextProgress as typeof curProgress,
      });
      break;
    }
    case "add_custom_category": {
      const customKey = result.toolOutput.key as string;
      const customLabel = result.toolInput.label as string;
      const curProgressCustom = authStore.journey?.progress ?? {};
      const customCatItem: { category: string; label: string; status: "in_progress"; budget?: number; spent?: number } = {
        category: customKey,
        label: customLabel,
        status: "in_progress",
      };
      if (result.toolInput.budget !== undefined) customCatItem.budget = result.toolInput.budget as number;
      if (result.toolInput.spent !== undefined) customCatItem.spent = result.toolInput.spent as number;
      authStore.updateJourneyLocal({
        progress: {
          ...curProgressCustom,
          [customKey]: customCatItem,
        },
      });
      break;
    }
    case "delete_category": {
      if (!result.success) break;
      const delKey = result.toolOutput.key as string;
      const curProgressDel = authStore.journey?.progress ?? {};
      const isKnownDel = delKey in (curProgressDel as Record<string, unknown>) || ["meeting","venue","studio","dress","makeup","ring","hanbok","yedan","honeymoon","houseware","housing","invitation","snap","shoes","bouquet","gift","mc","ham","pyebaek","reserve"].includes(delKey);
      if (isKnownDel) {
        const hiddenDel: string[] = ((curProgressDel as Record<string, unknown>).__hidden as string[]) ?? [];
        const restDel = { ...(curProgressDel as Record<string, unknown>) };
        delete restDel[delKey];
        authStore.updateJourneyLocal({
          progress: { ...restDel, __hidden: [...hiddenDel, delKey] } as unknown as typeof curProgressDel,
        });
      } else {
        const restDel = { ...(curProgressDel as Record<string, unknown>) };
        delete restDel[delKey];
        authStore.updateJourneyLocal({ progress: restDel as typeof curProgressDel });
      }
      break;
    }
    case "reset_category": {
      if (!result.success) break;
      const resetKey = result.toolOutput.key as string;
      const curProgressReset = authStore.journey?.progress ?? {};
      const restReset = { ...(curProgressReset as Record<string, unknown>) };
      delete restReset[resetKey];
      authStore.updateJourneyLocal({ progress: restReset as typeof curProgressReset });
      break;
    }
    case "add_schedule_event":
    case "log_wedding_event": {
      const currentP1 = authStore.journey?.progress ?? {};
      const curEvents1 = ((currentP1 as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
      const newEvt = result.toolOutput.event as { id: string } | undefined;
      if (!newEvt?.id) break;
      const hasEvent = curEvents1.some((event) => event.id === newEvt.id);
      authStore.updateJourneyLocal({
        progress: {
          ...currentP1,
          __events: hasEvent
            ? curEvents1.map((event) => event.id === newEvt.id ? newEvt : event)
            : [...curEvents1, newEvt],
        } as unknown as typeof currentP1,
      });
      break;
    }
    case "update_schedule_event": {
      const currentP2 = authStore.journey?.progress ?? {};
      const curEvents2 = ((currentP2 as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
      const evtId2 = result.toolInput.event_id as string;
      const evtUpdates = result.toolOutput.updates as Record<string, unknown>;
      authStore.updateJourneyLocal({
        progress: {
          ...currentP2,
          __events: curEvents2.map((e) => e.id === evtId2 ? { ...e, ...evtUpdates, updatedAt: new Date().toISOString() } : e),
        } as unknown as typeof currentP2,
      });
      break;
    }
    case "delete_schedule_event": {
      const currentP3 = authStore.journey?.progress ?? {};
      const curEvents3 = ((currentP3 as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
      const evtId3 = result.toolInput.event_id as string;
      authStore.updateJourneyLocal({
        progress: {
          ...currentP3,
          __events: curEvents3.filter((e) => e.id !== evtId3),
        } as unknown as typeof currentP3,
      });
      break;
    }
    case "toggle_checklist_item": {
      const currentP4 = authStore.journey?.progress ?? {};
      const cat = result.toolInput.category as string;
      const iId = result.toolInput.item_id as string;
      const doneVal = result.toolInput.done as boolean;
      const newStat = result.toolOutput.new_status as string;
      const existingCat = currentP4[cat];
      const cl = (existingCat?.checklist ?? []).map((c: { id: string; label: string; done: boolean }) =>
        c.id === iId ? { ...c, done: doneVal } : c
      );
      authStore.updateJourneyLocal({
        progress: {
          ...currentP4,
          [cat]: { ...(existingCat ?? { category: cat }), category: cat, status: newStat as "not_started" | "in_progress" | "completed", checklist: cl },
        },
      });
      break;
    }
    case "add_amora_action": {
      const currentProgress = authStore.journey?.progress ?? {};
      const currentActions = ((currentProgress as Record<string, unknown>).__amora_actions ?? []) as AmoraActionItem[];
      const action = result.toolOutput.action as AmoraActionItem | undefined;
      if (!action) break;
      authStore.updateJourneyLocal({
        progress: {
          ...currentProgress,
          __amora_actions: [action, ...currentActions.filter((item) => item.id !== action.id)],
        } as unknown as typeof currentProgress,
      });
      break;
    }
    case "update_amora_action": {
      const currentProgress = authStore.journey?.progress ?? {};
      const currentActions = ((currentProgress as Record<string, unknown>).__amora_actions ?? []) as AmoraActionItem[];
      const action = result.toolOutput.action as AmoraActionItem | undefined;
      if (!action) break;
      authStore.updateJourneyLocal({
        progress: {
          ...currentProgress,
          __amora_actions: currentActions.map((item) => item.id === action.id ? action : item),
        } as unknown as typeof currentProgress,
      });
      break;
    }
    case "create_booking": {
      // 예약 성공 시 server 가 wedding_journeys.progress 에 event 추가 + spent 누적.
      // client authStore 도 같이 갱신 안 하면 /schedule, /budget 페이지가 새로고침
      // 전까지 stale. toolOutput 에 syncedEvent / syncedCategoryKey / syncedNewSpent
      // 가 server commit 성공 시 채워져 옴 — 그대로 merge.
      if (!result.success) break;
      const syncedEvent = result.toolOutput.syncedEvent as
        | { id: string; date: string; title: string; memo?: string; categoryKey?: string; createdAt: string; updatedAt: string }
        | null
        | undefined;
      const syncedCategoryKey = result.toolOutput.syncedCategoryKey as string | null | undefined;
      const syncedNewSpent = result.toolOutput.syncedNewSpent as number | null | undefined;
      if (!syncedEvent && !syncedCategoryKey) break;

      const currentProgress = authStore.journey?.progress ?? {};
      const nextProgress: Record<string, unknown> = { ...currentProgress };

      // 1) __events 에 새 event 추가 (id 로 중복 방지 — 같은 booking 두 번 들어가지 않게)
      if (syncedEvent) {
        const events = ((nextProgress as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
        if (!events.some((e) => e.id === syncedEvent.id)) {
          (nextProgress as Record<string, unknown>).__events = [...events, syncedEvent];
        }
      }

      // 2) 카테고리 spent 갱신 (server 가 누적한 최종값 그대로 덮어쓰기)
      if (syncedCategoryKey && typeof syncedNewSpent === "number") {
        const existingCat = (nextProgress[syncedCategoryKey] ?? {
          category: syncedCategoryKey,
          status: "not_started",
        }) as Record<string, unknown>;
        nextProgress[syncedCategoryKey] = {
          ...existingCat,
          category: syncedCategoryKey,
          spent: syncedNewSpent,
        };
      }

      authStore.updateJourneyLocal({
        progress: nextProgress as typeof currentProgress,
      });
      break;
    }
    case "cancel_booking": {
      // create_booking 의 역연산 — server 가 progress 에서 event 제거 + spent 차감.
      // toolOutput 에 syncedEventIdRemoved / syncedCategoryKey / syncedNewSpent 가
      // server commit 성공 시 채워져 옴.
      if (!result.success) break;
      const eventIdRemoved = result.toolOutput.syncedEventIdRemoved as string | null | undefined;
      const cancelCategoryKey = result.toolOutput.syncedCategoryKey as string | null | undefined;
      const cancelNewSpent = result.toolOutput.syncedNewSpent as number | null | undefined;
      if (!eventIdRemoved && !cancelCategoryKey) break;

      const cancelCurrent = authStore.journey?.progress ?? {};
      const cancelNext: Record<string, unknown> = { ...cancelCurrent };

      // 1) __events 에서 해당 booking event 제거
      if (eventIdRemoved) {
        const events = ((cancelNext as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
        (cancelNext as Record<string, unknown>).__events = events.filter((e) => e.id !== eventIdRemoved);
      }

      // 2) 카테고리 spent 를 server 가 차감한 최종값으로 덮어쓰기
      if (cancelCategoryKey && typeof cancelNewSpent === "number") {
        const existingCat = (cancelNext[cancelCategoryKey] ?? {
          category: cancelCategoryKey,
          status: "not_started",
        }) as Record<string, unknown>;
        cancelNext[cancelCategoryKey] = {
          ...existingCat,
          category: cancelCategoryKey,
          spent: cancelNewSpent,
        };
      }

      authStore.updateJourneyLocal({
        progress: cancelNext as typeof cancelCurrent,
      });
      break;
    }
  }
}

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
    onError: (message: string) => void;
  }
) {
  if (!res.body) throw new Error("AI 응답 스트림이 비어 있습니다.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlock = (block: string): boolean => {
    const dataLines = block
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) return false;

    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return false;

    try {
      const event: SSEEvent = JSON.parse(data);
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
          if (
            Number.isInteger(event.remaining)
            && event.remaining >= 0
          ) {
            callbacks.onQuota?.(event.remaining);
          }
          break;
        case "done":
          callbacks.onDone(event.fullContent, event.metadata);
          return true;
        case "error":
          // A failed draft must disappear before the user sees the error. Do this in
          // the parser as a client-side invariant even if the server also sends
          // text_clear, so older servers/proxies cannot leave stale prose behind.
          callbacks.onTextClear?.();
          callbacks.onError(event.message);
          return true;
      }
    } catch (e) {
      console.warn("SSE 파싱 실패:", e);
    }
    return false;
  };

  const consumeCompleteBlocks = (): boolean => {
    while (buffer.length > 0) {
      const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
      if (!boundary || boundary.index === undefined) return false;
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      if (consumeBlock(block)) return true;
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) consumeBlock(buffer);
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    if (consumeCompleteBlocks()) {
      await reader.cancel().catch(() => undefined);
      return;
    }
  }
}

// DB row → 내부 ChatMessage 변환 (sender_type → sender_role)
function dbRowToMessage(row: Record<string, unknown>): ChatMessage {
  const rawVisibility = row.visibility;
  const visibility: ChatMessage["visibility"] =
    rawVisibility === "bride_private" || rawVisibility === "groom_private" ? rawVisibility : "shared";
  const rawMetadata = (row.metadata as ChatMessageMetadata) ?? null;
  const metadata = rawMetadata ? { ...rawMetadata } : null;
  if (metadata?.toolResults) {
    const persistableResults = getPersistableToolResults(metadata.toolResults);
    if (persistableResults.length > 0) metadata.toolResults = persistableResults;
    else delete metadata.toolResults;
  }
  return {
    id: row.id as string,
    couple_id: row.couple_id as string,
    sender_id: (row.sender_id as string) ?? null,
    sender_role: (row.sender_type as MessageSenderRole) ?? (row.sender_role as MessageSenderRole) ?? "ai",
    content: row.content as string,
    metadata,
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
      if (exists) {
        return {
          messages: s.messages.map((message) =>
            message.id === serverMessageId
              ? { ...message, content: fullContent, metadata: aiMetadata }
              : message
          ),
        };
      }
      return { messages: [...s.messages, localMsg] };
    });
    return;
  }

  // 2) 서버 저장 실패 또는 demo 모드 — 로컬 메시지만 유지
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

  // serverMessageId가 없으면 서버 저장이 실패한 것입니다. 인증 클라이언트가
  // AI/assistant DB 행을 만들 수 없도록 재시도 INSERT는 하지 않습니다.
  void isDemo;
}

type ChatStoreSet = (
  update: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)
) => void;

const ATTACHMENT_RETRY_UNAVAILABLE =
  "첨부 원본을 안전하게 다시 사용할 수 없어 자동 재시도할 수 없어요. 파일을 다시 첨부해 새 메시지로 보내주세요.";
const PERMANENT_REQUEST_RETRY_UNAVAILABLE =
  "같은 요청을 다시 보내도 해결되지 않아요. 입력이나 첨부파일을 확인한 뒤 새 메시지로 보내주세요.";
const EXPLICIT_ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ChatProviderRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly unavailableReason: string | null = null,
  ) {
    super(message);
    this.name = "ChatProviderRequestError";
  }
}

function parseChatHttpError(text: string): { message: string | null; code: string | null } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { message: null, code: null };
    }
    const record = value as Record<string, unknown>;
    return {
      message: typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : null,
      code: typeof record.code === "string" && record.code.trim()
        ? record.code.trim()
        : null,
    };
  } catch {
    return { message: null, code: null };
  }
}

function isRetryableChatHttpError(status: number, code: string | null): boolean {
  if (status >= 500 || status === 408 || status === 425 || status === 429) return true;
  if (status !== 409) return false;
  return code === "CHAT_REQUEST_IN_PROGRESS"
    || code === "USER_MESSAGE_NOT_PERSISTED";
}

function withRetryAvailability(
  request: FailedChatRequest,
  retryable: boolean,
  unavailableReason: string | null,
): FailedChatRequest {
  if (retryable) return request;
  // Permanent failures must not retain a useless base64/document snapshot in
  // memory. The durable user row remains visible and the user can send a new,
  // corrected request.
  return {
    ...request,
    attachmentCount: 0,
    canRetry: false,
    unavailableReason: unavailableReason ?? PERMANENT_REQUEST_RETRY_UNAVAILABLE,
    requestBody: "",
  };
}

/**
 * Runs only the provider phase. The immutable request body already contains the
 * original client request id and durable user-message id, so this function must
 * never write another user row.
 */
async function executeChatProviderRequest(
  set: ChatStoreSet,
  get: () => ChatStoreState,
  request: FailedChatRequest,
  retrying: boolean
): Promise<void> {
  if (get().isStreaming) return;
  const lifecycleEpoch = chatLifecycleEpoch;
  const isCurrentLifecycle = () => lifecycleEpoch === chatLifecycleEpoch;

  set({
    isStreaming: true,
    isRetrying: retrying,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [],
    error: null,
    quotaRemaining: null,
  });

  const abortController = new AbortController();
  const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request.requestBody,
      signal: abortController.signal,
    });
    if (!isCurrentLifecycle()) return;

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("AI API 에러:", res.status, errText);
      const parsed = parseChatHttpError(errText);
      const retryable = isRetryableChatHttpError(res.status, parsed.code);
      const fallbackMessage = res.status === 429
        ? "지금은 잠시 쉬어가고 있어요. 잠시 후 다시 시도해주세요."
        : retryable
          ? "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요."
          : "요청 내용을 처리할 수 없어요. 입력이나 첨부파일을 확인해주세요.";
      throw new ChatProviderRequestError(
        parsed.message ?? fallbackMessage,
        retryable,
        retryable ? null : PERMANENT_REQUEST_RETRY_UNAVAILABLE,
      );
    }

    let fullContent = "";
    let finalMetadata: ChatMessageMetadata | null = null;
    let gotDone = false;
    let progressTouched = false;

    await parseSSEStream(res, {
      onTextDelta: (content) => {
        if (!isCurrentLifecycle()) return;
        set((state) => ({ streamingContent: state.streamingContent + content }));
      },
      onTextClear: () => {
        if (isCurrentLifecycle()) set({ streamingContent: "" });
      },
      onToolResult: (result) => {
        if (!isCurrentLifecycle()) return;
        syncToolResult(result);
        if (PROGRESS_AFFECTING_TOOLS.has(result.toolName) && result.success) {
          progressTouched = true;
        }
        set((state) => ({
          streamingToolResults: [...state.streamingToolResults, result],
        }));
      },
      onSuggestions: (nextSuggestions) => {
        if (isCurrentLifecycle()) set({ suggestions: nextSuggestions });
      },
      onQuota: (remaining) => {
        if (isCurrentLifecycle()) set({ quotaRemaining: remaining });
      },
      onDone: (content, metadata) => {
        if (!isCurrentLifecycle()) return;
        fullContent = content;
        finalMetadata = metadata;
        gotDone = true;
      },
      onError: (message) => {
        if (isCurrentLifecycle()) set({ error: message });
      },
    });
    if (!isCurrentLifecycle()) return;

    const completedToolResults = get().streamingToolResults;
    if (completedToolResults.length === 0 && (!gotDone || !fullContent.trim())) {
      set({
        failedRequest: request,
        error: get().error ?? "AI 응답이 중단되었습니다. 다시 시도해주세요.",
        streamingContent: "",
      });
      return;
    }

    const completedMetadata = finalMetadata as ChatMessageMetadata | null;
    const ephemeralPlaceResults = completedToolResults.filter(
      (result) => result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL
    );
    const aiMetadata: ChatMessageMetadata = {
      ...(completedMetadata ?? {}),
      ...(ephemeralPlaceResults.length > 0
        ? {
            toolResults: [
              ...((completedMetadata?.toolResults ?? []).filter(
                (result) => result.toolName !== EPHEMERAL_PLACE_SEARCH_TOOL
              )),
              ...ephemeralPlaceResults,
            ],
          }
        : {}),
    };
    await saveAiMessage(set, {
      coupleId: request.coupleId,
      fullContent,
      aiMetadata,
      isDemo: request.isDemo,
      visibility: request.visibility,
    });

    if (progressTouched) {
      await useAuthStore.getState().refreshJourney();
    }

    set({ failedRequest: null, error: null });
  } catch (err) {
    if (!isCurrentLifecycle()) return;
    console.error("AI 응답 에러:", err);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const requestError = err instanceof ChatProviderRequestError ? err : null;
    set({
      failedRequest: withRetryAvailability(
        request,
        requestError?.retryable ?? true,
        requestError?.unavailableReason ?? null,
      ),
      error: isAbort
        ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
        : requestError
          ? requestError.message
          : "AI 응답을 받지 못했습니다.",
      streamingContent: "",
    });
  } finally {
    clearTimeout(fetchTimeout);
    if (isCurrentLifecycle()) {
      set({
        isStreaming: false,
        isRetrying: false,
        streamingContent: "",
        streamingToolResults: [],
      });
    }
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
  initialLoadDone: false,
  quotaRemaining: null,
  failedRequest: null,
  isSending: false,
  isRetrying: false,
  sharedClearedAt: null,
  privateClearedAt: null,
  presence: { partnerTyping: null, aiResponding: null },

  // 메시지 로드 — 스트리밍 중이면 스킵
  loadMessages: async (coupleId: string) => {
    if (get().isStreaming) return;

    set({ isLoading: true, error: null, initialLoadDone: false });
    try {
      const supabase = createClient();

      // 본인 프로필의 view-reset timestamp 조회 (병렬)
      const [{ data: profileData }, { data: messagesData, error: messagesErr }] = await Promise.all([
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (!user) return { data: null };
          return supabase
            .from("my_profile_chat_state")
            .select("shared_chat_cleared_at, private_chat_cleared_at")
            .eq("id", user.id)
            .single();
        }),
        supabase
          .from("chat_messages")
          .select("*")
          .eq("couple_id", coupleId)
          .order("created_at", { ascending: true })
          .limit(500),
      ]);

      if (messagesErr) throw messagesErr;
      if (get().isStreaming) return;

      const currentState = get();
      const sharedClearedAt = latestIso(
        (profileData as { shared_chat_cleared_at?: string | null })?.shared_chat_cleared_at,
        currentState.sharedClearedAt,
        readLocalClearedAt(coupleId, "shared")
      );
      const privateClearedAt = latestIso(
        (profileData as { private_chat_cleared_at?: string | null })?.private_chat_cleared_at,
        currentState.privateClearedAt,
        readLocalClearedAt(coupleId, "private")
      );

      const allMessages = (messagesData ?? [])
        .map((m) => dbRowToMessage(m as Record<string, unknown>))
        .filter(canCurrentUserSeeMessage)
        .filter((m) => {
          // 본인의 view-reset timestamp 적용
          return isAfterClearedAt(m, sharedClearedAt, privateClearedAt);
        });

      // cleared_at 도 store 에 저장 — pollNewMessages 가 활용
      set({ messages: allMessages, sharedClearedAt, privateClearedAt });
    } catch (err) {
      console.error("채팅 로드 에러:", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      set({ isLoading: false, initialLoadDone: true });
    }
  },

  // Realtime 안전망: 마지막 메시지 이후 새 메시지만 append-fetch (폴링용)
  // - 스트리밍 중 스킵 (race condition 방지)
  // - id 기준 dedup → Realtime이 작동해도 중복 안 됨
  pollNewMessages: async (coupleId: string) => {
    const state = get();
    if (!state.initialLoadDone) return; // 최초 로드 완료 전엔 스킵

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

      if (error || !data?.length) return;
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
      // 폴링 실패는 silent — 다음 tick에 재시도
      if (process.env.NODE_ENV !== "production") {
        console.warn("[poll] 실패 (무시):", err);
      }
    }
  },

  sendMessage: async ({
    content, senderId, senderRole, coupleId, senderName, weddingContext, images, target = "ai", visibility,
    confirmedActionId,
  }) => {
    // 중복 발사 가드 (모바일 더블탭, 짧은 시간 내 재시도 방지)
    if (get().isStreaming || get().isSending) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[sendMessage] 이미 스트리밍 중 — 무시");
      }
      return;
    }
    if (
      confirmedActionId !== undefined
      && (
        !EXPLICIT_ACTION_ID_PATTERN.test(confirmedActionId)
        || target !== "ai"
        || (visibility ?? "shared") !== "shared"
      )
    ) {
      set({ error: "이 변경 확인 요청은 사용할 수 없어요. 아모라에게 다시 제안해 달라고 해주세요." });
      return;
    }
    const preparedAttachments = prepareChatAttachmentPayload(images);
    if (!preparedAttachments.ok) {
      set({ error: preparedAttachments.error });
      return;
    }
    const uniqueImages = preparedAttachments.attachments;
    set({ isSending: true });

    try {

    // A genuinely new send supersedes any old provider-only retry material.
    set({ failedRequest: null, isRetrying: false, error: null });
    captureEvent("chat_message_sent", { target });

    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");

    // 메시지 메타데이터 (상대방에게 보내는 경우 target 표시)
    const msgMetadata = target === "partner" ? { target: "partner" as const } : null;

    // Idempotency용 UUID — 같은 sendMessage 호출의 모든 fetch (browser retry 포함)는
    // 동일한 ID를 사용. 서버는 이걸로 chat_messages dedup.
    const clientRequestId = createClientRequestId();
    let persistedUserMessageId: string | null = null;

    // 이미지를 Supabase Storage에 업로드 시도 (채팅 기록 표시용)
    const imagePaths: string[] = [];
    if (uniqueImages.length > 0 && !isDemo) {
      for (const img of uniqueImages) {
        try {
          const ext = img.mediaType.split("/")[1] || "jpg";
          const fileName = `${coupleId}/${senderId}/${createClientRequestId()}.${ext}`;
          const byteChars = atob(img.base64);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: img.mediaType });
          const { error: uploadErr } = await supabase.storage
            .from("chat-image")
            .upload(fileName, blob, { contentType: img.mediaType });
          if (!uploadErr) {
            imagePaths.push(fileName);
          } else {
            console.warn("Storage 업로드 실패 (무시):", uploadErr.message);
          }
        } catch (err) {
          console.warn("Storage 업로드 에러 (무시):", err);
        }
      }
    }

    // 이미지 storage path가 있으면 메타데이터에 추가
    const finalMetadata = imagePaths.length > 0
      ? { ...msgMetadata, imagePaths }
      : msgMetadata;

    // visibility 결정: 명시 없으면 senderRole 기반 추론 (private mode면 자기 role의 private)
    // 기본은 'shared' — 사용자가 명시적으로 private 모드 선택 시에만 다른 값
    const finalVisibility = visibility ?? "shared";

    if (!isDemo) {
      // D3: 클라이언트 측 stage_tag 계산 (wedding_date 기반 순수 함수)
      const userStageTag = determineStage(weddingContext?.weddingDate ?? null);

      const { data: inserted, error: insertErr } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: senderId,
          sender_type: senderRole,
          role: "user",
          content,
          metadata: finalMetadata,
          stage_tag: userStageTag,
          visibility: finalVisibility,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("메시지 저장 에러:", insertErr);
        set({ error: "메시지 전송에 실패했습니다." });
        return;
      }
      persistedUserMessageId = inserted.id as string;

      set((s) => ({
        messages: [...s.messages, dbRowToMessage(inserted as Record<string, unknown>)],
      }));
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
    }

    // 상대방에게 보내는 메시지는 명시적 커플 동의 없이 AI 제공자에게
    // 전달하지 않는다. 자동 중재는 별도 동의 계약/UI가 준비될 때까지 중단한다.
    if (target === "partner") {
      return;
    }

    // 프라이버시 critical: visibility별로 컨텍스트 격리. This snapshot is
    // serialized once and reused byte-for-byte if the provider phase fails.
    const allMessages = get().messages;
    const scopedMessages =
      finalVisibility === "shared"
        ? allMessages.filter((message) => message.visibility === "shared")
        : allMessages.filter(
            (message) => message.visibility === "shared" || message.visibility === finalVisibility
          );
    const recentMessages = scopedMessages.slice(-20).map((message) => {
      if (message.sender_role === "ai") {
        return { role: "assistant" as const, content: message.content };
      }
      const roleLabel = message.sender_role === "bride" ? "신부" : "신랑";
      const isPartner = message.metadata?.target === "partner";
      const prefix = isPartner ? `[${roleLabel}→상대방]` : `[${roleLabel}]`;
      return { role: "user" as const, content: `${prefix} ${message.content}` };
    });

    // The primitive-only snapshot was validated before any side effect.
    const attachmentPayload = uniqueImages;

    let requestBody: string;
    try {
      requestBody = JSON.stringify({
        messages: recentMessages,
        coupleId,
        senderName,
        senderRole,
        weddingContext,
        isDemo,
        clientRequestId,
        ...(persistedUserMessageId ? { userMessageId: persistedUserMessageId } : {}),
        visibility: finalVisibility,
        ...(confirmedActionId !== undefined ? { confirmedActionId } : {}),
        ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
      });
    } catch (error) {
      console.error("AI 요청 직렬화 에러:", error);
      set({ error: "요청 정보를 안전하게 준비하지 못했습니다. 새 메시지로 다시 보내주세요." });
      return;
    }

    const failedRequest: FailedChatRequest = {
      clientRequestId,
      userMessageId: persistedUserMessageId,
      coupleId,
      content,
      visibility: finalVisibility,
      confirmedActionId: confirmedActionId ?? null,
      attachmentCount: uniqueImages.length,
      canRetry: true,
      unavailableReason: null,
      requestBody,
      isDemo,
    };

    await executeChatProviderRequest(set, get, failedRequest, false);
    } finally {
      set({ isSending: false });
    }
  },

  retryFailedMessage: async () => {
    const state = get();
    if (state.isStreaming || state.isRetrying || !state.failedRequest) return;
    if (!state.failedRequest.canRetry) {
      set({ error: state.failedRequest.unavailableReason ?? ATTACHMENT_RETRY_UNAVAILABLE });
      return;
    }
    await executeChatProviderRequest(set, get, state.failedRequest, true);
  },

  dismissFailedMessageRetry: () => {
    if (get().isStreaming || get().isRetrying) return;
    set({ failedRequest: null, error: null });
  },

  // 첫 진입 시 AI 인사 (타임아웃 + gotDone 체크 추가)
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    if (get().isStreaming) return;

    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      quotaRemaining: null,
      failedRequest: null,
      isSending: false,
      isRetrying: false,
    });

    // 180초 타임아웃
    const abortController = new AbortController();
    const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

    try {
      const roleLabel = senderRole === "bride" ? "신부" : "신랑";
      const isDemo = document.cookie.includes("demo_mode=true");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `[${roleLabel}] [INITIAL_GREETING]` }],
          coupleId,
          senderName,
          senderRole,
          weddingContext,
          isDemo,
          requestKind: "initial_greeting",
        }),
        signal: abortController.signal,
      });

      clearTimeout(fetchTimeout);

      if (!res.ok) throw new Error("AI 초기 인사 실패");

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;
      let gotDone = false;

      await parseSSEStream(res, {
        onTextDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
        onTextClear: () => set({ streamingContent: "" }),
        onToolResult: (result) => {
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => set({ suggestions: sug }),
        onQuota: (remaining) => set({ quotaRemaining: remaining }),
        onDone: (fc, meta) => { fullContent = fc; finalMetadata = meta; gotDone = true; },
        onError: (msg) => set({ error: msg }),
      });

      // 스트림이 done 없이 끊긴 경우 에러 표시
      if (!gotDone && !fullContent && !get().error) {
        set({ error: "AI 응답이 중단되었습니다. 다시 시도해주세요." });
      }

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = finalMetadata ?? {};
        const isDemo = document.cookie.includes("demo_mode=true");
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
      }
    } catch (err) {
      console.error("초기 인사 에러:", err);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      set({
        error: isAbort
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : "AI 연결에 실패했습니다. 새로고침 해주세요.",
      });
    } finally {
      clearTimeout(fetchTimeout);
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 갈등 중재: 커플 대화 중 아모라가 자동 개입
  requestMediation: async ({ coupleId, senderRole, senderName, weddingContext, conflictContext }) => {
    if (get().isStreaming) return;

    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      quotaRemaining: null,
      failedRequest: null,
      isRetrying: false,
    });

    const abortController = new AbortController();
    const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

    try {
      // mediation은 항상 shared 컨텍스트 — private 메시지 절대 포함 금지
      const sharedMessages = get().messages.filter((m) => m.visibility === "shared");
      const recentMessages = sharedMessages.slice(-20).map((m) => {
        if (m.sender_role === "ai") {
          return { role: "assistant" as const, content: m.content };
        }
        const roleLabel = m.sender_role === "bride" ? "신부" : "신랑";
        const isPartner = m.metadata?.target === "partner";
        const prefix = isPartner ? `[${roleLabel}→상대방]` : `[${roleLabel}]`;
        return { role: "user" as const, content: `${prefix} ${m.content}` };
      });

      // 중재 요청 메시지 추가
      const roleLabel = senderRole === "bride" ? "신부" : "신랑";
      recentMessages.push({
        role: "user" as const,
        content: `[${roleLabel}] [MEDIATION_REQUEST] 위 커플 대화에서 갈등/의견 차이가 감지되었습니다. 아모라가 중립적으로 중재해주세요. 최근 갈등 맥락: ${conflictContext}`,
      });

      const isDemo = document.cookie.includes("demo_mode=true");
      const clientRequestId = createClientRequestId();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recentMessages,
          coupleId,
          senderName,
          senderRole,
          weddingContext,
          isDemo,
          clientRequestId,
          requestKind: "mediation",
          conflictContext,
        }),
        signal: abortController.signal,
      });

      clearTimeout(fetchTimeout);

      if (!res.ok) throw new Error("AI 중재 요청 실패");

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;
      let gotDone = false;

      await parseSSEStream(res, {
        onTextDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
        onTextClear: () => set({ streamingContent: "" }),
        onToolResult: (result) => {
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => set({ suggestions: sug }),
        onQuota: (remaining) => set({ quotaRemaining: remaining }),
        onDone: (fc, meta) => { fullContent = fc; finalMetadata = meta; gotDone = true; },
        onError: (msg) => set({ error: msg }),
      });

      if (!gotDone && !fullContent && !get().error) {
        set({ error: "AI 응답이 중단되었습니다. 다시 시도해주세요." });
      }

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = finalMetadata ?? {};
        const isDemo = document.cookie.includes("demo_mode=true");
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
      }
    } catch (err) {
      console.error("중재 요청 에러:", err);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      set({
        error: isAbort
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : "AI 연결에 실패했습니다. 새로고침 해주세요.",
      });
    } finally {
      clearTimeout(fetchTimeout);
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 대화 초기화
  clearMessages: async (coupleId, mode) => {
    const isDemo = document.cookie.includes("demo_mode=true");
    // 서버 응답에서 받은 clearedAt 사용 — DB·클라이언트 동기화
    let serverClearedAt: string | null = null;
    if (!isDemo) {
      const res = await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : "채팅 정리에 실패했습니다.";
        set({ error: message });
        throw new Error(message);
      }
      serverClearedAt = typeof data?.clearedAt === "string" ? data.clearedAt : null;
    }
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
    try {
      const res = await fetch("/api/chat/clear-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageId }),
      });
      const data = await res.json().catch(() => ({}));
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
    const supabase = createClient();
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let cancelled = false;
    const isDev = process.env.NODE_ENV !== "production";

    const scheduleReconnect = (reason: string) => {
      if (cancelled || retryTimeout) return;
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
      if (cancelled) return;
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
                const clearedAt = resolveMonotonicSharedClearCursor({
                  currentClearedAt: s.sharedClearedAt,
                  rpcClearedAt: cr.clearedAt,
                  requestCreatedAt: updated.created_at,
                });
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
    chatLifecycleEpoch += 1;
    set({
      messages: [],
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      initialLoadDone: false,
      quotaRemaining: null,
      failedRequest: null,
      isRetrying: false,
      sharedClearedAt: null,
      privateClearedAt: null,
      presence: { partnerTyping: null, aiResponding: null },
    });
  },
}));
