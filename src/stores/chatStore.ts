"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, MessageSenderRole } from "@/types/database.types";

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;

  loadMessages: (coupleId: string) => Promise<void>;
  sendMessage: (
    content: string,
    senderId: string,
    senderRole: MessageSenderRole,
    coupleId: string,
    senderName: string,
    weddingContext?: { weddingDate: string | null; budget: number; progress: Record<string, unknown> }
  ) => Promise<void>;
  subscribeToMessages: (coupleId: string) => () => void;
  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  error: null,

  loadMessages: async (coupleId: string) => {
    set({ isLoading: true, error: null });
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) throw error;
      set({ messages: (data ?? []) as ChatMessage[] });
    } catch (err) {
      console.error("채팅 로드 에러:", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async (content, senderId, senderRole, coupleId, senderName, weddingContext) => {
    const supabase = createClient();

    // 유저 메시지 저장
    const userMsg: Partial<ChatMessage> = {
      couple_id: coupleId,
      sender_id: senderId,
      sender_role: senderRole,
      content,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("chat_messages")
      .insert(userMsg)
      .select()
      .single();

    if (insertErr) {
      console.error("메시지 저장 에러:", insertErr);
      set({ error: "메시지 전송에 실패했습니다." });
      return;
    }

    // 로컬 메시지 즉시 추가 (Realtime 보다 빠르게)
    set((s) => ({ messages: [...s.messages, inserted as ChatMessage] }));

    // AI 응답 요청
    set({ isStreaming: true, streamingContent: "" });

    try {
      const recentMessages = get().messages.slice(-20).map((m) => ({
        role: m.sender_role === "ai" ? "assistant" : "user",
        content:
          m.sender_role === "ai"
            ? m.content
            : `[${m.sender_role === "bride" ? "신부" : "신랑"}] ${m.content}`,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recentMessages,
          coupleId,
          senderName,
          weddingContext: weddingContext ?? {
            weddingDate: null,
            budget: 0,
            progress: {},
          },
        }),
      });

      if (!res.ok) throw new Error("AI 응답 실패");

      const data = await res.json();

      // AI 메시지 저장
      const { data: aiInserted } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: null,
          sender_role: "ai",
          content: data.content,
        })
        .select()
        .single();

      if (aiInserted) {
        set((s) => ({ messages: [...s.messages, aiInserted as ChatMessage] }));
      }
    } catch (err) {
      console.error("AI 응답 에러:", err);
      set({ error: "AI 응답을 받지 못했습니다." });
    } finally {
      set({ isStreaming: false, streamingContent: "" });
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
          // 중복 방지
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
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      error: null,
    });
  },
}));
