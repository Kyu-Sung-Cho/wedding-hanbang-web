"use client";

import { Message } from "@/types/chat.types";
import { Sparkles } from "lucide-react";

interface ChatBubbleProps {
  message: Message;
}

const SENDER_CONFIG = {
  bride: { label: "신부", color: "text-rose-500" },
  groom: { label: "신랑", color: "text-blue-500" },
  ai: { label: "AI 플래너", color: "text-taupe-400" },
} as const;

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const sender = message.sender || (isUser ? "bride" : "ai");
  const senderInfo = SENDER_CONFIG[sender] || SENDER_CONFIG.ai;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        {/* 발신자 표시 */}
        <div className={`mb-1 flex items-center gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
          {!isUser && <Sparkles className="h-3 w-3 text-rose-500" />}
          <span className={`text-[10px] font-medium ${senderInfo.color}`}>
            {senderInfo.label}
          </span>
        </div>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? sender === "groom"
                ? "rounded-br-md bg-blue-500 text-white"
                : "rounded-br-md bg-rose-500 text-white"
              : "rounded-bl-md bg-white text-noir-800 border border-platinum"
          }`}
        >
          {/* 메시지 내용 */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return (
                  <strong key={i}>{part.slice(2, -2)}</strong>
                );
              }
              return <span key={i}>{part}</span>;
            })}
          </div>

          {/* 타임스탬프 */}
          <p
            className={`mt-1.5 text-[10px] ${
              isUser ? "text-white/60" : "text-taupe-400"
            }`}
          >
            {new Date(message.timestamp).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
