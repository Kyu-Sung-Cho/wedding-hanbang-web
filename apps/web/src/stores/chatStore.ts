"use client";

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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
import { determineStage } from "@/lib/ai/stage-router";
import type { AmoraActionItem } from "@/lib/amora/actions";
import { useAuthStore } from "./authStore";

type ClearScope = "shared" | "private";

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
  initialLoadDone: boolean;

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
    target?: ChatMessageTarget;
    visibility?: "shared" | "bride_private" | "groom_private";
  }) => Promise<void>;
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
const PROGRESS_AFFECTING_TOOLS = new Set([
  "add_schedule_event",
  "update_schedule_event",
  "delete_schedule_event",
  "update_task_status",
  "toggle_checklist_item",
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
  "delete_category",
  "reset_category",
  "add_amora_action",
  "update_amora_action",
  "create_booking",
  "cancel_booking",
  "update_wedding_date",
  "update_venue",
]);

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
        const { [delKey]: _r, ...restDel } = curProgressDel as Record<string, unknown>;
        authStore.updateJourneyLocal({
          progress: { ...restDel, __hidden: [...hiddenDel, delKey] } as unknown as typeof curProgressDel,
        });
      } else {
        const { [delKey]: _r, ...restDel } = curProgressDel as Record<string, unknown>;
        authStore.updateJourneyLocal({ progress: restDel as typeof curProgressDel });
      }
      break;
    }
    case "reset_category": {
      if (!result.success) break;
      const resetKey = result.toolOutput.key as string;
      const curProgressReset = authStore.journey?.progress ?? {};
      const { [resetKey]: _rr, ...restReset } = curProgressReset as Record<string, unknown>;
      authStore.updateJourneyLocal({ progress: restReset as typeof curProgressReset });
      break;
    }
    case "add_schedule_event": {
      const currentP1 = authStore.journey?.progress ?? {};
      const curEvents1 = ((currentP1 as Record<string, unknown>).__events ?? []) as unknown[];
      const newEvt = result.toolOutput.event;
      authStore.updateJourneyLocal({
        progress: { ...currentP1, __events: [...curEvents1, newEvt] } as unknown as typeof currentP1,
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
    onDone: (fullContent: string, metadata: ChatMessageMetadata) => void;
    onError: (message: string) => void;
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
          case "done":
            callbacks.onDone(event.fullContent, event.metadata);
            break;
          case "error":
            callbacks.onError(event.message);
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

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingToolResults: [],
  suggestions: [],
  error: null,
  initialLoadDone: false,
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
            .from("profiles")
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
  }) => {
    // 중복 발사 가드 (모바일 더블탭, 짧은 시간 내 재시도 방지)
    if (get().isStreaming) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[sendMessage] 이미 스트리밍 중 — 무시");
      }
      return;
    }

    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");

    // 메시지 메타데이터 (상대방에게 보내는 경우 target 표시)
    const msgMetadata = target === "partner" ? { target: "partner" as const } : null;

    // Idempotency용 UUID — 같은 sendMessage 호출의 모든 fetch (browser retry 포함)는
    // 동일한 ID를 사용. 서버는 이걸로 chat_messages dedup.
    const clientRequestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 이미지를 Supabase Storage에 업로드 시도 (채팅 기록 표시용)
    const imageUrls: string[] = [];
    if (images && images.length > 0 && !isDemo) {
      for (const img of images) {
        try {
          const ext = img.mediaType.split("/")[1] || "jpg";
          const fileName = `${coupleId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
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
            const { data: urlData } = supabase.storage.from("chat-image").getPublicUrl(fileName);
            imageUrls.push(urlData.publicUrl);
          } else {
            console.warn("Storage 업로드 실패 (무시):", uploadErr.message);
          }
        } catch (err) {
          console.warn("Storage 업로드 에러 (무시):", err);
        }
      }
    }

    // 이미지 URL이 있으면 메타데이터에 추가
    const finalMetadata = imageUrls.length > 0
      ? { ...msgMetadata, imageUrls }
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
          specialist_type: null, // 유저 메시지는 specialist 없음
          visibility: finalVisibility,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("메시지 저장 에러:", insertErr);
        set({ error: "메시지 전송에 실패했습니다." });
        return;
      }

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

    // 상대방에게 보내는 메시지 — AI 호출은 안 하지만 서버 측 갈등 감지기는 트리거.
    // 서버가 cooldown·휴리스틱·LLM 검증 후 필요 시 자동으로 mediation 메시지를 INSERT 함.
    // Realtime 이 양쪽 클라이언트에 결과 전달.
    if (target === "partner") {
      // fire-and-forget — 응답 안 기다림 (UI 블로킹 방지)
      void fetch("/api/chat/check-couple-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId }),
      }).catch(() => {
        /* 감지 실패는 silent — 메시지 전송 자체에는 영향 X */
      });
      return;
    }

    // AI 응답
    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], suggestions: [], error: null });

    try {
      // 프라이버시 critical: visibility별로 컨텍스트 격리
      // - shared 응답 → shared 메시지만 (AI가 private 내용 노출 금지)
      // - private 응답 → 본인 private + shared (AI는 둘 다 참조 가능)
      const allMessages = get().messages;
      const scopedMessages =
        finalVisibility === "shared"
          ? allMessages.filter((m) => m.visibility === "shared")
          : allMessages.filter(
              (m) => m.visibility === "shared" || m.visibility === finalVisibility
            );
      const recentMessages = scopedMessages.slice(-20).map((m) => {
        if (m.sender_role === "ai") {
          return { role: "assistant" as const, content: m.content };
        }
        const roleLabel = m.sender_role === "bride" ? "신부" : "신랑";
        const isPartner = m.metadata?.target === "partner";
        const prefix = isPartner ? `[${roleLabel}→상대방]` : `[${roleLabel}]`;
        return { role: "user" as const, content: `${prefix} ${m.content}` };
      });

      // 180초 타임아웃 (Vercel Pro maxDuration=300초)
      const abortController = new AbortController();
      const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

      // 첨부파일: base64로 직접 전송 (Storage URL 불안정하므로)
      // 단, 총 크기 3MB 이하만 전송 (Vercel 4.5MB body 제한)
      const MAX_PAYLOAD_SIZE = 3 * 1024 * 1024; // 3MB
      let totalSize = 0;
      const attachmentPayload = images?.map((img) => {
        const size = img.base64.length;
        if (totalSize + size > MAX_PAYLOAD_SIZE) {
          console.warn("첨부파일 크기 초과, 건너뜀:", img.mediaType);
          return null;
        }
        totalSize += size;
        return { base64: img.base64, mediaType: img.mediaType, fileName: (img as Record<string, unknown>).fileName || "file" };
      }).filter(Boolean);

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
          visibility: finalVisibility,
          ...(attachmentPayload && attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
        }),
        signal: abortController.signal,
      });

      clearTimeout(fetchTimeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("AI API 에러:", res.status, errText);
        throw new Error(`AI 응답 실패 (${res.status})`);
      }

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;
      let gotDone = false;
      let progressTouched = false;

      await parseSSEStream(res, {
        onTextDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
        onTextClear: () => set({ streamingContent: "" }),
        onToolResult: (result) => {
          syncToolResult(result);
          if (PROGRESS_AFFECTING_TOOLS.has(result.toolName) && result.success) {
            progressTouched = true;
          }
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => set({ suggestions: sug }),
        onDone: (fc, meta) => { fullContent = fc; finalMetadata = meta; gotDone = true; },
        onError: (msg) => set({ error: msg }),
      });

      // 스트림이 done 없이 끊긴 경우 에러 표시
      if (!gotDone && !fullContent && !get().error) {
        set({ error: "AI 응답이 중단되었습니다. 다시 시도해주세요." });
      }

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = finalMetadata ?? {};
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo, visibility: finalVisibility });
      }

      // progress 를 건드린 tool 이 있으면 백엔드와 한 번 더 sync — /dashboard,
      // /schedule, /budget 페이지가 stale 상태로 남는 안전망 (이전 사고).
      if (progressTouched) {
        useAuthStore.getState().refreshJourney();
      }
    } catch (err) {
      console.error("AI 응답 에러:", err);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      set({
        error: isAbort
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : "AI 응답을 받지 못했습니다.",
      });
    } finally {
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 첫 진입 시 AI 인사 (타임아웃 + gotDone 체크 추가)
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    if (get().isStreaming) return;

    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], suggestions: [], error: null });

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
          coupleId, senderName, senderRole, weddingContext, isDemo,
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

    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], suggestions: [], error: null });

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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recentMessages,
          coupleId, senderName, senderRole, weddingContext, isDemo,
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
    set({
      messages: [],
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      initialLoadDone: false,
      sharedClearedAt: null,
      privateClearedAt: null,
      presence: { partnerTyping: null, aiResponding: null },
    });
  },
}));
