import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Message, ChatContext, WELCOME_MESSAGE } from "@/types/chat.types";
import * as chatService from "@/lib/services/chatService";

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  context: ChatContext;
  coupleId: string | null;
  isServerLoaded: boolean;
}

interface ChatActions {
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setContext: (context: Partial<ChatContext>) => void;
  setCoupleId: (id: string | null) => void;
  clearChat: () => void;
  sendMessage: (text: string, sender?: "bride" | "groom") => Promise<void>;
  // Supabase 동기화
  loadFromServer: (coupleId: string) => Promise<void>;
}

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    (set, get) => ({
      messages: [WELCOME_MESSAGE],
      isLoading: false,
      error: null,
      context: {},
      coupleId: null,
      isServerLoaded: false,

      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),

      setMessages: (messages) => set({ messages }),

      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setContext: (context) =>
        set((state) => ({ context: { ...state.context, ...context } })),
      setCoupleId: (coupleId) => set({ coupleId }),

      clearChat: () => {
        const { coupleId } = get();
        set({ messages: [WELCOME_MESSAGE], error: null });
        if (coupleId) {
          chatService.clearChatMessages(coupleId);
        }
      },

      sendMessage: async (text, sender) => {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
          sender: sender || "bride",
        };

        set((state) => ({
          messages: [...state.messages, userMessage],
          isLoading: true,
          error: null,
        }));

        // 사용자 메시지 Supabase에 저장
        const { coupleId } = get();
        if (coupleId) {
          chatService.saveChatMessage(coupleId, userMessage);
        }

        try {
          const { messages, context } = get();
          const recentMessages = messages.slice(-20).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: recentMessages, context }),
          });

          if (!res.ok) throw new Error("AI 응답 실패");

          // SSE 스트리밍 처리
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";

          const aiMessageId = crypto.randomUUID();
          const aiMessage: Message = {
            id: aiMessageId,
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            sender: "ai",
          };

          set((state) => ({
            messages: [...state.messages, aiMessage],
          }));

          if (reader) {
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const data = line.slice(6);
                  if (data === "[DONE]") break;
                  try {
                    const parsed = JSON.parse(data);
                    // 서버 에러 처리
                    if (parsed.error) {
                      fullContent += parsed.error;
                      set((state) => ({
                        messages: state.messages.map((m) =>
                          m.id === aiMessageId
                            ? { ...m, content: fullContent }
                            : m
                        ),
                        error: parsed.error,
                      }));
                      break;
                    }
                    // textReplace: 서버가 ---ACTIONS--- 마커를 제거한 깨끗한 텍스트
                    if (parsed.textReplace !== undefined) {
                      fullContent = parsed.textReplace;
                      set((state) => ({
                        messages: state.messages.map((m) =>
                          m.id === aiMessageId
                            ? { ...m, content: fullContent }
                            : m
                        ),
                      }));
                    }
                    if (parsed.text) {
                      fullContent += parsed.text;
                      set((state) => ({
                        messages: state.messages.map((m) =>
                          m.id === aiMessageId
                            ? { ...m, content: fullContent }
                            : m
                        ),
                      }));
                    }
                    // 메타데이터 (버튼, 카드 등) 처리
                    if (parsed.buttons || parsed.vendorCards || parsed.quickReplies || parsed.etiquetteCards || parsed.checklistCards) {
                      set((state) => ({
                        messages: state.messages.map((m) =>
                          m.id === aiMessageId
                            ? {
                                ...m,
                                buttons: parsed.buttons || m.buttons,
                                vendorCards: parsed.vendorCards || m.vendorCards,
                                quickReplies: parsed.quickReplies || m.quickReplies,
                                etiquetteCards: parsed.etiquetteCards || m.etiquetteCards,
                                checklistCards: parsed.checklistCards || m.checklistCards,
                              }
                            : m
                        ),
                      }));
                    }
                  } catch {
                    // JSON 파싱 실패 무시
                  }
                }
              }
            }
          }

          // AI 응답 완료 후 Supabase에 저장
          const finalMessage = get().messages.find((m) => m.id === aiMessageId);
          if (coupleId && finalMessage) {
            chatService.saveChatMessage(coupleId, finalMessage);
          }

          set({ isLoading: false });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : "오류가 발생했습니다.",
          });
        }
      },

      // Supabase에서 채팅 기록 로드
      loadFromServer: async (coupleId: string) => {
        try {
          set({ coupleId });
          const serverMessages = await chatService.getChatMessages(coupleId, 100);

          if (serverMessages.length > 0) {
            set({ messages: [WELCOME_MESSAGE, ...serverMessages], isServerLoaded: true });
          } else {
            set({ isServerLoaded: true });
          }
        } catch (error) {
          console.error("서버에서 채팅 로드 실패:", error);
          set({ isServerLoaded: true });
        }
      },
    }),
    {
      name: "chat-store",
      partialize: (state) => ({
        messages: state.messages.slice(-50),
        context: state.context,
        coupleId: state.coupleId,
      }),
    }
  )
);
