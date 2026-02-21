"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
} from "@/types/database.types";
import type { SSEEvent, WeddingContext, ChatRoom } from "@/types/chat.types";
import { useAuthStore } from "./authStore";

const MAX_ROOMS = 5;
const ROOMS_STORAGE_KEY = "hanbang_chat_rooms";

// localStorage에서 방 목록 불러오기
function loadRoomsFromStorage(coupleId: string): ChatRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${ROOMS_STORAGE_KEY}_${coupleId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRoomsToStorage(coupleId: string, rooms: ChatRoom[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${ROOMS_STORAGE_KEY}_${coupleId}`, JSON.stringify(rooms));
}

interface ChatStoreState {
  messages: ChatMessage[];
  rooms: ChatRoom[];
  activeRoomId: string;
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;
  initialLoadDone: boolean;
  defaultRoomTitle: string;

  initRooms: (coupleId: string) => void;
  createRoom: (coupleId: string) => string | null;
  switchRoom: (roomId: string) => void;
  deleteRoom: (coupleId: string, roomId: string) => Promise<void>;
  clearRoom: (coupleId: string, roomId: string) => Promise<void>;
  loadMessages: (coupleId: string) => Promise<void>;
  sendMessage: (params: {
    content: string;
    senderId: string;
    senderRole: MessageSenderRole;
    coupleId: string;
    senderName: string;
    weddingContext: WeddingContext;
  }) => Promise<void>;
  requestInitialGreeting: (params: {
    coupleId: string;
    senderRole: MessageSenderRole;
    senderName: string;
    weddingContext: WeddingContext;
  }) => Promise<void>;
  updateRoomTitle: (coupleId: string, roomId: string, title: string) => void;
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
      } catch { /* ignore */ }
    }
  }
}

// 메시지가 현재 방에 속하는지 확인
function messageMatchesRoom(msg: ChatMessage, roomId: string): boolean {
  const meta = msg.metadata as { roomId?: string } | null;
  const msgRoom = meta?.roomId ?? "default";
  return msgRoom === roomId;
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
  const tempId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 1) 로컬 state에 즉시 추가 (화면에 바로 보임)
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

  // 2) DB에 저장 시도 (실패해도 로컬 메시지는 유지)
  if (!isDemo) {
    try {
      const supabase = createClient();
      const { data: aiInserted } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: fullContent,
          metadata: aiMetadata,
        })
        .select()
        .single();

      // DB 저장 성공 시 tempId를 실제 ID로 교체
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
  rooms: [],
  activeRoomId: "default",
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingToolResults: [],
  suggestions: [],
  error: null,
  initialLoadDone: false,
  defaultRoomTitle: "",

  // 방 목록 초기화
  initRooms: (coupleId: string) => {
    const rooms = loadRoomsFromStorage(coupleId);
    let defaultRoomTitle = "";
    if (typeof window !== "undefined") {
      defaultRoomTitle = localStorage.getItem(`hanbang_default_title_${coupleId}`) ?? "";
    }
    set({ rooms, activeRoomId: "default", defaultRoomTitle });
  },

  // 새 채팅방 생성 (최대 5개)
  createRoom: (coupleId: string) => {
    const { rooms } = get();
    // default + 추가 방 합쳐서 MAX_ROOMS
    if (rooms.length >= MAX_ROOMS - 1) return null;

    const now = new Date();
    const newRoom: ChatRoom = {
      id: `room-${Date.now()}`,
      title: `${now.getMonth() + 1}/${now.getDate()} 상담`,
      createdAt: now.toISOString(),
    };

    const updated = [...rooms, newRoom];
    saveRoomsToStorage(coupleId, updated);
    set({ rooms: updated, activeRoomId: newRoom.id, messages: [], suggestions: [] });
    return newRoom.id;
  },

  // 방 전환
  switchRoom: (roomId: string) => {
    set({ activeRoomId: roomId, messages: [], suggestions: [], error: null, initialLoadDone: false });
  },

  // 방 삭제 (메시지도 삭제)
  deleteRoom: async (coupleId: string, roomId: string) => {
    if (roomId === "default") return; // 기본방은 삭제 불가

    const isDemo = document.cookie.includes("demo_mode=true");
    if (!isDemo) {
      await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, roomId }),
      });
    }

    const { rooms, activeRoomId } = get();
    const updated = rooms.filter((r) => r.id !== roomId);
    saveRoomsToStorage(coupleId, updated);
    set({
      rooms: updated,
      activeRoomId: activeRoomId === roomId ? "default" : activeRoomId,
      messages: activeRoomId === roomId ? [] : get().messages,
      suggestions: activeRoomId === roomId ? [] : get().suggestions,
    });
  },

  // 현재 방 대화 초기화
  clearRoom: async (coupleId: string, roomId: string) => {
    const isDemo = document.cookie.includes("demo_mode=true");
    if (!isDemo) {
      await fetch("/api/chat/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, roomId }),
      });
    }
    set({ messages: [], suggestions: [] });
  },

  // 메시지 로드 (현재 방 필터) — 스트리밍 중이면 스킵
  loadMessages: async (coupleId: string) => {
    // 스트리밍 중에는 메시지 로드하지 않음 (로컬 메시지 덮어쓰기 방지)
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

      const { activeRoomId } = get();
      const allMessages = (data ?? []).map((m) => dbRowToMessage(m as Record<string, unknown>));

      // 현재 방 메시지만 필터
      const roomMessages = allMessages.filter((m) =>
        messageMatchesRoom(m, activeRoomId)
      );

      set({ messages: roomMessages });
    } catch (err) {
      console.error("채팅 로드 에러:", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      set({ isLoading: false, initialLoadDone: true });
    }
  },

  sendMessage: async ({
    content, senderId, senderRole, coupleId, senderName, weddingContext,
  }) => {
    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");
    const { activeRoomId } = get();

    // 첫 사용자 메시지인지 확인 (방 제목 자동 설정용)
    const isFirstUserMessage = !get().messages.some((m) => m.sender_role !== "ai");

    // roomId를 포함한 metadata
    const msgMetadata: ChatMessageMetadata | null = activeRoomId !== "default" ? { roomId: activeRoomId } : null;

    if (!isDemo) {
      const { data: inserted, error: insertErr } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: senderId,
          sender_type: senderRole,
          role: "user",
          content,
          metadata: msgMetadata,
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
        metadata: msgMetadata,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, demoMsg] }));
    }

    // 첫 사용자 메시지면 방 제목 자동 설정
    if (isFirstUserMessage) {
      const shortTitle = content.length > 20 ? content.slice(0, 20) + "…" : content;
      if (activeRoomId === "default") {
        if (typeof window !== "undefined") {
          localStorage.setItem(`hanbang_default_title_${coupleId}`, shortTitle);
        }
        set({ defaultRoomTitle: shortTitle });
      } else {
        const currentRooms = get().rooms;
        const updatedRooms = currentRooms.map((r) =>
          r.id === activeRoomId ? { ...r, title: shortTitle } : r
        );
        saveRoomsToStorage(coupleId, updatedRooms);
        set({ rooms: updatedRooms });
      }
    }

    // AI 응답
    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], error: null });

    try {
      const recentMessages = get().messages.slice(-20).map((m) => ({
        role: m.sender_role === "ai" ? "assistant" : "user",
        content: m.sender_role === "ai"
          ? m.content
          : `[${m.sender_role === "bride" ? "신부" : "신랑"}] ${m.content}`,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: recentMessages, coupleId, senderName, senderRole, weddingContext }),
      });

      if (!res.ok) throw new Error("AI 응답 실패");

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;

      await parseSSEStream(res, {
        onTextDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
        onToolResult: (result) => {
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => set({ suggestions: sug }),
        onDone: (fc, meta) => { fullContent = fc; finalMetadata = meta; },
        onError: (msg) => set({ error: msg }),
      });

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = {
          ...(finalMetadata ?? {}),
          ...(activeRoomId !== "default" ? { roomId: activeRoomId } : {}),
        };

        // 로컬에 먼저 추가 → DB 저장 시도 (실패해도 보임)
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
      }
    } catch (err) {
      console.error("AI 응답 에러:", err);
      set({ error: "AI 응답을 받지 못했습니다." });
    } finally {
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 첫 진입 시 AI 인사 (호출자인 useEffect가 이미 isLoading/messages 가드 처리)
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    if (get().isStreaming) return;

    const { activeRoomId } = get();
    set({ isStreaming: true, streamingContent: "", streamingToolResults: [], error: null });

    try {
      const roleLabel = senderRole === "bride" ? "신부" : "신랑";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `[${roleLabel}] [INITIAL_GREETING]` }],
          coupleId, senderName, senderRole, weddingContext,
        }),
      });

      if (!res.ok) throw new Error("AI 초기 인사 실패");

      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;

      await parseSSEStream(res, {
        onTextDelta: (content) => set((s) => ({ streamingContent: s.streamingContent + content })),
        onToolResult: (result) => {
          syncToolResult(result);
          set((s) => ({ streamingToolResults: [...s.streamingToolResults, result] }));
        },
        onSuggestions: (sug) => set({ suggestions: sug }),
        onDone: (fc, meta) => { fullContent = fc; finalMetadata = meta; },
        onError: (msg) => set({ error: msg }),
      });

      if (fullContent) {
        const aiMetadata: ChatMessageMetadata = {
          ...(finalMetadata ?? {}),
          ...(activeRoomId !== "default" ? { roomId: activeRoomId } : {}),
        };
        const isDemo = document.cookie.includes("demo_mode=true");

        // 로컬에 먼저 추가 → DB 저장 시도 (실패해도 보임)
        await saveAiMessage(set, { coupleId, fullContent, aiMetadata, isDemo });
      }
    } catch (err) {
      console.error("초기 인사 에러:", err);
    } finally {
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 방 제목 업데이트
  updateRoomTitle: (coupleId: string, roomId: string, title: string) => {
    if (roomId === "default") {
      if (typeof window !== "undefined") {
        localStorage.setItem(`hanbang_default_title_${coupleId}`, title);
      }
      set({ defaultRoomTitle: title });
    } else {
      const { rooms } = get();
      const updated = rooms.map((r) => r.id === roomId ? { ...r, title } : r);
      saveRoomsToStorage(coupleId, updated);
      set({ rooms: updated });
    }
  },

  subscribeToMessages: (coupleId: string) => {
    const supabase = createClient();
    const channel = supabase
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
          const { activeRoomId } = get();
          // 현재 방 메시지만 추가
          if (!messageMatchesRoom(newMsg, activeRoomId)) return;

          set((s) => {
            const exists = s.messages.some((m) => m.id === newMsg.id);
            if (exists) return s;
            return { messages: [...s.messages, newMsg] };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  reset: () => {
    set({
      messages: [],
      rooms: [],
      activeRoomId: "default",
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
      initialLoadDone: false,
      defaultRoomTitle: "",
    });
  },
}));
