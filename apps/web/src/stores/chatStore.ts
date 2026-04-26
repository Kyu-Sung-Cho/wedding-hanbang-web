"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
  ChatMessageTarget,
} from "@/types/database.types";
import type { SSEEvent, WeddingContext } from "@/types/chat.types";
import { determineStage } from "@/lib/ai/stage-router";
import { useAuthStore } from "./authStore";

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;
  initialLoadDone: boolean;

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
  clearMessages: (coupleId: string) => Promise<void>;
  subscribeToMessages: (coupleId: string) => () => void;
  reset: () => void;
}

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
  return {
    id: row.id as string,
    couple_id: row.couple_id as string,
    sender_id: (row.sender_id as string) ?? null,
    sender_role: (row.sender_type as MessageSenderRole) ?? (row.sender_role as MessageSenderRole) ?? "ai",
    content: row.content as string,
    metadata: (row.metadata as ChatMessageMetadata) ?? null,
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
  }
) {
  const { coupleId, fullContent, aiMetadata, isDemo } = params;

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

  // 메시지 로드 — 스트리밍 중이면 스킵
  loadMessages: async (coupleId: string) => {
    if (get().isStreaming) return;

    set({ isLoading: true, error: null, initialLoadDone: false });
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (error) throw error;

      // 스트리밍이 시작되었으면 결과 무시 (race condition 방지)
      if (get().isStreaming) return;

      const allMessages = (data ?? []).map((m) => dbRowToMessage(m as Record<string, unknown>));
      set({ messages: allMessages });
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
    if (state.isStreaming) return;
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
      if (get().isStreaming) return; // fetch 사이 스트리밍 시작됐으면 스킵

      const fetched = data.map((m) => dbRowToMessage(m as Record<string, unknown>));
      set((s) => {
        const existing = new Set(s.messages.map((m) => m.id));
        const toAdd = fetched.filter((m) => !existing.has(m.id));
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
    content, senderId, senderRole, coupleId, senderName, weddingContext, images, target = "ai",
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
        sender_id: senderId,
        sender_role: senderRole,
        content,
        metadata: finalMetadata,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, demoMsg] }));
    }

    // 상대방에게 보내는 메시지는 AI 호출 안 함
    if (target === "partner") return;

    // AI 응답
    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], error: null });

    try {
      const recentMessages = get().messages.slice(-20).map((m) => {
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
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
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

    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], error: null });

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

    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], error: null });

    const abortController = new AbortController();
    const fetchTimeout = setTimeout(() => abortController.abort(), 180000);

    try {
      // 최근 메시지를 포함해서 AI가 맥락을 이해할 수 있도록
      const recentMessages = get().messages.slice(-20).map((m) => {
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
  clearMessages: async (coupleId: string) => {
    const isDemo = document.cookie.includes("demo_mode=true");
    if (!isDemo) {
      await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId }),
      });
    }
    set({ messages: [], suggestions: [] });
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
            // 스트리밍 중이면 무시 (AI 응답은 로컬에서 직접 추가)
            if (get().isStreaming && newMsg.sender_role === "ai") return;
            set((s) => {
              const exists = s.messages.some((m) => m.id === newMsg.id);
              if (exists) return s;
              return { messages: [...s.messages, newMsg] };
            });
          }
        )
        .subscribe((status) => {
          if (isDev) console.log(`[realtime] chat:${coupleId} status: ${status}`);
          if (status === "SUBSCRIBED") {
            retryCount = 0; // 재연결 성공 시 카운터 리셋
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleReconnect(status);
          }
        });
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (currentChannel) supabase.removeChannel(currentChannel);
    };
  },

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
    });
  },
}));
