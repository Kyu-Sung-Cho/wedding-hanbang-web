"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, ArrowRight } from "lucide-react";

interface Message {
  id: number;
  role: "user" | "ai";
  text: string;
  time: string;
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: "ai",
    text: "안녕하세요, 지은님! 웨딩한방 AI 플래너입니다 ✨\n결혼 준비 D-240이시네요. 무엇이든 물어보세요!",
    time: "오후 2:00",
  },
  {
    id: 2,
    role: "user",
    text: "스튜디오 고를 때 뭘 중점적으로 봐야 해?",
    time: "오후 2:01",
  },
  {
    id: 3,
    role: "ai",
    text: "좋은 질문이에요! 스튜디오 선택 시 확인할 핵심 포인트 4가지를 알려드릴게요:\n\n1. 촬영 스타일 — 자연광 vs 조명, 포즈 연출 방식\n2. 보정 퀄리티 — 보정본 수, 추가 보정 비용\n3. 패키지 구성 — 원판 수, 앨범 종류, 액자 포함 여부\n4. 추가 비용 — 헤메, 의상 추가, 야외 촬영비\n\n지은님의 예산(280만원)에 맞는 추천 스튜디오도 알려드릴까요?",
    time: "오후 2:01",
  },
];

const suggestions = [
  "드레스 가격대 알려줘",
  "메이크업 리허설 언제 해야 해?",
  "예식장 계약 시 주의사항",
  "축의금 평균 금액은?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: messages.length + 1,
      role: "user",
      text: input,
      time: new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }),
    };
    setMessages([...messages, newMsg]);
    setInput("");

    // AI 응답 시뮬레이션
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "ai",
          text: "좋은 질문이에요! 잠시만 기다려주세요, 맞춤 정보를 정리하고 있어요... 💭\n\n(데모 버전에서는 실제 AI 응답이 제공되지 않습니다. 정식 출시 후 Claude AI가 실시간으로 상담해드립니다!)",
          time: new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }),
        },
      ]);
    }, 1000);
  };

  return (
    <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex flex-col">
      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "ai" && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={`max-w-[75%] px-5 py-3.5 text-[14px] leading-[1.8] whitespace-pre-line ${
                  msg.role === "user"
                    ? "bg-noir-800 text-white rounded-2xl rounded-br-md"
                    : "bg-white text-noir-800 rounded-2xl rounded-bl-md border border-black/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
                }`}
              >
                {msg.text}
                <div className={`text-[10px] mt-2 ${msg.role === "user" ? "text-white/30" : "text-taupe-400"}`}>
                  {msg.time}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 추천 질문 */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
        {suggestions.map((q) => (
          <button
            key={q}
            onClick={() => setInput(q)}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white rounded-full border border-black/[0.06] text-[12px] text-charcoal hover:border-rose-500 hover:text-rose-500 transition-colors"
          >
            {q}
            <ArrowRight className="w-3 h-3" />
          </button>
        ))}
      </div>

      {/* 입력창 */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-3 p-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="결혼 준비에 대해 무엇이든 물어보세요..."
          className="flex-1 px-4 py-3 text-[14px] text-noir-800 placeholder:text-taupe-400 bg-transparent outline-none"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="w-11 h-11 rounded-xl bg-noir-800 flex items-center justify-center text-white hover:bg-noir-soft transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
