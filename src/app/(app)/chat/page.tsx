"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, ArrowRight, User } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";

const suggestions = [
  "드레스 가격대 알려줘",
  "메이크업 리허설 언제 해야 해?",
  "예식장 계약 시 주의사항",
  "축의금 평균 금액은?",
];

export default function ChatPage() {
  const { profile, couple, journey } = useAuthStore();
  const { messages, isLoading, isStreaming, loadMessages, sendMessage, subscribeToMessages, reset } = useChatStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  // 스크롤 자동 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = async (text?: string) => {
    const content = text ?? input.trim();
    if (!content || !coupleId || !profile) return;
    setInput("");

    await sendMessage(
      content,
      profile.id,
      profile.role ?? "bride",
      coupleId,
      profile.name ?? "사용자",
      {
        weddingDate: journey?.wedding_date ?? null,
        budget: journey?.total_budget ?? 0,
        progress: journey?.progress ?? {},
      }
    );
  };

  const getRoleBadge = (senderRole: string) => {
    switch (senderRole) {
      case "bride":
        return { label: "신부", color: "bg-rose-500" };
      case "groom":
        return { label: "신랑", color: "bg-blue-500" };
      case "ai":
        return null;
      default:
        return null;
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // 커플이 없는 경우 (데모 모드 등)
  if (!coupleId) {
    return (
      <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-rose-500/30 mx-auto mb-4" />
          <p className="text-[15px] text-taupe-500">
            온보딩을 완료하면 AI 상담을 이용할 수 있어요
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex flex-col">
      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        {/* 환영 메시지 (메시지 없을 때) */}
        {messages.length === 0 && !isLoading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mr-3 mt-1 flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-[75%] px-5 py-3.5 text-[14px] leading-[1.8] bg-white text-noir-800 rounded-2xl rounded-bl-md border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
              안녕하세요, {profile?.name ?? ""}님! 웨딩한방 AI 플래너입니다 ✨
              <br />
              결혼 준비에 대해 무엇이든 물어보세요!
            </div>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg) => {
            const isAi = msg.sender_role === "ai";
            const isMyMessage = msg.sender_id === profile?.id;
            const badge = getRoleBadge(msg.sender_role);

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${isAi ? "justify-start" : isMyMessage ? "justify-end" : "justify-start"}`}
              >
                {/* AI 아바타 */}
                {isAi && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}

                {/* 파트너 아바타 */}
                {!isAi && !isMyMessage && (
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                    <User className="w-4 h-4 text-blue-500" />
                  </div>
                )}

                <div className="max-w-[75%]">
                  {/* 발신자 표시 (파트너 메시지) */}
                  {!isAi && !isMyMessage && badge && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                  )}

                  <div
                    className={`px-5 py-3.5 text-[14px] leading-[1.8] whitespace-pre-line ${
                      isAi
                        ? "bg-white text-noir-800 rounded-2xl rounded-bl-md border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
                        : isMyMessage
                          ? "bg-noir-800 text-white rounded-2xl rounded-br-md"
                          : "bg-blue-50 text-noir-800 rounded-2xl rounded-bl-md border border-blue-100"
                    }`}
                  >
                    {msg.content}
                    <div
                      className={`text-[10px] mt-2 ${
                        isAi
                          ? "text-taupe-400"
                          : isMyMessage
                            ? "text-white/30"
                            : "text-blue-300"
                      }`}
                    >
                      {formatTime(msg.created_at)}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* AI 타이핑 인디케이터 */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mr-3 mt-1 flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="px-5 py-3.5 bg-white text-noir-800 rounded-2xl rounded-bl-md border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 추천 질문 */}
      {messages.length === 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white rounded-full border border-black/[0.06] text-[12px] text-noir-800 hover:border-rose-500 hover:text-rose-500 transition-colors"
            >
              {q}
              <ArrowRight className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {/* 입력창 */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-3 p-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleSend()}
          placeholder="결혼 준비에 대해 무엇이든 물어보세요..."
          disabled={isStreaming}
          className="flex-1 px-4 py-3 text-[14px] text-noir-800 placeholder:text-taupe-400 bg-transparent outline-none disabled:opacity-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isStreaming}
          className="w-11 h-11 rounded-xl bg-noir-800 flex items-center justify-center text-white hover:bg-noir-soft transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
