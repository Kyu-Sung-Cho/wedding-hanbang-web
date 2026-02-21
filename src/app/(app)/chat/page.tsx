"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import ChatBubble from "@/components/app/chat/ChatBubble";
import ActionCard from "@/components/app/chat/ActionCard";
import SuggestionButtons from "@/components/app/chat/SuggestionButtons";
import StreamingBubble from "@/components/app/chat/StreamingBubble";

export default function ChatPage() {
  const { profile, couple, journey } = useAuthStore();
  const {
    messages,
    isLoading,
    isStreaming,
    streamingContent,
    streamingToolResults,
    suggestions,
    loadMessages,
    sendMessage,
    requestInitialGreeting,
    subscribeToMessages,
    reset,
  } = useChatStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialGreetingRequested = useRef(false);
  const coupleId = couple?.id;

  // 메시지 로드 + 실시간 구독
  useEffect(() => {
    if (!coupleId) return;
    loadMessages(coupleId);
    const unsubscribe = subscribeToMessages(coupleId);
    return () => {
      unsubscribe();
      reset();
    };
  }, [coupleId, loadMessages, subscribeToMessages, reset]);

  // 메시지 로드 완료 후, 메시지가 없으면 AI 첫 인사 자동 요청
  useEffect(() => {
    if (
      !coupleId ||
      !profile ||
      isLoading ||
      initialGreetingRequested.current ||
      messages.length > 0 ||
      isStreaming
    )
      return;

    initialGreetingRequested.current = true;

    requestInitialGreeting({
      coupleId,
      senderRole: profile.role ?? "bride",
      senderName: profile.name ?? "사용자",
      weddingContext: {
        weddingDate: journey?.wedding_date ?? null,
        budget: journey?.total_budget ?? 0,
        venue: journey?.venue ?? null,
        progress: journey?.progress ?? {},
      },
    });
  }, [
    coupleId,
    profile,
    journey,
    isLoading,
    messages.length,
    isStreaming,
    requestInitialGreeting,
  ]);

  // 스크롤 자동 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, streamingContent]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = text ?? input.trim();
      if (!content || !coupleId || !profile) return;
      setInput("");

      await sendMessage({
        content,
        senderId: profile.id,
        senderRole: profile.role ?? "bride",
        coupleId,
        senderName: profile.name ?? "사용자",
        weddingContext: {
          weddingDate: journey?.wedding_date ?? null,
          budget: journey?.total_budget ?? 0,
          venue: journey?.venue ?? null,
          progress: journey?.progress ?? {},
        },
      });
    },
    [input, coupleId, profile, journey, sendMessage]
  );

  // 커플이 없는 경우
  if (!coupleId) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-[#C4967E]/30 mx-auto mb-4" />
          <p className="text-[15px] text-[#928980]">
            온보딩을 완료하면 AI 상담을 이용할 수 있어요
          </p>
        </div>
      </div>
    );
  }

  // 표시할 제안 버튼 (항상 suggestions 사용, 비어있으면 안 보여줌)
  const displaySuggestions = suggestions;

  return (
    <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex flex-col">
      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4 px-2">
        {/* 메시지 목록 */}
        <AnimatePresence>
          {messages.map((msg) => {
            const isCurrentUser = msg.sender_id === profile?.id;
            const hasToolResults =
              msg.sender_role === "ai" &&
              msg.metadata?.toolResults &&
              msg.metadata.toolResults.length > 0;

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ChatBubble
                  message={msg}
                  isCurrentUser={isCurrentUser}
                  currentUserRole={profile?.role}
                />

                {/* 도구 실행 결과 카드 */}
                {hasToolResults &&
                  msg.metadata!.toolResults!.map((result, i) => (
                    <ActionCard key={`${msg.id}-tool-${i}`} result={result} />
                  ))}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* 스트리밍 중 */}
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <StreamingBubble
              content={streamingContent}
              toolResults={streamingToolResults}
            />
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 제안 버튼 */}
      {displaySuggestions.length > 0 && !isStreaming && (
        <div className="px-2 pb-2">
          <SuggestionButtons
            suggestions={displaySuggestions}
            onSelect={handleSend}
            disabled={isStreaming}
          />
        </div>
      )}

      {/* 입력창 */}
      <div className="px-2 pb-2">
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-3 p-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              handleSend()
            }
            placeholder="예산, 일정, 준비 현황 등 무엇이든 물어보세요..."
            disabled={isStreaming}
            className="flex-1 px-4 py-3 text-[14px] text-[#1A1A1F] placeholder:text-[#B5ADA3] bg-transparent outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
            className="w-11 h-11 rounded-xl bg-[#1A1A1F] flex items-center justify-center text-white hover:bg-[#2A2A2F] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
