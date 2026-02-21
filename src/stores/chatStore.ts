"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type {
  ChatMessage,
  MessageSenderRole,
  ToolExecutionResult,
  ChatMessageMetadata,
} from "@/types/database.types";
import type { SSEEvent, WeddingContext } from "@/types/chat.types";
import { useAuthStore } from "./authStore";

interface ChatStoreState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingToolResults: ToolExecutionResult[];
  suggestions: string[];
  error: string | null;

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

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingToolResults: [],
  suggestions: [],
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

      // metadata가 없는 오래된 메시지 호환 처리
      const messages = (data ?? []).map((m) => ({
        ...m,
        metadata: m.metadata ?? null,
      })) as ChatMessage[];

      set({ messages });
    } catch (err) {
      console.error("채팅 로드 에러:", err);
      set({ error: "채팅을 불러오지 못했습니다." });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async ({
    content,
    senderId,
    senderRole,
    coupleId,
    senderName,
    weddingContext,
  }) => {
    const supabase = createClient();
    const isDemo = document.cookie.includes("demo_mode=true");

    // 유저 메시지 저장
    if (!isDemo) {
      const { data: inserted, error: insertErr } = await supabase
        .from("chat_messages")
        .insert({
          couple_id: coupleId,
          sender_id: senderId,
          sender_role: senderRole,
          content,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("메시지 저장 에러:", insertErr);
        set({ error: "메시지 전송에 실패했습니다." });
        return;
      }

      set((s) => ({
        messages: [...s.messages, { ...inserted, metadata: null } as ChatMessage],
      }));
    } else {
      // 데모: 로컬 메시지 추가
      const demoMsg: ChatMessage = {
        id: `demo-${Date.now()}`,
        couple_id: coupleId,
        sender_id: senderId,
        sender_role: senderRole,
        content,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, demoMsg] }));
    }

    // AI 응답 요청 (SSE)
    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      error: null,
    });

    try {
      const recentMessages = get()
        .messages.slice(-20)
        .map((m) => ({
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
          senderRole,
          weddingContext,
        }),
      });

      if (!res.ok) throw new Error("AI 응답 실패");

      // SSE 파싱
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;

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
                set((s) => ({
                  streamingContent: s.streamingContent + event.content,
                }));
                break;

              case "tool_result":
                syncToolResult(event.result);
                set((s) => ({
                  streamingToolResults: [
                    ...s.streamingToolResults,
                    event.result,
                  ],
                }));
                break;

              case "suggestions":
                set({ suggestions: event.suggestions });
                break;

              case "done":
                fullContent = event.fullContent;
                finalMetadata = event.metadata;
                break;

              case "error":
                set({ error: event.message });
                break;
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }

      // AI 메시지 저장
      if (fullContent) {
        if (!isDemo) {
          const { data: aiInserted } = await supabase
            .from("chat_messages")
            .insert({
              couple_id: coupleId,
              sender_id: null,
              sender_role: "ai",
              content: fullContent,
              metadata: finalMetadata,
            })
            .select()
            .single();

          if (aiInserted) {
            set((s) => ({
              messages: [
                ...s.messages,
                { ...aiInserted, metadata: aiInserted.metadata ?? finalMetadata } as ChatMessage,
              ],
            }));
          }
        } else {
          // 데모: 로컬 AI 메시지
          const demoAiMsg: ChatMessage = {
            id: `demo-ai-${Date.now()}`,
            couple_id: coupleId,
            sender_id: null,
            sender_role: "ai",
            content: fullContent,
            metadata: finalMetadata,
            created_at: new Date().toISOString(),
          };
          set((s) => ({ messages: [...s.messages, demoAiMsg] }));
        }
      }
    } catch (err) {
      console.error("AI 응답 에러:", err);
      set({ error: "AI 응답을 받지 못했습니다." });
    } finally {
      set({
        isStreaming: false,
        streamingContent: "",
        streamingToolResults: [],
      });
    }
  },

  // 첫 진입 시 AI가 상황 분석 후 먼저 인사
  requestInitialGreeting: async ({ coupleId, senderRole, senderName, weddingContext }) => {
    // 이미 메시지가 있거나 스트리밍 중이면 스킵
    if (get().messages.length > 0 || get().isStreaming || get().isLoading) return;

    set({
      isStreaming: true,
      streamingContent: "",
      streamingToolResults: [],
      error: null,
    });

    try {
      const roleLabel = senderRole === "bride" ? "신부" : "신랑";
      const initialMessage = `[${roleLabel}] [INITIAL_GREETING]`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: initialMessage }],
          coupleId,
          senderName,
          senderRole,
          weddingContext,
        }),
      });

      if (!res.ok) throw new Error("AI 초기 인사 실패");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let finalMetadata: ChatMessageMetadata | null = null;

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
                set((s) => ({ streamingContent: s.streamingContent + event.content }));
                break;
              case "tool_result":
                syncToolResult(event.result);
                set((s) => ({ streamingToolResults: [...s.streamingToolResults, event.result] }));
                break;
              case "suggestions":
                set({ suggestions: event.suggestions });
                break;
              case "done":
                fullContent = event.fullContent;
                finalMetadata = event.metadata;
                break;
              case "error":
                set({ error: event.message });
                break;
            }
          } catch { /* ignore */ }
        }
      }

      // AI 인사 메시지 저장
      if (fullContent) {
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
              metadata: finalMetadata,
            })
            .select()
            .single();

          if (aiInserted) {
            set((s) => ({
              messages: [...s.messages, { ...aiInserted, metadata: aiInserted.metadata ?? finalMetadata } as ChatMessage],
            }));
          }
        } else {
          const demoAiMsg: ChatMessage = {
            id: `demo-ai-init-${Date.now()}`,
            couple_id: coupleId,
            sender_id: null,
            sender_role: "ai",
            content: fullContent,
            metadata: finalMetadata,
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
          set((s) => {
            const exists = s.messages.some((m) => m.id === newMsg.id);
            if (exists) return s;
            return {
              messages: [
                ...s.messages,
                { ...newMsg, metadata: newMsg.metadata ?? null },
              ],
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
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      streamingToolResults: [],
      suggestions: [],
      error: null,
    });
  },
}));
