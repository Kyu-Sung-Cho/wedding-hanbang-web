"use client";

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { captureEvent } from "@/lib/analytics";
import {
  CHAT_ATTACHMENT_TYPE_INFO,
  createChatAttachmentBindings,
  prepareChatAttachmentPayload,
  type ChatAttachmentBinding,
} from "@/lib/chat/attachments";
import {
  createChatImageObjectPath,
  createChatImageObjectPathV2,
  isExistingChatImageUploadError,
} from "@/lib/chat/attachmentStorage";
import { resolveMonotonicSharedClearCursor } from "@/lib/chat/clearCursor";

/**
 * coupleId당 활성 Realtime 채널 레지스트리.
 * subscribeToMessages가 채널을 구독한 뒤 여기에 등록 → notifyTyping이
 * 같은 채널 인스턴스로 broadcast 송신 (별개 채널 인스턴스는 send 안 됨).
 */
const activeChatChannels = new Map<string, RealtimeChannel>();
const typingStates = new Map<
  string,
  { state: "start" | "stop"; timer: ReturnType<typeof setTimeout> | null }
>();
let chatLifecycleEpoch = 0;
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
  ChatMessageTarget,
} from "@/types/database.types";
import type { ChatSendOutcome, SSEEvent, WeddingContext } from "@/types/chat.types";
import {
  EPHEMERAL_PLACE_SEARCH_TOOL,
  getPersistableToolResults,
} from "@/lib/ai/placeSearchResultPolicy";
import type { AmoraActionItem } from "@/lib/amora/actions";
import {
  buildUnmatchedAmoraCrisisRecoveryCard,
  isAmoraCrisisRecoveryCardId,
} from "@hanbang/shared/amora-crisis-recovery";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";
import { useAuthStore } from "./authStore";

/** 서버가 이유를 밝히며 거절한 중재 요청. 그 문장을 사용자에게 그대로 보여준다. */
const MEDIATION_REQUEST_REJECTED = "MediationRequestRejected";

type ChatLifecycleBinding = {
  epoch: number;
  coupleId: string;
  profileId: string;
  role: "bride" | "groom";
};

type ActiveProviderRequest = {
  controller: AbortController;
  lifecycleBinding: ChatLifecycleBinding;
};

const activeProviderRequests = new Set<ActiveProviderRequest>();

function invalidateChatLifecycle() {
  chatLifecycleEpoch += 1;
  for (const request of activeProviderRequests) {
    if (request.lifecycleBinding.epoch < chatLifecycleEpoch) {
      request.controller.abort();
    }
  }
}

function captureChatLifecycleBinding(coupleId: string): ChatLifecycleBinding | null {
  const profile = useAuthStore.getState().profile;
  if (
    !profile?.id
    || profile.couple_id !== coupleId
    || (profile.role !== "bride" && profile.role !== "groom")
  ) return null;
  return {
    epoch: chatLifecycleEpoch,
    coupleId,
    profileId: profile.id,
    role: profile.role,
  };
}

function captureActiveChatLifecycleBinding(): ChatLifecycleBinding | null {
  const profile = useAuthStore.getState().profile;
  if (
    !profile?.id
    || !profile.couple_id
    || (profile.role !== "bride" && profile.role !== "groom")
  ) return null;
  return {
    epoch: chatLifecycleEpoch,
    coupleId: profile.couple_id,
    profileId: profile.id,
    role: profile.role,
  };
}

function isChatLifecycleBindingCurrent(binding: ChatLifecycleBinding): boolean {
  const profile = useAuthStore.getState().profile;
  return binding.epoch === chatLifecycleEpoch
    && profile?.id === binding.profileId
    && profile.couple_id === binding.coupleId
    && profile.role === binding.role;
}

type ClearScope = "shared" | "private";

function logChatDiagnostic(label: string, detail?: unknown) {
  if (process.env.NODE_ENV === "production") return;

  if (detail instanceof Error) {
    console.warn(label, { name: detail.name, message: detail.message });
    return;
  }

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    console.warn(label, {
      code: typeof record.code === "string" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message.slice(0, 300) : undefined,
    });
    return;
  }

  console.warn(label);
}

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
  /** A durable confirmation exists, but its application turn still needs resuming. */
  recoveryKind?: "confirmed_action" | "interrupted_turn" | "requires_reattach";
}

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  /** Privacy scope for transient streaming, suggestion, quota, and error UI. */
  artifactVisibility: ChatVisibility | null;
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
    partnerRecipientId?: string;
    confirmedActionId?: string;
    clientRequestId?: string;
  }) => Promise<ChatSendOutcome>;
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
    /** 요청자가 확인창에 직접 작성한 요약. 대화 원문을 자동 복사하면 안 된다. */
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
  stopTyping: (params: { coupleId: string; userId: string; senderRole: "bride" | "groom" }) => void;

  reset: () => void;
}

// 일정/예산/예약 등 journey.progress 를 변경하는 tool 들 — 처리 후 백엔드와
// sync 가 누락된 케이스 대비 refreshJourney 트리거.
const PROGRESS_AFFECTING_TOOLS = new Set<string>(MUTATING_TOOL_NAMES);

