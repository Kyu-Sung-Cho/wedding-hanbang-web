"use client";

import { Message } from "@/types/chat.types";

interface ChatBubbleProps {
  message: Message;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "rounded-br-md bg-rose-500 text-white"
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
  );
}
