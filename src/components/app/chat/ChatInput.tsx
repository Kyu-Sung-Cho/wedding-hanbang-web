"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  quickReplies?: string[];
  sender?: "bride" | "groom";
}

export default function ChatInput({
  onSend,
  disabled = false,
  quickReplies,
  sender = "bride",
}: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  };

  return (
    <div className="border-t border-platinum bg-white p-4">
      {/* 빠른 답변 */}
      {quickReplies && quickReplies.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => onSend(reply)}
              disabled={disabled}
              className="rounded-full border border-platinum bg-ivory-50 px-3 py-1.5 text-xs text-noir-800 transition-colors hover:bg-ivory-200 disabled:opacity-50"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {/* 입력 영역 */}
      <div className="flex items-end gap-3">
        {/* 발신자 표시 */}
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white ${
          sender === "groom" ? "bg-blue-500" : "bg-rose-500"
        }`}>
          {sender === "groom" ? "신랑" : "신부"}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="메시지를 입력하세요..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-platinum bg-ivory-50 px-4 py-3 text-sm text-noir-800 placeholder:text-taupe-400 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:bg-taupe-400 disabled:opacity-50 ${
            sender === "groom"
              ? "bg-blue-500 hover:bg-blue-600"
              : "bg-rose-500 hover:bg-rose-600"
          }`}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