// 도구 결과를 authStore에 반영
export function syncToolResult(result: ToolExecutionResult) {
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
      void authStore.refreshJourney(authStore.user?.id);
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
    case "update_schedule_event":
    case "cancel_schedule_event":
    case "restore_schedule_event": {
      const currentP2 = authStore.journey?.progress ?? {};
      const curEvents2 = ((currentP2 as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
      const event = result.toolOutput.event as ({ id: string } & Record<string, unknown>) | undefined;
      if (!event?.id || !curEvents2.some((candidate) => candidate.id === event.id)) break;
      authStore.updateJourneyLocal({
        progress: {
          ...currentP2,
          __events: curEvents2.map((candidate) =>
            candidate.id === event.id ? event : candidate
          ),
        } as unknown as typeof currentP2,
      });
      break;
    }
    case "delete_schedule_event": {
      // Historical receipts may still contain this name. Deletion is now a
      // permanent no-op; only cancel/restore may change a schedule event.
      break;
    }
    case "toggle_checklist_item": {
      void authStore.refreshJourney(authStore.user?.id);
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
      // 예약 요청 금액은 견적이다. 일정은 즉시 동기화하되, 실제 지출이
      // 별도로 기록된 경우에만 server가 보낸 최종 spent 값을 반영한다.
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
        (nextProgress as Record<string, unknown>).__events = events.some(
          (event) => event.id === syncedEvent.id,
        )
          ? events.map((event) => event.id === syncedEvent.id ? syncedEvent : event)
          : [...events, syncedEvent];
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
      // 취소는 역연산/환불이 아니다. 안정 ID의 일정을 취소 상태로 바꾸고,
      // 실제 지출은 보존한다. syncedNewSpent는 식별 가능한 과거 견적 오기록
      // 정정 또는 별도 actual 보정이 있을 때만 전달된다.
      if (!result.success) break;
      const cancelledEvent = result.toolOutput.syncedEvent as
        | ({ id: string } & Record<string, unknown>)
        | null
        | undefined;
      const cancelCategoryKey = result.toolOutput.syncedCategoryKey as string | null | undefined;
      const cancelNewSpent = result.toolOutput.syncedNewSpent as number | null | undefined;
      if (!cancelledEvent && !cancelCategoryKey) break;

      const cancelCurrent = authStore.journey?.progress ?? {};
      const cancelNext: Record<string, unknown> = { ...cancelCurrent };

      // 1) __events에서 안정 ID를 유지한 채 취소 감사 정보까지 교체
      if (cancelledEvent) {
        const events = ((cancelNext as Record<string, unknown>).__events ?? []) as Array<{ id: string }>;
        (cancelNext as Record<string, unknown>).__events = events.some(
          (event) => event.id === cancelledEvent.id,
        )
          ? events.map((event) =>
              event.id === cancelledEvent.id ? cancelledEvent : event
            )
          : [...events, cancelledEvent];
      }

      // 2) server가 명시적으로 보낸 보정 결과만 적용. null이면 기존 지출 보존.
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
    onError: (error: Extract<SSEEvent, { type: "error" }>) => void;
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
          callbacks.onError(event);
          return true;
      }
    } catch (e) {
      logChatDiagnostic("SSE 파싱 실패", e);
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

export function reconcileAmoraCrisisRecoveryMessages(
  messages: readonly ChatMessage[],
  coupleId: string,
): ChatMessage[] {
  const canonicalMessages = messages.filter(
    (message) => !isAmoraCrisisRecoveryCardId(message.id),
  );
  const profile = useAuthStore.getState().profile;
  if (
    !profile
    || profile.id.length === 0
    || profile.couple_id !== coupleId
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return [...canonicalMessages];
  }

  const card = buildUnmatchedAmoraCrisisRecoveryCard(
    canonicalMessages.map((message) => ({
      id: message.id,
      coupleId: message.couple_id,
      senderId: message.sender_id,
      senderRole: message.sender_role,
      role: message.sender_role === "ai" ? "assistant" : "user",
      content: message.content,
      visibility: message.visibility,
      target: message.metadata?.target === "partner"
        ? "partner"
        : message.metadata?.target === "ai"
          ? "ai"
          : null,
      createdAt: message.created_at,
      inReplyToUserMessageId:
        message.metadata?.in_reply_to_user_message_id ?? null,
    })),
    {
      coupleId,
      userId: profile.id,
      role: profile.role,
    },
  );
  if (!card) return [...canonicalMessages];

  return [
    ...canonicalMessages,
    {
      id: card.id,
      couple_id: coupleId,
      sender_id: null,
      sender_role: "ai",
      content: card.content,
      metadata: card.metadata as ChatMessageMetadata,
      visibility: card.visibility,
      created_at: card.createdAt,
    },
  ];
}

function isBoundUserMessageRow(
  row: Record<string, unknown>,
  expected: {
    coupleId: string;
    senderId: string;
    senderRole: MessageSenderRole;
    content: string;
    visibility: ChatVisibility;
    target: ChatMessageTarget;
    partnerRecipientId: string | null;
    confirmedActionId: string | null;
    clientRequestId: string;
    providerAttachmentCount: number;
    providerAttachmentState: NonNullable<ChatMessageMetadata["provider_attachment_state"]>;
    providerAttachmentContractVersion: 1 | 2;
    providerAttachmentManifest: readonly ChatAttachmentBinding[];
    aiResponseRequested: boolean;
  },
): boolean {
  if (
    typeof row.id !== "string"
    || row.couple_id !== expected.coupleId
    || row.sender_id !== expected.senderId
    || row.sender_type !== expected.senderRole
    || row.role !== "user"
    || row.content !== expected.content
    || row.visibility !== expected.visibility
  ) {
    return false;
  }
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  const rowTarget = record.target === "partner" ? "partner" : "ai";
  const rowConfirmation = typeof record.confirmed_amora_action_id === "string"
    ? record.confirmed_amora_action_id
    : null;
  const rowPartnerRecipientId = typeof record.partner_recipient_id === "string"
    ? record.partner_recipient_id.toLowerCase()
    : null;
  const rowManifest = record.provider_attachment_manifest;
  const manifestMatches = expected.providerAttachmentContractVersion === 1
    ? rowManifest === undefined
    : Array.isArray(rowManifest)
      && rowManifest.length === expected.providerAttachmentManifest.length
      && rowManifest.every((entry, index) => {
        const expectedEntry = expected.providerAttachmentManifest[index];
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || !expectedEntry) {
          return false;
        }
        const manifestEntry = entry as Record<string, unknown>;
        return Object.keys(manifestEntry).length === 3
          && manifestEntry.media_type === expectedEntry.mediaType
          && manifestEntry.byte_length === expectedEntry.byteLength
          && manifestEntry.sha256 === expectedEntry.sha256;
      });
  return record.client_request_id === expected.clientRequestId
    && record.amora_ingest_contract_version === expected.providerAttachmentContractVersion
    && record.ai_response_requested === expected.aiResponseRequested
    && record.provider_attachment_state === expected.providerAttachmentState
    && record.provider_attachment_count === expected.providerAttachmentCount
    && manifestMatches
    && rowTarget === expected.target
    && rowPartnerRecipientId === (expected.partnerRecipientId?.toLowerCase() ?? null)
    && rowConfirmation === expected.confirmedActionId;
}

function isCanonicalV2AttachmentManifest(value: unknown, count: number): boolean {
  const allowedMediaTypes = new Set(Object.keys(CHAT_ATTACHMENT_TYPE_INFO));
  return Array.isArray(value)
    && value.length === count
    && value.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const record = entry as Record<string, unknown>;
      return Object.keys(record).length === 3
        && typeof record.media_type === "string"
        && allowedMediaTypes.has(record.media_type)
        && Number.isSafeInteger(record.byte_length)
        && (record.byte_length as number) > 0
        && typeof record.sha256 === "string"
        && /^[0-9a-f]{64}$/.test(record.sha256);
    });
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

function compareChatMessageOrder(left: ChatMessage, right: ChatMessage): number {
  const byCreatedAt = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  return byCreatedAt || left.id.localeCompare(right.id);
}

export function buildConfirmedActionRecoveryRequest(
  messages: ChatMessage[],
  coupleId: string,
): FailedChatRequest | null {
  const authState = useAuthStore.getState();
  const profile = authState.profile;
  if (
    !profile
    || profile.couple_id !== coupleId
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return null;
  }

  const canonicalShared = messages.filter(
    (message) => (
      message.visibility === "shared"
      && message.metadata?.target !== "partner"
    ),
  );
  const confirmation = canonicalShared[canonicalShared.length - 1];
  const confirmedActionId = confirmation?.metadata?.confirmed_amora_action_id;
  const storedClientRequestId = confirmation?.metadata?.client_request_id;
  if (
    !confirmation
    || confirmation.sender_id !== profile.id
    || confirmation.sender_role === "ai"
    || typeof confirmedActionId !== "string"
    || !EXPLICIT_ACTION_ID_PATTERN.test(confirmedActionId)
    || typeof storedClientRequestId !== "string"
    || !EXPLICIT_ACTION_ID_PATTERN.test(storedClientRequestId)
  ) {
    return null;
  }

  const clientRequestId = storedClientRequestId.toLowerCase();
  const journey = authState.journey;
  const recentMessages = canonicalShared.slice(-20).map((message) => {
    if (message.sender_role === "ai") {
      return { role: "assistant" as const, content: message.content };
    }
    const roleLabel = message.sender_role === "bride" ? "신부" : "신랑";
    return {
      role: "user" as const,
      content: `[${roleLabel}] ${message.content}`,
    };
  });
  const requestBody = JSON.stringify({
    messages: recentMessages,
    coupleId,
    senderName: profile.name ?? "사용자",
    senderRole: profile.role,
    weddingContext: {
      weddingDate: journey?.wedding_date ?? null,
      budget: journey?.total_budget ?? 0,
      venue: journey?.venue ?? null,
      progress: journey?.progress ?? {},
    },
    isDemo: false,
    clientRequestId,
    userMessageId: confirmation.id,
    visibility: "shared",
    confirmedActionId,
  });

  return {
    clientRequestId,
    userMessageId: confirmation.id,
    coupleId,
    content: confirmation.content,
    visibility: "shared",
    confirmedActionId,
    attachmentCount: 0,
    canRetry: true,
    unavailableReason: null,
    requestBody,
    isDemo: false,
    recoveryKind: "confirmed_action",
  };
}

export function buildUnansweredMessageRecoveryRequest(
  messages: ChatMessage[],
  coupleId: string,
): FailedChatRequest | null {
  const authState = useAuthStore.getState();
  const profile = authState.profile;
  if (
    !profile
    || profile.couple_id !== coupleId
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return null;
  }

  const ownPrivateVisibility: ChatVisibility = `${profile.role}_private`;
  const canonical = messages
    .filter((message) => (
      !isAmoraCrisisRecoveryCardId(message.id)
      && message.couple_id === coupleId
      && message.metadata?.target !== "partner"
      && message.metadata?.pinned_safety_card !== true
      && (message.visibility === "shared" || message.visibility === ownPrivateVisibility)
    ))
    .sort(compareChatMessageOrder);
  const latestByLane = (["shared", ownPrivateVisibility] as const)
    .map((visibility) => canonical.filter((message) => message.visibility === visibility).at(-1))
    .filter((message): message is ChatMessage => Boolean(message));

  const candidates = latestByLane.filter((message) => {
    const metadata = message.metadata;
    if (!metadata) return false;
    const attachmentState = metadata?.provider_attachment_state;
    const attachmentCount = metadata?.provider_attachment_count;
    const attachmentContractIsConsistent = Number.isSafeInteger(attachmentCount)
      && (attachmentState === "present"
        ? (attachmentCount as number) > 0 && (attachmentCount as number) <= 5
        : (attachmentState === "none" || attachmentState === "discarded_by_safety_policy")
          && attachmentCount === 0);
    const attachmentVersionIsConsistent = metadata.amora_ingest_contract_version === 1
      ? metadata.provider_attachment_manifest === undefined
      : metadata.amora_ingest_contract_version === 2
        && attachmentState === "present"
        && Number.isSafeInteger(attachmentCount)
        && isCanonicalV2AttachmentManifest(
          metadata.provider_attachment_manifest,
          attachmentCount as number,
        );
    return message.sender_id === profile.id
      && message.sender_role === profile.role
      && EXPLICIT_ACTION_ID_PATTERN.test(message.id)
      && message.content.trim().length > 0
      && attachmentVersionIsConsistent
      && metadata.ai_response_requested === true
      && typeof metadata.client_request_id === "string"
      && EXPLICIT_ACTION_ID_PATTERN.test(metadata.client_request_id)
      && metadata.confirmed_amora_action_id === undefined
      && attachmentContractIsConsistent
      && !canonical.some((candidate) => (
        candidate.sender_role === "ai"
        && candidate.metadata?.in_reply_to_user_message_id === message.id
      ));
  });
  const unanswered = candidates.sort(compareChatMessageOrder).at(-1);
  if (!unanswered || !unanswered.metadata) return null;

  const clientRequestId = unanswered.metadata.client_request_id!.toLowerCase();
  const attachmentCount = unanswered.metadata.provider_attachment_count ?? 0;
  const requiresReattach = unanswered.metadata.provider_attachment_state === "present";
  const scopedMessages = canonical
    .filter((message) => (
      compareChatMessageOrder(message, unanswered) <= 0
      && (
        unanswered.visibility === "shared"
          ? message.visibility === "shared"
          : message.visibility === "shared" || message.visibility === unanswered.visibility
      )
    ))
    .slice(-20)
    .map((message) => {
      if (message.sender_role === "ai") {
        return { role: "assistant" as const, content: message.content };
      }
      const roleLabel = message.sender_role === "bride" ? "신부" : "신랑";
      return { role: "user" as const, content: `[${roleLabel}] ${message.content}` };
    });
  const journey = authState.journey;
  const requestBody = requiresReattach
    ? ""
    : JSON.stringify({
        messages: scopedMessages,
        coupleId,
        senderName: profile.name ?? "사용자",
        senderRole: profile.role,
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
        isDemo: false,
        clientRequestId,
        userMessageId: unanswered.id,
        visibility: unanswered.visibility,
      });

  return {
    clientRequestId,
    userMessageId: unanswered.id,
    coupleId,
    content: unanswered.content,
    visibility: unanswered.visibility,
    confirmedActionId: null,
    attachmentCount,
    canRetry: !requiresReattach,
    unavailableReason: requiresReattach
      ? "질문은 저장됐지만 첨부한 파일 원본은 이어받을 수 없어요. 파일을 다시 첨부해 새 메시지로 보내주세요."
      : null,
    requestBody,
    isDemo: false,
    recoveryKind: requiresReattach ? "requires_reattach" : "interrupted_turn",
  };
}

export function isRecoveryAnswered(
  request: FailedChatRequest | null,
  messages: readonly ChatMessage[],
): boolean {
  if (!request?.recoveryKind || !request.userMessageId) return false;
  return messages.some((message) => (
    message.couple_id === request.coupleId
    && message.visibility === request.visibility
    && message.sender_role === "ai"
    && message.metadata?.in_reply_to_user_message_id === request.userMessageId
  ));
}

function isRecoveryRequestCurrent(
  request: FailedChatRequest | null,
  messages: readonly ChatMessage[],
): boolean {
  if (!request?.recoveryKind) return true;
  if (!request.userMessageId) return false;

  const sourceMessage = messages.find((message) => (
    message.id === request.userMessageId
    && message.couple_id === request.coupleId
    && message.visibility === request.visibility
  ));
  if (!sourceMessage) return false;

  // A confirmed mutation must not disappear merely because another turn starts.
  // It is cleared only after its source is hidden or its linked reply arrives.
  if (request.recoveryKind === "confirmed_action") return true;

  const latestCanonicalMessage = messages
    .filter((message) => (
      message.couple_id === request.coupleId
      && message.visibility === request.visibility
      && message.metadata?.target !== "partner"
      && message.metadata?.pinned_safety_card !== true
      && !isAmoraCrisisRecoveryCardId(message.id)
    ))
    .sort(compareChatMessageOrder)
    .at(-1);

  return latestCanonicalMessage?.id === sourceMessage.id;
}

function recoveryNotice(request: FailedChatRequest): string {
  if (request.recoveryKind === "confirmed_action") {
    return "확인은 안전하게 저장됐어요. 반영을 이어서 완료해 주세요.";
  }
  if (request.recoveryKind === "requires_reattach") {
    return "질문은 저장됐지만 첨부한 파일이 필요한 답변은 이어받지 못했어요.";
  }
  if (request.recoveryKind === "interrupted_turn") {
    return "질문은 안전하게 저장됐지만 답변이 시작되지 않았어요. 원할 때 이어서 받을 수 있어요.";
  }
  return request.unavailableReason ?? "AI 답변이 중단되었습니다. 다시 시도해주세요.";
}

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

interface ParsedChatHttpError {
  message: string | null;
  code: string | null;
  retryable: boolean | null;
  retryPolicy: "same_request" | "new_message" | null;
}

function parseChatHttpError(text: string): ParsedChatHttpError {
  const failClosed: ParsedChatHttpError = {
    message: null,
    code: null,
    retryable: null,
    retryPolicy: null,
  };
  if (!text || text.length > 4_096) return failClosed;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return failClosed;
    }
    const record = value as Record<string, unknown>;
    const retryPolicy = record.retryPolicy === "same_request"
      || record.retryPolicy === "new_message"
      ? record.retryPolicy
      : null;
    return {
      message: typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : null,
      code: typeof record.code === "string" && /^[A-Z0-9_]{1,96}$/.test(record.code)
        ? record.code
        : null,
      retryable: typeof record.retryable === "boolean" ? record.retryable : null,
      retryPolicy,
    };
  } catch {
    return failClosed;
  }
}

