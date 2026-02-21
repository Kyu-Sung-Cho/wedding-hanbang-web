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

  // 방 목록 초기화
  initRooms: (coupleId: string) => {
    const rooms = loadRoomsFromStorage(coupleId);
    set({ rooms, activeRoomId: "default" });
  },

  // 새 채팅방 생성 (최대 5개)
  createRoom: (coupleId: string) => {
    const { rooms } = get();
    // default + 추가 방 합쳐서 MAX_ROOMS
    if (rooms.length >= MAX_ROOMS - 1) return null;

    const newRoom: ChatRoom = {
      id: `room-${Date.now()}`,
      title: `상담 ${rooms.length + 2}`,
      createdAt: new Date().toISOString(),
    };

    const updated = [...rooms, newRoom];
    saveRoomsToStorage(coupleId, updated);
    set({ rooms: updated, activeRoomId: newRoom.id, messages: [], suggestions: [] });
    return newRoom.id;
  },

  // 방 전환
  switchRoom: (roomId: string) => {
    set({ activeRoomId: roomId, messages: [], suggestions: [], error: null });
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

  // 메시지 로드 (현재 방 필터)
  loadMessages: async (coupleId: string) => {
    set({ isLoading: true, error: null });
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (error) throw error;

      const { activeRoomId } = get();
      const allMessages = (data ?? []).map((m) => ({
        ...m,
        metadata: m.metadata ?? null,
      })) as ChatMessage[];

      // 현재 방 메시지만 필터
      const roomMessages = allMessages.filter((m) =>
        messageMatchesRoom(m, activeRoomId)
      );

      set({ messages: roomMessages });
    } catch (err) {
      console.error("채팅 로드 에러:", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async ({
    content, senderId, senderRole, coupleId, senderName, weddingContext,
  }) => {
    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");
    const { activeRoomId } = get();

    // roomId를 포함한 metadata
    const msgMetadata = activeRoomId !== "default" ? { roomId: activeRoomId } : null;

    if (!isDemo) {
      const { data: inserted, error: insertErr } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: senderId,
          sender_role: senderRole,
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
        messages: [...s.messages, { ...inserted, metadata: inserted.metadata ?? null } as ChatMessage],
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
        // AI 메시지에도 roomId 태깅
        const aiMetadata: ChatMessageMetadata = {
          ...(finalMetadata ?? {}),
          ...(activeRoomId !== "default" ? { roomId: activeRoomId } : {}),
        };

        if (!isDemo) {
          const { data: aiInserted } = await supabase
            .from("chat_messages")
            .insert({
              couple_id: coupleId,
              sender_id: null,
              sender_role: "ai",
              content: fullContent,
              metadata: aiMetadata,
            })
            .select()
            .single();

          if (aiInserted) {
            set((s) => ({
              messages: [...s.messages, { ...aiInserted, metadata: aiInserted.metadata ?? aiMetadata } as ChatMessage],
            }));
          }
        } else {
          const demoAiMsg: ChatMessage = {
            id: `demo-ai-${Date.now()}`,
            couple_id: coupleId,
            sender_id: null,
            sender_role: "ai",
            content: fullContent,
            metadata: aiMetadata,
            created_at: new Date().toISOString(),
          };
          set((s) => ({ messages: [...s.messages, demoAiMsg] }));
        }
      }
    } catch (err) {
      console.error("AI 응답 에러:", err);
      set({ error: "AI 응답을 받지 못했습니다." });
    } finally {
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
    }
  },

  // 첫 진입 시 AI 인사
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    if (get().messages.length > 0 || get().isStreaming || get().isLoading) return;

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

        if (!isDemo) {
          const supabase = createClient();
          const { data: aiInserted } = await supabase
            .from("chat_messages")
            .insert({
              couple_id: coupleId,
              sender_id: null,
              sender_role: "ai",
              content: fullContent,
              metadata: aiMetadata,
            })
            .select()
            .single();

          if (aiInserted) {
            set((s) => ({
              messages: [...s.messages, { ...aiInserted, metadata: aiInserted.metadata ?? aiMetadata } as ChatMessage],
            }));
          }
        } else {
          const demoAiMsg: ChatMessage = {
            id: `demo-ai-init-${Date.now()}`,
            couple_id: coupleId,
            sender_id: null,
            sender_role: "ai",
            content: fullContent,
            metadata: aiMetadata,
            created_at: new Date().toISOString(),
          };
          set((s) => ({ messages: [...s.messages, demoAiMsg] }));
        }
      }
    } catch (err) {
      console.error("초기 인사 에러:", err);
    } finally {
      set({ isStreaming: false, streamingContent: "", streamingToolResults: [] });
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
          const newMsg = payload.new as ChatMessage;
          const { activeRoomId } = get();
          // 현재 방 메시지만 추가
          if (!messageMatchesRoom(newMsg, activeRoomId)) return;

          set((s) => {
            const exists = s.messages.some((m) => m.id === newMsg.id);
            if (exists) return s;
            return {
              messages: [...s.messages, { ...newMsg, metadata: newMsg.metadata ?? null }],
            };
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
    });
  },
}));
