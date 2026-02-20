"use client";

import type { ChatMessage } from "@/types/database.types";
import { Sparkles } from "lucide-react";

interface ChatBubbleProps {
  message: ChatMessage;
  isCurrentUser: boolean;
  currentUserRole?: "bride" | "groom" | null;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatBubble({
  message,
  isCurrentUser,
  currentUserRole,
}: ChatBubbleProps) {
  const { sender_role, content, created_at } = message;

  // AI 메시지
  if (sender_role === "ai") {
    return (
      <div className="flex items-start gap-3 max-w-[85%]">
        {/* AI 아바타 */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#928980]">
            AI 플래너
          </span>
          <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 border border-black/[0.06] shadow-sm">
            <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
          <span className="text-[10px] text-[#B5ADA3] ml-1">
            {formatTime(created_at)}
          </span>
        </div>
      </div>
    );
  }

  // 사용자 메시지 (내 메시지 = 오른쪽, 상대방 = 왼쪽)
  const isBride = sender_role === "bride";
  const roleLabel = isBride ? "신부" : "신랑";

  // 버블 색상
  const myBubbleBg = isBride ? "bg-[#C4967E]" : "bg-[#3B5998]";
  const partnerBubbleBg = isBride ? "bg-[#F5E6DF]" : "bg-[#E8EDF5]";
  const partnerBubbleBorder = isBride
    ? "border-[#E8D5CD]"
    : "border-[#D4DCE8]";

  // 아바타 색상
  const avatarBg = isBride
    ? "bg-gradient-to-br from-[#C4967E] to-[#E8C4B8]"
    : "bg-gradient-to-br from-[#3B5998] to-[#6B8CCE]";
  const badgeBg = isBride ? "bg-[#C4967E]/20 text-[#9A6B62]" : "bg-[#3B5998]/20 text-[#3B5998]";

  if (isCurrentUser) {
    // 내 메시지: 오른쪽 정렬
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1 max-w-[75%]">
          <div
            className={`${myBubbleBg} rounded-2xl rounded-tr-md px-4 py-3 shadow-sm`}
          >
            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
          <span className="text-[10px] text-[#B5ADA3] mr-1">
            {formatTime(created_at)}
          </span>
        </div>
      </div>
    );
  }

  // 상대방 메시지: 왼쪽 정렬
  return (
    <div className="flex items-start gap-3 max-w-[85%]">
      {/* 아바타 */}
      <div
        className={`flex-shrink-0 w-9 h-9 rounded-full ${avatarBg} flex items-center justify-center shadow-sm`}
      >
        <span className="text-white text-xs font-bold">
          {roleLabel.charAt(0)}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#928980]">
            {message.sender_id ? "" : roleLabel}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeBg}`}
          >
            {roleLabel}
          </span>
        </div>
        <div
          className={`${partnerBubbleBg} border ${partnerBubbleBorder} rounded-2xl rounded-tl-md px-4 py-3 shadow-sm`}
        >
          <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        </div>
        <span className="text-[10px] text-[#B5ADA3] ml-1">
          {formatTime(created_at)}
        </span>
      </div>
    </div>
  );
}