function isUserFacingChatHttpMessage(message: string | null): message is string {
  if (!message || message.length > 240 || !/[가-힣]/.test(message)) return false;
  return !message.includes("_")
    && !/\b(?:api|http|stack|exception|undefined|null)\b/i.test(message);
}

function isRetryableChatHttpError(error: ParsedChatHttpError): boolean {
  if (error.retryPolicy === "same_request") return true;
  if (error.retryPolicy === "new_message") return false;
  return error.retryable === true;
}

function isDefinitiveChatIngestRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
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
    content: "",
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
  retrying: boolean,
  lifecycleBinding: ChatLifecycleBinding,
): Promise<void> {
  const isCurrentLifecycle = () => isChatLifecycleBindingCurrent(lifecycleBinding);
  if (!isCurrentLifecycle() || get().isStreaming) return;

  set({
    isStreaming: true,
    isRetrying: retrying,
    streamingContent: "",
    streamingToolResults: [],
    suggestions: [],
    artifactVisibility: request.visibility,
    error: null,
    quotaRemaining: null,
  });

  const abortController = new AbortController();
  const activeProviderRequest = { controller: abortController, lifecycleBinding };
  activeProviderRequests.add(activeProviderRequest);
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
      const parsed = parseChatHttpError(errText);
      logChatDiagnostic("AI API 요청 실패", {
        code: parsed.code,
        message: `HTTP ${res.status}`,
      });
      const previewStubDisabled = parsed.message === "preview_stub_api_disabled"
        || parsed.code === "PREVIEW_STUB_API_DISABLED";
      const retryable = previewStubDisabled
        ? false
        : isRetryableChatHttpError(parsed);
      const fallbackMessage = previewStubDisabled
        ? "현재 미리보기에서는 AI 답변을 생성하지 않아요. 입력한 내용은 계정의 준비 기록에 남지 않았어요."
        : res.status === 429
        ? "지금은 잠시 쉬어가고 있어요. 잠시 후 다시 시도해주세요."
        : retryable
          ? "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요."
          : "요청 내용을 처리할 수 없어요. 입력이나 첨부파일을 확인해주세요.";
      throw new ChatProviderRequestError(
        isUserFacingChatHttpMessage(parsed.message) ? parsed.message : fallbackMessage,
        retryable,
        retryable
          ? null
          : previewStubDisabled
            ? "현재 미리보기에서는 같은 요청을 재시도할 수 없어요."
            : PERMANENT_REQUEST_RETRY_UNAVAILABLE,
      );
    }

    let fullContent = "";
    let finalMetadata: ChatMessageMetadata | null = null;
    let gotDone = false;
    let progressTouched = false;
    const terminalStream = {
      error: null as Extract<SSEEvent, { type: "error" }> | null,
    };

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
      onError: (streamError) => {
        terminalStream.error = streamError;
        if (isCurrentLifecycle()) set({ error: streamError.message });
      },
    });
    if (!isCurrentLifecycle()) return;

    const completedToolResults = get().streamingToolResults;
    const ephemeralPlaceResults = completedToolResults.filter(
      (result) => result.toolName === EPHEMERAL_PLACE_SEARCH_TOOL
    );
    // 글자가 없으면 저장하지 않는다 — 도구를 쓴 턴이 실패했을 때 카드만 있고
    // 말은 없는 빈 말풍선이 남았다. 단 장소 검색 결과는 클라이언트에만 존재해
    // 저장하지 않으면 사라지므로, 그 경우에만 텍스트 없이도 저장한다.
    if (!gotDone || (!fullContent.trim() && ephemeralPlaceResults.length === 0)) {
      const progressWasTouched = get().streamingToolResults.some(
        (result) => result.success && PROGRESS_AFFECTING_TOOLS.has(result.toolName),
      );
      if (progressWasTouched) {
        const authState = useAuthStore.getState();
        await authState.refreshJourney(authState.user?.id);
        if (!isCurrentLifecycle()) return;
      }
      const terminalStreamError = terminalStream.error;
      const retryable = terminalStreamError
        ? terminalStreamError.retryPolicy === "same_request"
          ? true
          : terminalStreamError.retryPolicy === "new_message"
            ? false
            : terminalStreamError.retryable === true
        : true;
      set({
        failedRequest: terminalStreamError
          ? withRetryAvailability(
              request,
              retryable,
              retryable ? null : PERMANENT_REQUEST_RETRY_UNAVAILABLE,
            )
          : request,
        error: get().error ?? "AI 응답이 중단되었습니다. 다시 시도해주세요.",
        streamingContent: "",
      });
      return;
    }

    const completedMetadata = finalMetadata as ChatMessageMetadata | null;
    const aiMetadata: ChatMessageMetadata = {
      ...(completedMetadata ?? {}),
      ...(completedMetadata?.response_origin === "deterministic_crisis_safety"
        && request.userMessageId
        && !completedMetadata.in_reply_to_user_message_id
        ? { in_reply_to_user_message_id: request.userMessageId }
        : {}),
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
    if (!isCurrentLifecycle()) return;

    if (progressTouched) {
      const authState = useAuthStore.getState();
      await authState.refreshJourney(authState.user?.id);
      if (!isCurrentLifecycle()) return;
    }

    // 저장까지 성공했을 때만 재시도 상태를 지운다. 서버가 보낸 안내(예: 일부 저장
    // 실패)는 사용자가 읽어야 하므로 여기서 함께 지우지 않는다.
    set({ failedRequest: null });
  } catch (err) {
    if (!isCurrentLifecycle()) return;
    logChatDiagnostic("AI 응답 처리 실패", err);
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
    activeProviderRequests.delete(activeProviderRequest);
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
  artifactVisibility: null,
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
    const lifecycleBinding = captureChatLifecycleBinding(coupleId);
    if (!lifecycleBinding) return;

    set({
      isLoading: true,
      error: null,
      initialLoadDone: false,
      suggestions: [],
      artifactVisibility: get().failedRequest?.visibility ?? null,
    });
    try {
      const supabase = createClient();
      const authProfile = useAuthStore.getState().profile;
      const ownPrivateVisibility: ChatVisibility | null =
        authProfile?.role === "bride" || authProfile?.role === "groom"
          ? `${authProfile.role}_private`
          : null;
      const latestPrivateCanonicalPromise = ownPrivateVisibility
        ? supabase
            .from("chat_messages")
            .select("*")
            .eq("couple_id", coupleId)
            .eq("visibility", ownPrivateVisibility)
            .or("metadata->>target.is.null,metadata->>target.neq.partner")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      // 본인 프로필의 view-reset timestamp 조회 (병렬)
      const [
        { data: profileData },
        { data: messagesData, error: messagesErr },
        { data: latestCanonicalData, error: latestCanonicalError },
        { data: latestPrivateCanonicalData, error: latestPrivateCanonicalError },
      ] = await Promise.all([
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
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(500),
        supabase
          .from("chat_messages")
          .select("*")
          .eq("couple_id", coupleId)
          .eq("visibility", "shared")
          .or("metadata->>target.is.null,metadata->>target.neq.partner")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        latestPrivateCanonicalPromise,
      ]);

      if (!isChatLifecycleBindingCurrent(lifecycleBinding)) return;
      if (messagesErr) throw messagesErr;
      if (latestCanonicalError) throw latestCanonicalError;
      if (latestPrivateCanonicalError) throw latestPrivateCanonicalError;
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

      const boundedRows = [...(messagesData ?? [])];
      if (
        latestCanonicalData
        && !boundedRows.some((row) => row.id === latestCanonicalData.id)
      ) {
        boundedRows.push(latestCanonicalData);
      }
      if (
        latestPrivateCanonicalData
        && !boundedRows.some((row) => row.id === latestPrivateCanonicalData.id)
      ) {
        boundedRows.push(latestPrivateCanonicalData);
      }
      const allMessages = boundedRows
        .reverse()
        .map((m) => dbRowToMessage(m as Record<string, unknown>))
        .filter(canCurrentUserSeeMessage)
        .filter((m) => {
          // 본인의 view-reset timestamp 적용
          return isAfterClearedAt(m, sharedClearedAt, privateClearedAt);
        })
        .sort((left, right) => {
          const byCreatedAt =
            new Date(left.created_at).getTime()
            - new Date(right.created_at).getTime();
          return byCreatedAt || left.id.localeCompare(right.id);
        });

      // cleared_at 도 store 에 저장 — pollNewMessages 가 활용
      const existingFailedRequest = get().failedRequest;
      const retainedFailedRequest = isRecoveryAnswered(existingFailedRequest, allMessages)
        || !isRecoveryRequestCurrent(existingFailedRequest, allMessages)
        ? null
        : existingFailedRequest;
      const recoveryRequest = retainedFailedRequest
        ? null
        : buildConfirmedActionRecoveryRequest(allMessages, coupleId)
          ?? buildUnansweredMessageRecoveryRequest(allMessages, coupleId);
      const nextFailedRequest = recoveryRequest ?? retainedFailedRequest;
      set({
        messages: reconcileAmoraCrisisRecoveryMessages(allMessages, coupleId),
        sharedClearedAt,
        privateClearedAt,
        suggestions: [],
        failedRequest: nextFailedRequest,
        artifactVisibility: nextFailedRequest?.visibility ?? null,
        error: nextFailedRequest ? recoveryNotice(nextFailedRequest) : null,
      });
    } catch (err) {
      if (!isChatLifecycleBindingCurrent(lifecycleBinding)) return;
      logChatDiagnostic("채팅 불러오기 실패", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      if (isChatLifecycleBindingCurrent(lifecycleBinding)) {
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
    const lifecycleBinding = captureChatLifecycleBinding(coupleId);
    if (!lifecycleBinding) return;

    const lastMsg = [...state.messages]
      .reverse()
      .find((message) => !isAmoraCrisisRecoveryCardId(message.id));
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

      if (!isChatLifecycleBindingCurrent(lifecycleBinding)) return;
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
        const nextMessages = reconcileAmoraCrisisRecoveryMessages(
          [...s.messages, ...toAdd],
          coupleId,
        );
        const recoveryWasAnswered = isRecoveryAnswered(s.failedRequest, toAdd);
        const recoveryBecameStale = !isRecoveryRequestCurrent(
          s.failedRequest,
          nextMessages,
        );
        return {
          messages: nextMessages,
          ...(recoveryWasAnswered || recoveryBecameStale
            ? {
                failedRequest: null,
                error: null,
                ...(!s.isStreaming ? { artifactVisibility: null } : {}),
              }
            : {}),
        };
      });
    } catch (err) {
      if (!isChatLifecycleBindingCurrent(lifecycleBinding)) return;
      // 폴링 실패는 silent — 다음 tick에 재시도
      if (process.env.NODE_ENV !== "production") {
        console.warn("[poll] 실패 (무시):", err);
      }
    }
  },

  sendMessage: async ({
    content, senderId, senderRole, coupleId, senderName, weddingContext, images, target = "ai", visibility,
    confirmedActionId, clientRequestId: requestedClientRequestId, partnerRecipientId,
  }) => {
    const lifecycleBinding = captureActiveChatLifecycleBinding();
    // Durable Supabase account/couple scopes are UUID-bound. Signed demo and
    // local synthetic scopes may use non-UUID identifiers, so they retain the
    // existing server-authoritative validation without creating a false local
    // authorization rule.
    const hasCanonicalUuidBinding = Boolean(
      lifecycleBinding
      && EXPLICIT_ACTION_ID_PATTERN.test(lifecycleBinding.profileId)
      && EXPLICIT_ACTION_ID_PATTERN.test(lifecycleBinding.coupleId),
    );
    if (
      !lifecycleBinding
      || lifecycleBinding.role !== senderRole
      || (
        hasCanonicalUuidBinding
        && (
          lifecycleBinding.coupleId.toLowerCase() !== coupleId.trim().toLowerCase()
          || lifecycleBinding.profileId.toLowerCase() !== senderId.trim().toLowerCase()
        )
      )
    ) {
      return { userMessage: "not_persisted", reason: "validation" };
    }
    const isCurrentLifecycle = () => isChatLifecycleBindingCurrent(lifecycleBinding);
    const requestedVisibility = visibility ?? "shared";
    const crisisPreflight = senderRole === "bride" || senderRole === "groom"
      ? planAmoraCrisisDelivery({
          userText: content,
          requestedVisibility,
          target,
          senderRole,
          // 일반 발화에도 같은 안전 계약이 걸린다 — 안전 서술은 공유 레인에 남지 않는다.
          // 중재만 고쳐두면 문장에 따라 계약이 갈린다. 여기서는 중재용으로 낮춘 문턱이
          // 아니라 일반 문턱을 쓴다(requestKind: "chat"). 측정: 신체 폭력 서술 7건을
          // 더 잡고, 평범한 결혼 대화 25문장(주먹밥·주먹구구식·인파에 밀침 등 이 어휘를
          // 깨려고 만든 14문장 포함) 오탐 0.
          externalSafetySignal: hasAmoraSafetySignal(content, "chat"),
        })
      : null;
    let finalVisibility = crisisPreflight?.effectiveVisibility ?? requestedVisibility;
    const effectiveConfirmedActionId = crisisPreflight?.disposition === "private_safety_route"
      ? undefined
      : confirmedActionId;
    let privateSafetyCardId: string | null = null;
    if (crisisPreflight?.disposition === "local_safety_hold") {
      const safetyCardId = `amora-crisis-preflight:${coupleId}:${
        requestedClientRequestId ?? createClientRequestId()
      }`;
      const privacyNotice = crisisPreflight.partnerDeliveryHeld
        ? "안전을 위해 이 메시지는 상대방에게 보내거나 저장하지 않았어요."
        : "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요.";
      const safetyCard: ChatMessage = {
        id: safetyCardId,
        couple_id: coupleId,
        sender_id: null,
        sender_role: "ai",
        content: `${privacyNotice}\n\n${crisisPreflight.response}`,
        metadata: {
          response_origin: crisisPreflight.safetyResolution === "immediate_crisis"
            ? "client_deterministic_crisis_preflight"
            : "client_deterministic_safety_privacy_preflight",
          ...(crisisPreflight.classification
            ? { safety_classification: crisisPreflight.classification.kind }
            : {}),
          question_scope: crisisPreflight.safetyResolution === "immediate_crisis"
            ? "W5_safety_override"
            : "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
        },
        visibility: crisisPreflight.effectiveVisibility,
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        messages: state.messages.some((message) => message.id === safetyCardId)
          ? state.messages
          : [...state.messages, safetyCard],
        suggestions: [],
        failedRequest: null,
        error: null,
        artifactVisibility: crisisPreflight.effectiveVisibility,
      }));
      return {
        userMessage: "ephemeral_safety",
        safetyCardId,
        effectiveVisibility: crisisPreflight.effectiveVisibility,
        safetyPrivacyRedirected: crisisPreflight.safetyPrivacyRedirected,
        partnerDeliveryHeld: crisisPreflight.partnerDeliveryHeld,
      };
    }
    if (crisisPreflight?.disposition === "private_safety_route") {
      const safetyCardId = `amora-safety-privacy-preflight:${coupleId}:${
        requestedClientRequestId ?? createClientRequestId()
      }`;
      privateSafetyCardId = safetyCardId;
      const attachmentNotice = images && images.length > 0
        ? " 첨부 파일은 안전을 위해 전송하지 않았어요."
        : "";
      const safetyCard: ChatMessage = {
        id: safetyCardId,
        couple_id: coupleId,
        sender_id: null,
        sender_role: "ai",
        content: `민감한 안전 관련 내용이라 상대방에게 공유하지 않고 나만 상담으로 옮겼어요.${attachmentNotice}`,
        metadata: {
          response_origin: "client_deterministic_safety_privacy_preflight",
          question_scope: "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
          raw_disclosure_shared: false,
          raw_disclosure_persistence: "none",
        },
        visibility: crisisPreflight.effectiveVisibility,
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        messages: state.messages.some((message) => message.id === safetyCardId)
          ? state.messages
          : [...state.messages, safetyCard],
        suggestions: [],
        artifactVisibility: crisisPreflight.effectiveVisibility,
      }));
    }
    const normalizedPartnerRecipientId = typeof partnerRecipientId === "string"
      ? partnerRecipientId.trim()
      : null;
    // 중복 발사 가드 (모바일 더블탭, 짧은 시간 내 재시도 방지)
    if (get().isStreaming || get().isSending) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[sendMessage] 이미 스트리밍 중 — 무시");
      }
      return {
        userMessage: "not_persisted",
        reason: "busy",
        ...(requestedClientRequestId ? { clientRequestId: requestedClientRequestId } : {}),
      };
    }
    if (
      effectiveConfirmedActionId !== undefined
      && (
        !EXPLICIT_ACTION_ID_PATTERN.test(effectiveConfirmedActionId)
        || target !== "ai"
        || finalVisibility !== "shared"
      )
    ) {
      set({
        error: "이 변경 확인 요청은 사용할 수 없어요. 아모라에게 다시 제안해 달라고 해주세요.",
        artifactVisibility: finalVisibility,
      });
      return { userMessage: "not_persisted", reason: "validation" };
    }
    if (
      requestedClientRequestId !== undefined
      && !EXPLICIT_ACTION_ID_PATTERN.test(requestedClientRequestId)
    ) {
      set({
        error: "이전 전송 상태를 안전하게 확인할 수 없어요. 새 메시지로 다시 작성해주세요.",
        artifactVisibility: finalVisibility,
      });
      return { userMessage: "not_persisted", reason: "validation" };
    }
    const invalidPartnerDelivery = target === "partner"
      ? finalVisibility !== "shared"
        || normalizedPartnerRecipientId === null
        || !EXPLICIT_ACTION_ID_PATTERN.test(normalizedPartnerRecipientId)
        || normalizedPartnerRecipientId.toLowerCase() === senderId.trim().toLowerCase()
      : partnerRecipientId !== undefined;
    if (invalidPartnerDelivery) {
      set({
        error: "상대방 연결 정보를 안전하게 확인하지 못했어요. 메시지는 보내지 않았어요.",
        artifactVisibility: finalVisibility,
      });
      return { userMessage: "not_persisted", reason: "validation" };
    }
    const preparedAttachments = crisisPreflight?.disposition === "private_safety_route"
      ? { ok: true as const, attachments: [] }
      : prepareChatAttachmentPayload(images);
    if (!preparedAttachments.ok) {
      set({ error: preparedAttachments.error, artifactVisibility: finalVisibility });
      return { userMessage: "not_persisted", reason: "validation" };
    }
    const attachments = preparedAttachments.attachments;
    if (
      target === "partner"
      && attachments.some((attachment) => !attachment.mediaType.startsWith("image/"))
    ) {
      set({
        error: "파트너에게 보내는 첨부파일은 이미지 형식만 지원해요.",
        artifactVisibility: finalVisibility,
      });
      return { userMessage: "not_persisted", reason: "validation" };
    }

    let activeClientRequestId = requestedClientRequestId ?? null;
    let persistedUserMessageId: string | null = null;
    let demoUserMessageId: string | null = null;
    let serverSafetyPrivacyRedirected = false;

    set({
      isSending: true,
      failedRequest: null,
      isRetrying: false,
      error: null,
      suggestions: [],
      artifactVisibility: finalVisibility,
    });

    try {
    const attachmentBindingResult = target === "ai" && attachments.length > 0
      ? await createChatAttachmentBindings(attachments)
      : { ok: true as const, bindings: [] };
    if (!isCurrentLifecycle()) {
      return { userMessage: "not_persisted", reason: "unexpected" };
    }
    if (!attachmentBindingResult.ok) {
      set({
        error: attachmentBindingResult.error,
        artifactVisibility: finalVisibility,
      });
      return { userMessage: "not_persisted", reason: "validation" };
    }
    const providerAttachmentManifest = attachmentBindingResult.bindings;
    const providerAttachmentContractVersion: 1 | 2 =
      providerAttachmentManifest.length > 0 ? 2 : 1;

    captureEvent("chat_message_sent", { target });

    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");

    // The same idempotency key binds the user row and provider phase. The DB
    // has a per-couple unique index on metadata->>'client_request_id'.
    const clientRequestId = requestedClientRequestId ?? createClientRequestId();
    activeClientRequestId = clientRequestId;

    // 메시지 메타데이터 (상대방에게 보내는 경우 target 표시)
    const msgMetadata: ChatMessageMetadata = {
      client_request_id: clientRequestId,
      amora_ingest_contract_version: providerAttachmentContractVersion,
      ai_response_requested: target === "ai",
      provider_attachment_state: target === "partner"
        ? "none"
        : attachments.length > 0
          ? "present"
          : "none",
      provider_attachment_count: target === "partner" ? 0 : attachments.length,
      ...(providerAttachmentManifest.length > 0
        ? {
            provider_attachment_manifest: providerAttachmentManifest.map((entry) => ({
              media_type: entry.mediaType,
              byte_length: entry.byteLength,
              sha256: entry.sha256,
            })),
          }
        : {}),
      ...(target === "partner"
        ? {
            target: "partner" as const,
            partner_recipient_id: normalizedPartnerRecipientId as string,
          }
        : {}),
      ...(effectiveConfirmedActionId
        ? { confirmed_amora_action_id: effectiveConfirmedActionId }
        : {}),
    };

    // 이미지를 Supabase Storage에 업로드 시도 (채팅 기록 표시용)
    const expectedRow = {
      coupleId,
      senderId,
      senderRole,
      content,
      visibility: finalVisibility,
      target,
      partnerRecipientId: target === "partner" ? normalizedPartnerRecipientId : null,
      confirmedActionId: effectiveConfirmedActionId ?? null,
      clientRequestId,
      providerAttachmentCount: target === "partner" ? 0 : attachments.length,
      providerAttachmentState: (target === "partner"
        ? "none"
        : attachments.length > 0
          ? "present"
          : "none") as NonNullable<ChatMessageMetadata["provider_attachment_state"]>,
      providerAttachmentContractVersion,
      providerAttachmentManifest,
      aiResponseRequested: target === "ai",
    };

    const imagePaths: string[] = [];
    const newlyUploadedImagePaths: string[] = [];
    const cleanupNewlyUploadedImages = async () => {
      if (newlyUploadedImagePaths.length === 0) return;
      const pathsToRemove = newlyUploadedImagePaths.splice(0);
      try {
        const cleanupResult = await supabase.storage
          .from("chat-image")
          .remove(pathsToRemove);
        if (cleanupResult.error) {
          logChatDiagnostic("새 채팅 이미지 고아 정리 실패", cleanupResult.error);
        }
      } catch (error) {
        logChatDiagnostic("새 채팅 이미지 고아 정리 실패", error);
      }
    };
    if (!isDemo) {
      for (const [attachmentIndex, img] of attachments.entries()) {
        let objectPath: string | null;
        try {
          const providerBinding = providerAttachmentManifest[attachmentIndex];
          if (target === "ai") {
            if (!providerBinding) {
              throw new Error("CHAT_ATTACHMENT_BINDING_MISSING");
            }
            objectPath = await createChatImageObjectPathV2({
                coupleId,
                senderId,
                clientRequestId,
                attachmentIndex,
                mediaType: providerBinding.mediaType,
                sha256: providerBinding.sha256,
              });
          } else {
            objectPath = await createChatImageObjectPath({
                coupleId,
                senderId,
                clientRequestId,
                attachmentIndex,
                mediaType: img.mediaType,
                base64: img.base64,
              });
          }
        } catch (error) {
          await cleanupNewlyUploadedImages();
          if (!isCurrentLifecycle()) {
            return { userMessage: "not_persisted", reason: "unexpected" };
          }
          logChatDiagnostic("채팅 이미지 경로 준비 실패", error);
          set({ error: "이미지를 안전하게 저장하지 못했어요. 같은 메시지로 다시 시도해 주세요." });
          return { userMessage: "not_persisted", reason: "storage", clientRequestId };
        }
        if (!isCurrentLifecycle()) {
          await cleanupNewlyUploadedImages();
          return { userMessage: "not_persisted", reason: "unexpected" };
        }
        // PDF/DOCX are provider-only and never become chat-image objects.
        if (!objectPath) continue;
        try {
          const byteChars = atob(img.base64);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: img.mediaType });
          const { error: uploadErr } = await supabase.storage
            .from("chat-image")
            .upload(objectPath, blob, { contentType: img.mediaType, upsert: false });
          if (!uploadErr) newlyUploadedImagePaths.push(objectPath);
          if (!isCurrentLifecycle()) {
            await cleanupNewlyUploadedImages();
            return { userMessage: "not_persisted", reason: "unexpected" };
          }
          if (uploadErr && !isExistingChatImageUploadError(uploadErr)) {
            await cleanupNewlyUploadedImages();
            if (!isCurrentLifecycle()) {
              return { userMessage: "not_persisted", reason: "unexpected" };
            }
            logChatDiagnostic("채팅 이미지 저장 실패", uploadErr);
            set({ error: "이미지를 안전하게 저장하지 못했어요. 같은 메시지로 다시 시도해 주세요." });
            return { userMessage: "not_persisted", reason: "storage", clientRequestId };
          }
          imagePaths.push(objectPath);
        } catch (err) {
          await cleanupNewlyUploadedImages();
          if (!isCurrentLifecycle()) {
            return { userMessage: "not_persisted", reason: "unexpected" };
          }
          logChatDiagnostic("채팅 이미지 저장 중 예외", err);
          set({ error: "이미지를 안전하게 저장하지 못했어요. 같은 메시지로 다시 시도해 주세요." });
          return { userMessage: "not_persisted", reason: "storage", clientRequestId };
        }
      }
    }

    // 이미지 storage path가 있으면 메타데이터에 추가
    const finalMetadata: ChatMessageMetadata = imagePaths.length > 0
      ? { ...msgMetadata, imagePaths }
      : msgMetadata;

    if (!isDemo) {
      let ingestResponse: Response;
      try {
        ingestResponse = await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coupleId,
            content,
            clientRequestId,
            requestedVisibility,
            target,
            providerAttachmentCount: target === "partner" ? 0 : attachments.length,
            ...(providerAttachmentManifest.length > 0
              ? { providerAttachmentManifest }
              : {}),
            ...(effectiveConfirmedActionId
              ? { confirmedActionId: effectiveConfirmedActionId }
              : {}),
            ...(imagePaths.length > 0 ? { imagePaths } : {}),
          }),
        });
        const ingestDefinitivelyRejectedBeforePersistence =
          isDefinitiveChatIngestRejection(ingestResponse.status);
        if (!isCurrentLifecycle()) {
          if (ingestDefinitivelyRejectedBeforePersistence) {
            await cleanupNewlyUploadedImages();
          }
          return { userMessage: "not_persisted", reason: "unexpected" };
        }
      } catch (error) {
        if (!isCurrentLifecycle()) {
          return { userMessage: "not_persisted", reason: "unexpected" };
        }
        logChatDiagnostic("서버 메시지 저장 결과 확인 실패", error);
        set({
          error: "메시지가 전송됐는지 확인할 수 없어요. 같은 메시지로 다시 시도해 주세요.",
        });
        return { userMessage: "persistence_unknown", clientRequestId };
      }

      const ingestDefinitivelyRejectedBeforePersistence =
        isDefinitiveChatIngestRejection(ingestResponse.status);
      let ingestPayload: Record<string, unknown> | null = null;
      try {
        const parsed = await ingestResponse.json() as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          ingestPayload = parsed as Record<string, unknown>;
        }
      } catch {
        // A broken response can hide a committed INSERT, so retry only with
        // the same client request id and let the server reconcile it.
      }
      if (!isCurrentLifecycle()) {
        if (ingestDefinitivelyRejectedBeforePersistence) {
          await cleanupNewlyUploadedImages();
        }
        return { userMessage: "not_persisted", reason: "unexpected" };
      }

      if (
        ingestResponse.ok
        && ingestPayload?.outcome === "ephemeral_safety"
        && typeof ingestPayload.response === "string"
        && (
          ingestPayload.effectiveVisibility === "bride_private"
          || ingestPayload.effectiveVisibility === "groom_private"
        )
      ) {
        if (newlyUploadedImagePaths.length > 0) {
          await cleanupNewlyUploadedImages();
          if (!isCurrentLifecycle()) {
            return { userMessage: "not_persisted", reason: "unexpected" };
          }
        }
        const rawDisclosurePersisted = ingestPayload.rawDisclosurePersisted === true
          ? true
          : ingestPayload.rawDisclosurePersisted === false
            ? false
            : null;
        const rawDisclosureVisibility = ingestPayload.rawDisclosureVisibility === "shared"
          || ingestPayload.rawDisclosureVisibility === "bride_private"
          || ingestPayload.rawDisclosureVisibility === "groom_private"
          ? ingestPayload.rawDisclosureVisibility
          : null;
        const rawDisclosureShared = rawDisclosurePersisted === true
          && (rawDisclosureVisibility === "shared" || target === "partner");
        const rawDisclosurePersistence: NonNullable<
          ChatMessageMetadata["raw_disclosure_persistence"]
        > = rawDisclosurePersisted === false
          ? "none"
          : rawDisclosureShared
            ? "shared"
            : rawDisclosureVisibility === "bride_private"
                || rawDisclosureVisibility === "groom_private"
              ? "private_only"
              : "unknown";
        const persistenceNotice = rawDisclosurePersisted === false
          ? "안전을 위해 이 내용은 상대방에게 공유하거나 저장하지 않았어요."
          : rawDisclosurePersisted === null
            ? "이 내용의 이전 저장·전달 여부를 지금 확인하지 못했어요. 추가 공유와 AI 전송은 멈추고 안전 안내만 보여드려요."
            : rawDisclosureShared
              ? "이 내용은 이전 전송에서 이미 상대방에게 전달·저장됐어요. 지금은 추가 공유와 AI 전송을 멈추고 안전 안내만 보여드려요."
              : rawDisclosurePersistence === "private_only"
                ? "이 내용은 이전 전송에서 비공개 대화에 이미 저장됐어요. 지금은 추가 전송을 멈추고 안전 안내만 보여드려요."
                : "이 내용은 이전 전송에서 이미 저장됐지만 저장 범위는 지금 확인하지 못했어요. 추가 공유와 AI 전송은 멈추고 안전 안내만 보여드려요.";
        const safetyCardId = `amora-server-crisis-preflight:${coupleId}:${clientRequestId}`;
        const serverSafetyCard: ChatMessage = {
          id: safetyCardId,
          couple_id: coupleId,
          sender_id: null,
          sender_role: "ai",
          content: `${persistenceNotice}\n\n${ingestPayload.response}`,
          metadata: {
            response_origin: "client_deterministic_crisis_preflight",
            question_scope: ingestPayload.safetyResolution === "non_immediate_safety"
              ? "W2_high_risk_adjacent"
              : "W5_safety_override",
            memory_eligible: false,
            persistence_status: "ephemeral_local_only",
            pinned_safety_card: true,
            ...(rawDisclosurePersisted === null
              ? {}
              : { raw_disclosure_persisted: rawDisclosurePersisted }),
            ...(rawDisclosurePersisted === null || rawDisclosurePersistence === "unknown"
              ? {}
              : { raw_disclosure_shared: rawDisclosureShared }),
            raw_disclosure_persistence: rawDisclosurePersistence,
          },
          visibility: ingestPayload.effectiveVisibility,
          created_at: new Date().toISOString(),
        };
        set((state) => ({
          messages: state.messages.some((message) => message.id === safetyCardId)
            ? state.messages
            : [...state.messages, serverSafetyCard],
          suggestions: [],
          failedRequest: null,
          error: null,
          artifactVisibility: ingestPayload?.effectiveVisibility as ChatMessage["visibility"],
        }));
        return {
          userMessage: "ephemeral_safety",
          safetyCardId,
          effectiveVisibility: ingestPayload.effectiveVisibility,
          safetyPrivacyRedirected: ingestPayload.safetyPrivacyRedirected === true,
          partnerDeliveryHeld: ingestPayload.partnerDeliveryHeld === true,
        };
      }

      if (!ingestResponse.ok || !ingestPayload) {
        if (ingestDefinitivelyRejectedBeforePersistence) {
          await cleanupNewlyUploadedImages();
          if (!isCurrentLifecycle()) {
            return { userMessage: "not_persisted", reason: "unexpected" };
          }
        }
        const safeError = typeof ingestPayload?.error === "string"
          ? ingestPayload.error.slice(0, 300)
          : "메시지를 안전하게 저장하지 못했어요.";
        set({ error: safeError });
        const mustReuseRequest = ingestResponse.status === 408
          || ingestResponse.status === 429
          || ingestResponse.status >= 500
          || ingestPayload?.retryPolicy === "same_request";
        if (ingestResponse.status !== 409 && mustReuseRequest) {
          return { userMessage: "persistence_unknown", clientRequestId };
        }
        return {
          userMessage: "not_persisted",
          reason: ingestDefinitivelyRejectedBeforePersistence
            ? "validation"
            : "database",
          clientRequestId,
        };
      }

      const serverVisibility = ingestPayload.effectiveVisibility;
      const serverMessage = ingestPayload.message;
      if (
        ingestPayload.outcome !== "persisted"
        || (
          serverVisibility !== "shared"
          && serverVisibility !== "bride_private"
          && serverVisibility !== "groom_private"
        )
        || !serverMessage
        || typeof serverMessage !== "object"
        || Array.isArray(serverMessage)
      ) {
        set({
          error: "메시지 저장 결과를 안전하게 확인하지 못했어요. 같은 메시지로 다시 시도해 주세요.",
        });
        return { userMessage: "persistence_unknown", clientRequestId };
      }

      finalVisibility = serverVisibility;
      expectedRow.visibility = serverVisibility;
      if (ingestPayload.safetyPrivacyRedirected === true) {
        expectedRow.providerAttachmentCount = 0;
        expectedRow.providerAttachmentState = attachments.length > 0
          ? "discarded_by_safety_policy"
          : "none";
        expectedRow.providerAttachmentContractVersion = 1;
        expectedRow.providerAttachmentManifest = [];
      }
      const inserted = serverMessage as Record<string, unknown>;
      if (!isBoundUserMessageRow(inserted, expectedRow)) {
        set({
          error: "저장된 메시지와 현재 전송 정보가 일치하지 않아요. 새 메시지로 다시 작성해 주세요.",
        });
        return { userMessage: "not_persisted", reason: "validation", clientRequestId };
      }
      persistedUserMessageId = inserted.id as string;
      serverSafetyPrivacyRedirected = ingestPayload.safetyPrivacyRedirected === true;
      if (serverSafetyPrivacyRedirected && newlyUploadedImagePaths.length > 0) {
        await cleanupNewlyUploadedImages();
        if (!isCurrentLifecycle()) {
          return { userMessage: "not_persisted", reason: "unexpected" };
        }
      }
      set((state) => {
        if (state.messages.some((message) => message.id === inserted.id)) return {};
        const nextMessage = dbRowToMessage(inserted);
        return {
          messages: [...state.messages, nextMessage].sort(
            (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
          ),
          artifactVisibility: serverVisibility,
        };
      });
    }

    if (isDemo) {
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
      demoUserMessageId = demoMsg.id;
      set((s) => ({ messages: [...s.messages, demoMsg] }));
    }

    if (privateSafetyCardId && persistedUserMessageId) {
      set((state) => ({
        messages: state.messages.map((message) => (
          message.id === privateSafetyCardId
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  raw_disclosure_persisted: true,
                  raw_disclosure_shared: false,
                  raw_disclosure_persistence: "private_only" as const,
                },
              }
            : message
        )),
      }));
    }

    const acceptedBase: ChatSendOutcome = isDemo
      ? { userMessage: "ephemeral_demo", userMessageId: demoUserMessageId as string }
      : { userMessage: "persisted", userMessageId: persistedUserMessageId as string };
    const wasSafetyPrivacyRedirected = serverSafetyPrivacyRedirected
      || (
        crisisPreflight?.disposition === "private_safety_route"
        && crisisPreflight.safetyPrivacyRedirected
      );
    const acceptedOutcome: ChatSendOutcome =
      wasSafetyPrivacyRedirected
        ? {
            ...acceptedBase,
            effectiveVisibility: finalVisibility,
            safetyPrivacyRedirected: true,
          }
        : acceptedBase;

    // 상대방에게 보내는 메시지는 명시적 커플 동의 없이 AI 제공자에게
    // 전달하지 않는다. 자동 중재는 별도 동의 계약/UI가 준비될 때까지 중단한다.
    if (target === "partner") {
      return acceptedOutcome;
    }

    // 프라이버시 critical: visibility별로 컨텍스트 격리. This snapshot is
    // serialized once and reused byte-for-byte if the provider phase fails.
    const allMessages = get().messages;
    const scopedMessages = (
      finalVisibility === "shared"
        ? allMessages.filter((message) => message.visibility === "shared")
        : allMessages.filter(
            (message) => message.visibility === "shared" || message.visibility === finalVisibility
          )
    ).filter((message) => (
      message.metadata?.target !== "partner"
      && message.metadata?.pinned_safety_card !== true
    ));
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
    const attachmentPayload = serverSafetyPrivacyRedirected ? [] : attachments;

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
        ...(effectiveConfirmedActionId !== undefined
          ? { confirmedActionId: effectiveConfirmedActionId }
          : {}),
        ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
      });
    } catch (error) {
      logChatDiagnostic("AI 요청 정보 준비 실패", error);
      set({ error: "요청 정보를 안전하게 준비하지 못했습니다. 새 메시지로 다시 보내주세요." });
      return acceptedOutcome;
    }

    const failedRequest: FailedChatRequest = {
      clientRequestId,
      userMessageId: persistedUserMessageId,
      coupleId,
      content,
      visibility: finalVisibility,
      confirmedActionId: effectiveConfirmedActionId ?? null,
      attachmentCount: attachmentPayload.length,
      canRetry: true,
      unavailableReason: null,
      requestBody,
      isDemo,
    };

    await executeChatProviderRequest(set, get, failedRequest, false, lifecycleBinding);
    return acceptedOutcome;
    } catch (unexpectedError) {
      if (!isCurrentLifecycle()) {
        return { userMessage: "not_persisted", reason: "unexpected" };
      }
      logChatDiagnostic("메시지 전송 중 예상하지 못한 오류", unexpectedError);
      set({ error: "전송 상태를 안전하게 확인하지 못했어요. 같은 메시지로 다시 시도해 주세요." });
      if (persistedUserMessageId) {
        return { userMessage: "persisted", userMessageId: persistedUserMessageId };
      }
      if (demoUserMessageId) {
        return { userMessage: "ephemeral_demo", userMessageId: demoUserMessageId };
      }
      if (activeClientRequestId) {
        return { userMessage: "persistence_unknown", clientRequestId: activeClientRequestId };
      }
      return { userMessage: "not_persisted", reason: "unexpected" };
    } finally {
      if (isCurrentLifecycle()) set({ isSending: false });
    }
  },

  retryFailedMessage: async () => {
    const state = get();
    if (state.isStreaming || state.isRetrying || !state.failedRequest) return;
    const lifecycleBinding = captureActiveChatLifecycleBinding();
    if (!lifecycleBinding) return;
    if (!state.failedRequest.canRetry) {
      set({ error: state.failedRequest.unavailableReason ?? ATTACHMENT_RETRY_UNAVAILABLE });
      return;
    }
    await executeChatProviderRequest(set, get, state.failedRequest, true, lifecycleBinding);
  },

  dismissFailedMessageRetry: () => {
    if (get().isStreaming || get().isRetrying) return;
    set({ failedRequest: null, error: null, artifactVisibility: null });
  },

  // 첫 진입 시 AI 인사 (타임아웃 + gotDone 체크 추가)
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    if (get().isStreaming || get().isSending) return;
    const lifecycleBinding = captureChatLifecycleBinding(coupleId);
    if (!lifecycleBinding || lifecycleBinding.role !== senderRole) return;
    const isCurrentLifecycle = () => isChatLifecycleBindingCurrent(lifecycleBinding);

    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      artifactVisibility: "shared",
      error: null,
      quotaRemaining: null,
      failedRequest: null,
      isRetrying: false,
    });

    // 180초 타임아웃
    const abortController = new AbortController();
    const activeProviderRequest = { controller: abortController, lifecycleBinding };
    activeProviderRequests.add(activeProviderRequest);
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
      if (!isCurrentLifecycle()) return;

      clearTimeout(fetchTimeout);

      if (!res.ok) throw new Error("AI 초기 인사 실패");

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;
      let gotDone = false;

      await parseSSEStream(res, {
        onTextDelta: (content) => {
          if (isCurrentLifecycle()) {
            set((s) => ({ streamingContent: s.streamingContent + content }));
          }
        },
        onTextClear: () => {
          if (isCurrentLifecycle()) set({ streamingContent: "" });
        },
        onToolResult: (result) => {
          if (!isCurrentLifecycle()) return;
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => {
          if (isCurrentLifecycle()) set({ suggestions: sug });
        },
        onQuota: (remaining) => {
          if (isCurrentLifecycle()) set({ quotaRemaining: remaining });
        },
        onDone: (fc, meta) => {
          if (!isCurrentLifecycle()) return;
          fullContent = fc;
          finalMetadata = meta;
          gotDone = true;
        },
        onError: (streamError) => {
          if (isCurrentLifecycle()) set({ error: streamError.message });
        },
      });
      if (!isCurrentLifecycle()) return;

      // 스트림이 done 없이 끊긴 경우 에러 표시
      if (!gotDone && !fullContent && !get().error) {
        set({ error: "AI 응답이 중단되었습니다. 다시 시도해주세요." });
      }

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = finalMetadata ?? {};
        const isDemo = document.cookie.includes("demo_mode=true");
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
        if (!isCurrentLifecycle()) return;
      }
    } catch (err) {
      if (!isCurrentLifecycle()) return;
      logChatDiagnostic("초기 인사 요청 실패", err);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      set({
        error: isAbort
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : "AI 연결에 실패했습니다. 새로고침 해주세요.",
      });
    } finally {
      clearTimeout(fetchTimeout);
      activeProviderRequests.delete(activeProviderRequest);
      if (isCurrentLifecycle()) {
        set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
      }
    }
  },

  // 갈등 중재: 사용자가 명시적으로 요청한 구조화 초안
  requestMediation: async ({ coupleId, senderRole, senderName, weddingContext, conflictContext }) => {
    if (get().isStreaming || get().isSending) return;
    if (senderRole !== "bride" && senderRole !== "groom") {
      set({ error: "현재 커플 역할을 확인한 뒤 다시 시도해 주세요." });
      return;
    }
    const lifecycleBinding = captureChatLifecycleBinding(coupleId);
    if (!lifecycleBinding || lifecycleBinding.role !== senderRole) return;
    const isCurrentLifecycle = () => isChatLifecycleBindingCurrent(lifecycleBinding);

    const requesterSummary = conflictContext.trim().slice(0, 600);
    if (requesterSummary.length < 4) {
      set({ error: "아모라에게 전달할 상황을 짧게 적어주세요." });
      return;
    }

    // 중재 요청의 답은 공유 레인에 저장된다. 그래서 안전 판정은 **보내기 전에**
    // 끝나야 하고, 판정 갈래가 둘이면 둘 다 여기서 만나야 한다.
    const mediationSafetyPlan = planAmoraCrisisDelivery({
      userText: requesterSummary,
      requestedVisibility: "shared",
      target: "partner",
      senderRole,
      externalSafetySignal: hasAmoraSafetySignal(requesterSummary, "mediation"),
    });
    if (mediationSafetyPlan.disposition === "local_safety_hold") {
      const safetyCardId = `amora-mediation-safety-hold:${coupleId}:${createClientRequestId()}`;
      const safetyCard: ChatMessage = {
        id: safetyCardId,
        couple_id: coupleId,
        sender_id: null,
        sender_role: "ai",
        content: `안전을 위해 이 조율 요청은 상대방에게 보내지 않았어요.\n\n${mediationSafetyPlan.response}`,
        metadata: {
          response_origin: mediationSafetyPlan.safetyResolution === "immediate_crisis"
            ? "client_deterministic_crisis_preflight"
            : "client_deterministic_safety_privacy_preflight",
          question_scope: mediationSafetyPlan.safetyResolution === "immediate_crisis"
            ? "W5_safety_override"
            : "W2_high_risk_adjacent",
          memory_eligible: false,
          persistence_status: "ephemeral_local_only",
          pinned_safety_card: true,
          raw_disclosure_persisted: false,
          raw_disclosure_shared: false,
          raw_disclosure_persistence: "none",
        },
        visibility: mediationSafetyPlan.effectiveVisibility,
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, safetyCard],
        suggestions: [],
        artifactVisibility: mediationSafetyPlan.effectiveVisibility,
        error: null,
        quotaRemaining: null,
        failedRequest: null,
      }));
      return;
    }

    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      artifactVisibility: "shared",
      error: null,
      quotaRemaining: null,
      failedRequest: null,
      isRetrying: false,
    });

    const abortController = new AbortController();
    const activeProviderRequest = { controller: abortController, lifecycleBinding };
    activeProviderRequests.add(activeProviderRequest);
    const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

    try {
      // 상대방에게 직접 보낸 원문이나 비공개 대화를 클라이언트 payload에
      // 복사하지 않는다. 실제 사용자의 AI 문맥은 서버가 공유 canonical DB
      // history 중 target=partner 행을 제외하고 재구성하며, 이번 조율 요청에는
      // 아래의 요청자 요약만 추가한다.
      const roleLabel = senderRole === "bride" ? "신부" : "신랑";
      const mediationMessages = [{
        role: "user" as const,
        content: `[${roleLabel}] [MEDIATION_REQUEST] 내가 직접 작성한 조율 요청 요약: ${requesterSummary}`,
      }];

      const isDemo = document.cookie.includes("demo_mode=true");
      const clientRequestId = createClientRequestId();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: mediationMessages,
          coupleId,
          senderName,
          senderRole,
          weddingContext,
          isDemo,
          clientRequestId,
          requestKind: "mediation",
          conflictContext: requesterSummary,
          visibility: "shared",
        }),
        signal: abortController.signal,
      });
      if (!isCurrentLifecycle()) return;

      clearTimeout(fetchTimeout);

      if (!res.ok) {
        // 서버가 이유를 문장으로 돌려준 경우(안전 프리플라이트 등)에는 그 문장을
        // 그대로 보여준다. 아래 catch가 전부 "AI 연결에 실패했습니다"로 덮고 있어서,
        // 안전 때문에 멈춘 것이 접속 장애처럼 읽혔다. 무엇을 해야 하는지도 사라졌다.
        // 여기서 오는 문장은 우리 라우트가 쓴 것이고 모델 출력이 아니다.
        const failureBody = await res.json().catch(() => null);
        const serverMessage =
          failureBody
          && typeof failureBody === "object"
          && typeof (failureBody as { error?: unknown }).error === "string"
            ? (failureBody as { error: string }).error
            : null;
        const failure = new Error(serverMessage ?? "AI 중재 요청 실패");
        if (serverMessage) failure.name = MEDIATION_REQUEST_REJECTED;
        throw failure;
      }

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;
      let gotDone = false;

      await parseSSEStream(res, {
        onTextDelta: (content) => {
          if (isCurrentLifecycle()) {
            set((s) => ({ streamingContent: s.streamingContent + content }));
          }
        },
        onTextClear: () => {
          if (isCurrentLifecycle()) set({ streamingContent: "" });
        },
        onToolResult: (result) => {
          if (!isCurrentLifecycle()) return;
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => {
          if (isCurrentLifecycle()) set({ suggestions: sug });
        },
        onQuota: (remaining) => {
          if (isCurrentLifecycle()) set({ quotaRemaining: remaining });
        },
        onDone: (fc, meta) => {
          if (!isCurrentLifecycle()) return;
          fullContent = fc;
          finalMetadata = meta;
          gotDone = true;
        },
        onError: (streamError) => {
          if (isCurrentLifecycle()) set({ error: streamError.message });
        },
      });
      if (!isCurrentLifecycle()) return;

      if (!gotDone && !fullContent && !get().error) {
        set({ error: "AI 응답이 중단되었습니다. 다시 시도해주세요." });
      }

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = finalMetadata ?? {};
        const isDemo = document.cookie.includes("demo_mode=true");
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
        if (!isCurrentLifecycle()) return;
      }
    } catch (err) {
      if (!isCurrentLifecycle()) return;
      logChatDiagnostic("중재 요청 실패", err);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const isServerRejection =
        err instanceof Error && err.name === MEDIATION_REQUEST_REJECTED;
      set({
        error: isAbort
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : isServerRejection
            ? err.message
            : "AI 연결에 실패했습니다. 새로고침 해주세요.",
      });
    } finally {
      clearTimeout(fetchTimeout);
      activeProviderRequests.delete(activeProviderRequest);
      if (isCurrentLifecycle()) {
        set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
      }
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
      const clearsShared = mode === "view_reset_shared" || mode === "delete_shared";
      const clearsPrivate = mode === "view_reset_private" || mode === "delete_private";
      const filtered = s.messages.filter((m) => {
        if (clearsShared) {
          return m.visibility !== "shared";
        }
        if (clearsPrivate) {
          return !isCurrentUserPrivateMessage(m);
        }
        return true;
      });
      const clearsFailedRequest = s.failedRequest?.coupleId === coupleId
        && (
          (clearsShared && s.failedRequest.visibility === "shared")
          || (clearsPrivate && s.failedRequest.visibility !== "shared")
        );
      const next: Partial<ChatStoreState> = {
        messages: filtered,
        suggestions: [],
        artifactVisibility: s.failedRequest?.coupleId === coupleId && !clearsFailedRequest
          ? s.failedRequest.visibility
          : null,
        ...(clearsFailedRequest
          ? { failedRequest: null, error: null, isRetrying: false }
          : {}),
      };
      if (clearsShared) {
        next.sharedClearedAt = nowIso;
      }
      if (clearsPrivate) {
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
    const lifecycleBinding = captureChatLifecycleBinding(coupleId);
    if (!lifecycleBinding) return () => {};
    const supabase = createClient();
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let cancelled = false;
    const isDev = process.env.NODE_ENV !== "production";
    const isSubscriptionCurrent = () => (
      !cancelled && isChatLifecycleBindingCurrent(lifecycleBinding)
    );

    const scheduleReconnect = (reason: string) => {
      if (!isSubscriptionCurrent() || retryTimeout) return;
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
      if (!isSubscriptionCurrent()) return;
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
            if (!isSubscriptionCurrent()) return;
            const newMsg = dbRowToMessage(payload.new as Record<string, unknown>);
            if (newMsg.couple_id !== lifecycleBinding.coupleId) return;
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
              const nextMessages = reconcileAmoraCrisisRecoveryMessages(
                [...s.messages, newMsg],
                coupleId,
              );
              const recoveryWasAnswered = isRecoveryAnswered(s.failedRequest, [newMsg]);
              const recoveryBecameStale = !isRecoveryRequestCurrent(
                s.failedRequest,
                nextMessages,
              );

              return {
                messages: nextMessages,
                ...(newMsg.sender_role !== "ai"
                  && newMsg.metadata?.target !== "partner"
                  && s.artifactVisibility === newMsg.visibility
                  ? { suggestions: [], artifactVisibility: null }
                  : {}),
                ...(incomingFromPartnerTyping
                  ? { presence: { ...s.presence, partnerTyping: null } }
                  : {}),
                ...(recoveryWasAnswered || recoveryBecameStale
                  ? {
                      failedRequest: null,
                      error: null,
                      ...(!s.isStreaming ? { artifactVisibility: null } : {}),
                    }
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
            if (!isSubscriptionCurrent()) return;
            const updated = dbRowToMessage(payload.new as Record<string, unknown>);
            if (updated.couple_id !== lifecycleBinding.coupleId) return;
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
              return {
                messages: reconcileAmoraCrisisRecoveryMessages(
                  nextMessages,
                  coupleId,
                ),
              };
            });
          }
        )
        // ───────── Realtime broadcast: typing + AI streaming ─────────
        .on("broadcast", { event: "typing" }, (msg) => {
          if (!isSubscriptionCurrent()) return;
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
          if (!isSubscriptionCurrent()) return;
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
      if (!isSubscriptionCurrent()) return;
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
  notifyTyping: ({ coupleId, userId, senderRole }) => {
    const key = `${coupleId}:${userId}`;
    const current = typingStates.get(key) ?? { state: "stop" as const, timer: null };
    const channel = activeChatChannels.get(coupleId);
    const sendBroadcast = (state: "start" | "stop") => {
      if (!channel) return;
      void channel.send({
        type: "broadcast",
        event: "typing",
        payload: { sender_role: senderRole, user_id: userId, state },
      });
    };

    if (current.state !== "start") sendBroadcast("start");
    if (current.timer) clearTimeout(current.timer);
    const timer = setTimeout(() => {
      sendBroadcast("stop");
      typingStates.delete(key);
    }, 3000);
    typingStates.set(key, { state: "start", timer });
  },

  stopTyping: ({ coupleId, userId, senderRole }) => {
    const key = `${coupleId}:${userId}`;
    const current = typingStates.get(key);
    if (current?.timer) clearTimeout(current.timer);
    typingStates.delete(key);
    if (current?.state !== "start") return;
    const channel = activeChatChannels.get(coupleId);
    if (!channel) return;
    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { sender_role: senderRole, user_id: userId, state: "stop" },
    });
  },

  reset: () => {
    invalidateChatLifecycle();
    for (const entry of typingStates.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    typingStates.clear();
    set({
      messages: [],
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      artifactVisibility: null,
      error: null,
      initialLoadDone: false,
      quotaRemaining: null,
      failedRequest: null,
      isSending: false,
      isRetrying: false,
      sharedClearedAt: null,
      privateClearedAt: null,
      presence: { partnerTyping: null, aiResponding: null },
    });
  },
}));

useAuthStore.subscribe((state, previousState) => {
  const profile = state.profile;
  const previousProfile = previousState.profile;
  if (
    state.user?.id !== previousState.user?.id
    || profile?.id !== previousProfile?.id
    || profile?.couple_id !== previousProfile?.couple_id
    || profile?.role !== previousProfile?.role
  ) {
    invalidateChatLifecycle();
  }
});
