"use client";

import Link from "next/link";
import type { ChatMessage } from "@/types/database.types";
import { Sparkles, BookOpen, ChevronRight, FileText, Heart } from "lucide-react";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";

interface ChatBubbleProps {
  message: ChatMessage;
  isCurrentUser: boolean;
  currentUserRole?: "bride" | "groom" | null;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// [etiquette:N] 태그 파싱
function parseEtiquetteTags(text: string): { cleanText: string; partNumbers: number[] } {
  const partNumbers: number[] = [];
  const cleanText = text.replace(/\[etiquette:(\d+)\]/g, (_, num) => {
    const n = parseInt(num, 10);
    if (n >= 1 && n <= 25 && !partNumbers.includes(n)) partNumbers.push(n);
    return "";
  }).trim();
  return { cleanText, partNumbers };
}

// 사용자 메시지에서 선택 태그 제거 [vendor:...], [product:...], [staff:...], [date:...], [time:...]
function stripSelectionTags(text: string): string {
  return text.replace(/\[(?:vendor|product|staff|date|time):[^\]]*\]/g, "").trim();
}

export default function ChatBubble({
  message,
  isCurrentUser,
  currentUserRole,
}: ChatBubbleProps) {
  const { sender_role, content, created_at } = message;

  // AI 메시지
  if (sender_role === "ai") {
    const { cleanText, partNumbers } = parseEtiquetteTags(content);

    return (
      <div className="flex items-start gap-3 max-w-[85%]">
        {/* AI 아바타 */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#928980]">
            아모라
          </span>
          <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 border border-black/[0.06] shadow-sm">
            <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
              {cleanText}
            </p>
            {partNumbers.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {partNumbers.map((num) => {
                  const part = ETIQUETTE_PARTS.find((p) => p.number === num);
                  if (!part) return null;
                  return (
                    <Link
                      key={num}
                      href={`/etiquette?part=${num}`}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border border-[#E8D5CD]/40 hover:border-[#C4967E]/30 transition-colors group"
                    >
                      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0`}>
                        <BookOpen className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#1A1A1F] truncate">{part.title}</p>
                        <p className="text-[10px] text-[#928980]">예절 가이드 보기</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[#B5ADA3] group-hover:text-[#C4967E] transition-colors flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
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

  // 사용자 메시지에서 선택 태그 숨김
  const displayContent = stripSelectionTags(content);

  // 이미지 URL 목록
  const imageUrls = message.metadata?.imageUrls ?? [];

  // 상대방에게 보낸 직접 메시지 여부
  const isPartnerMsg = message.metadata?.target === "partner";

  if (isCurrentUser) {
    // 내 메시지: 오른쪽 정렬
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1 max-w-[75%]">
          {/* 상대방에게 보낸 메시지 표시 */}
          {isPartnerMsg && (
            <div className="flex items-center gap-1 mr-1">
              <Heart className="w-3 h-3 text-pink-400" />
              <span className="text-[10px] text-pink-400 font-medium">상대방에게</span>
            </div>
          )}
          {/* 첨부 파일 (이미지 + PDF) */}
          {imageUrls.length > 0 && (
            <div className="flex gap-1.5 flex-wrap justify-end mb-1">
              {imageUrls.map((url, i) =>
                url.endsWith(".pdf") ? (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-colors"
                  >
                    <FileText className="w-5 h-5 text-white/80" />
                    <span className="text-xs text-white/80">PDF 문서</span>
                  </a>
                ) : (
                  <img
                    key={i}
                    src={url}
                    alt={`첨부 이미지 ${i + 1}`}
                    className="max-w-[200px] max-h-[200px] rounded-xl object-cover border border-white/20 shadow-sm"
                  />
                )
              )}
            </div>
          )}
          <div
            className={`${isPartnerMsg ? "bg-gradient-to-r from-pink-400 to-rose-400" : myBubbleBg} rounded-2xl rounded-tr-md px-4 py-3 shadow-sm`}
          >
            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
              {displayContent}
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
        className={`flex-shrink-0 w-9 h-9 rounded-full ${isPartnerMsg ? "bg-gradient-to-br from-pink-400 to-rose-400" : avatarBg} flex items-center justify-center shadow-sm`}
      >
        {isPartnerMsg ? (
          <Heart className="w-4 h-4 text-white" />
        ) : (
          <span className="text-white text-xs font-bold">
            {roleLabel.charAt(0)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#928980]">
            {message.sender_id ? "" : roleLabel}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isPartnerMsg ? "bg-pink-100 text-pink-500" : badgeBg}`}
          >
            {isPartnerMsg ? `${roleLabel} → 나에게` : roleLabel}
          </span>
        </div>
        <div
          className={`${isPartnerMsg ? "bg-gradient-to-r from-pink-50 to-rose-50 border-pink-200" : `${partnerBubbleBg} border ${partnerBubbleBorder}`} border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm`}
        >
          <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
            {displayContent}
          </p>
        </div>
        <span className="text-[10px] text-[#B5ADA3] ml-1">
          {formatTime(created_at)}
        </span>
      </div>
    </div>
  );
}
