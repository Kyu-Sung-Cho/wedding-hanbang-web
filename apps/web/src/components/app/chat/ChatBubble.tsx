"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { ChatMessage } from "@/types/database.types";
import { Sparkles, BookOpen, ChevronRight, FileText, Heart, ThumbsUp, ThumbsDown, Send, Check, Lock, RefreshCw, X as XIcon, CheckCircle2 } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import MediationCard, { type MediationBlock } from "@/components/app/chat/MediationCard";

interface ChatBubbleProps {
  message: ChatMessage;
  isCurrentUser: boolean;
  currentUserRole?: "bride" | "groom" | null;
  /** 최근 3개 AI 메시지에만 true — 피드백 버튼 표시용 */
  isRecentAi?: boolean;
}

// 이미 피드백한 메시지 ID를 로컬에 저장 (페이지 리로드 시에도 유지)
const FEEDBACK_STORAGE_KEY = "hanbang_chat_feedback";

function getFeedbackState(): Record<string, "good" | "bad"> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setFeedbackState(messageId: string, rating: "good" | "bad") {
  if (typeof window === "undefined") return;
  try {
    const state = getFeedbackState();
    state[messageId] = rating;
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 사용 불가 시 무시
  }
}

// 피드백 API 호출
async function submitFeedback(messageId: string, rating: "good" | "bad", correction?: string) {
  try {
    const res = await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, rating, correction }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// AI 메시지 피드백 UI
function AiFeedbackRow({ messageId }: { messageId: string }) {
  const [status, setStatus] = useState<"idle" | "input" | "submitted">(() => {
    const saved = getFeedbackState();
    return saved[messageId] ? "submitted" : "idle";
  });
  const [correction, setCorrection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGood = useCallback(async () => {
    setIsSubmitting(true);
    const ok = await submitFeedback(messageId, "good");
    if (ok) {
      setFeedbackState(messageId, "good");
      setStatus("submitted");
    }
    setIsSubmitting(false);
  }, [messageId]);

  const handleBadClick = useCallback(() => {
    setStatus("input");
  }, []);

  const handleBadSubmit = useCallback(async () => {
    if (!correction.trim()) return;
    setIsSubmitting(true);
    const ok = await submitFeedback(messageId, "bad", correction.trim());
    if (ok) {
      setFeedbackState(messageId, "bad");
      setStatus("submitted");
    }
    setIsSubmitting(false);
  }, [messageId, correction]);

  if (status === "submitted") {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-sm text-[#B5ADA3]">
        <Check className="w-4 h-4" />
        <span>반영됐어요</span>
      </div>
    );
  }

  if (status === "input") {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleBadSubmit(); }}
            placeholder="어떻게 하면 좋을까요?"
            className="flex-1 text-base px-3 py-2 rounded-lg border border-[#E8E0D8] bg-[#FAF8F5] text-[#1A1A1F] placeholder-[#B5ADA3] focus:outline-none focus:border-[#C4967E]/40"
            autoFocus
            disabled={isSubmitting}
          />
          <button
            onClick={handleBadSubmit}
            disabled={isSubmitting || !correction.trim()}
            className="p-2 rounded-lg bg-[#C4967E]/10 text-[#9A6B62] hover:bg-[#C4967E]/20 disabled:opacity-40 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-3 opacity-0 group-hover/ai:opacity-100 transition-opacity duration-200">
      <button
        onClick={handleGood}
        disabled={isSubmitting}
        className="flex items-center gap-1.5 text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors disabled:opacity-40"
        title="도움됐어요"
      >
        <ThumbsUp className="w-4 h-4" />
        <span>도움됐어요</span>
      </button>
      <button
        onClick={handleBadClick}
        disabled={isSubmitting}
        className="flex items-center gap-1.5 text-sm text-[#B5ADA3] hover:text-[#928980] transition-colors disabled:opacity-40"
        title="아쉬워요"
      >
        <ThumbsDown className="w-4 h-4" />
        <span>아쉬워요</span>
      </button>
    </div>
  );
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

// 인라인 마크다운: **bold**
function renderInlineMd(text: string, prefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${prefix}-${i}`} className="font-semibold text-[#1A1A1F]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${prefix}-${i}`}>{part}</span>;
  });
}

// markdown table row 파싱 — "| a | b | c |" → ["a", "b", "c"]
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

// separator row 여부 ("|---|---|" 또는 "|:---|---:|" 등)
function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  if (!cells) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

// AI 메시지 라이트 마크다운 렌더 (### 헤더, **bold**, - 불릿, | 테이블)
function renderAiMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 테이블 감지 — 현재 줄이 table row이고 다음 줄이 separator 이면 표.
    const headerCells = parseTableRow(line);
    if (headerCells && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      // 데이터 row 수집
      const dataRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length) {
        const row = parseTableRow(lines[j]);
        if (!row) break;
        dataRows.push(row);
        j++;
      }
      blocks.push(
        <div key={`t-${i}`} className="my-2 overflow-x-auto rounded-lg border border-[#E8DDD3] bg-white/60">
          <table className="w-full text-xs sm:text-[0.8125rem] border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2]">
                {headerCells.map((c, ci) => (
                  <th
                    key={ci}
                    className="px-2.5 py-1.5 text-left font-semibold text-[#1A1A1F] border-b border-[#E8DDD3]"
                  >
                    {renderInlineMd(c, `th-${i}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? "bg-[#FAF7F2]/40" : ""}>
                  {row.map((c, ci) => (
                    <td
                      key={ci}
                      className="px-2.5 py-1.5 text-[#1A1A1F] border-b border-[#E8DDD3]/60 align-top"
                    >
                      {renderInlineMd(c, `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j;
      continue;
    }

    // 헤더 (###, ##, #)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        <div
          key={i}
          className="font-serif-kr font-semibold text-base sm:text-lg text-[#1A1A1F] mt-3 first:mt-0 mb-1"
        >
          {renderInlineMd(headingMatch[2], `h-${i}`)}
        </div>
      );
      i++;
      continue;
    }
    // 불릿 (-, *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push(
        <div key={i} className="flex gap-2 my-0.5">
          <span className="text-[#C4967E] flex-shrink-0">•</span>
          <span className="flex-1">{renderInlineMd(bulletMatch[1], `b-${i}`)}</span>
        </div>
      );
      i++;
      continue;
    }
    // 빈 줄 → 간격
    if (trimmed === "") {
      blocks.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }
    // 일반 라인
    blocks.push(
      <div key={i} className="leading-relaxed">
        {renderInlineMd(line, `p-${i}`)}
      </div>
    );
    i++;
  }
  return blocks;
}

// 사용자 메시지에서 선택 태그 제거 [vendor:...], [product:...], [staff:...], [date:...], [time:...]
function stripSelectionTags(text: string): string {
  return text.replace(/\[(?:vendor|product|staff|date|time):[^\]]*\]/g, "").trim();
}

export default function ChatBubble({
  message,
  isCurrentUser,
  currentUserRole,
  isRecentAi = false,
}: ChatBubbleProps) {
  const { sender_role, content, created_at } = message;

  // 함께 대화 새로 시작 — 동의 요청 메시지는 별도 카드로 렌더 (양쪽에 보임)
  if (message.metadata?.clearRequest) {
    return (
      <ClearRequestCard
        message={message}
        isRequester={isCurrentUser}
        createdAt={created_at}
      />
    );
  }

  // AI 메시지
  if (sender_role === "ai") {
    const { cleanText, partNumbers } = parseEtiquetteTags(content);
    const aiIsPrivate =
      message.visibility === "bride_private" || message.visibility === "groom_private";

    return (
      <div className="group/ai flex items-start gap-2 sm:gap-3 max-w-[94%] sm:max-w-[53.75rem]">
        {/* AI 아바타 — 모바일에선 작게 */}
        <div className="flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-base font-medium text-[#928980] flex items-center gap-1.5">
            아모라
            {aiIsPrivate && (
              <span className="inline-flex items-center gap-1 text-xs text-[#5a6147] font-normal">
                <Lock className="w-3 h-3" />
                나만 보기
              </span>
            )}
          </span>
          <div className={`bg-white rounded-2xl rounded-tl-md px-4 py-3 sm:px-5 sm:py-4 border shadow-sm ${
            aiIsPrivate ? "border-[#5a6147]/25 ring-1 ring-[#5a6147]/10" : "border-black/[0.06]"
          }`}>
            <div className="text-xs sm:text-sm text-[#1A1A1F] leading-relaxed break-words">
              {renderAiMarkdown(cleanText)}
            </div>
            {partNumbers.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {partNumbers.map((num) => {
                  const part = ETIQUETTE_PARTS.find((p) => p.number === num);
                  if (!part) return null;
                  return (
                    <Link
                      key={num}
                      href={`/etiquette?part=${num}`}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] border border-[#E8D5CD]/40 hover:border-[#C4967E]/30 transition-colors group"
                    >
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0`}>
                        <BookOpen className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium text-[#1A1A1F] truncate">{part.title}</p>
                        <p className="text-sm text-[#928980]">예절 가이드 보기</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#B5ADA3] group-hover:text-[#C4967E] transition-colors flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <span className="text-sm text-[#B5ADA3] ml-1">
            {formatTime(created_at)}
          </span>
          {/* AI 고지 footer 는 채팅 상단 헤더 배지로 통합됨 — 메시지별 반복 제거.
              AI 기본법(2026.1.22) 표시 의무는 ChatContent 헤더 "AI 생성" 배지 +
              /ai-policy 링크로 충족. 가독성 회복 (이전 사고: 매 메시지 footer 가
              과잉). */}
          {/* 피드백 버튼 — 최근 3개 AI 메시지에만 표시 */}
          {isRecentAi && (
            <AiFeedbackRow messageId={message.id} />
          )}
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

  // 갈등 중재 시각 카드 — AI가 [mediation] 마커로 응답하면 백엔드가 metadata.mediation에 추출.
  const mediationBlock: MediationBlock | undefined = message.metadata?.mediation as
    | MediationBlock
    | undefined;

  // 이미지 URL 목록
  const imageUrls = message.metadata?.imageUrls ?? [];

  // 상대방에게 보낸 직접 메시지 여부
  const isPartnerMsg = message.metadata?.target === "partner";
  // 비공개 메시지 (RLS로 본인+아모라만 SELECT됨 — 여기 도달했으면 본인이 볼 권한 있음)
  const isPrivateMsg =
    message.visibility === "bride_private" || message.visibility === "groom_private";

  if (isCurrentUser) {
    // 내 메시지: 오른쪽 정렬
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1.5 max-w-[88%] sm:max-w-[75%]">
          {/* 상대방에게 보낸 메시지 표시 */}
          {isPartnerMsg && (
            <div className="flex items-center gap-1.5 mr-1">
              <Heart className="w-4 h-4 text-pink-400" />
              <span className="text-sm text-pink-400 font-medium">상대방에게</span>
            </div>
          )}
          {/* 비공개 메시지 표시 */}
          {isPrivateMsg && !isPartnerMsg && (
            <div className="flex items-center gap-1.5 mr-1">
              <Lock className="w-3.5 h-3.5 text-[#5a6147]" />
              <span className="text-xs text-[#5a6147] font-medium tracking-wide">나만 보기</span>
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
                    <span className="text-sm text-white/80">PDF 문서</span>
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
            className={`${isPartnerMsg ? "bg-gradient-to-r from-pink-400 to-rose-400" : myBubbleBg} rounded-2xl rounded-tr-md px-5 py-4 shadow-sm`}
          >
            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
              {displayContent}
            </p>
          </div>
          <span className="text-sm text-[#B5ADA3] mr-1">
            {formatTime(created_at)}
          </span>
        </div>
      </div>
    );
  }

  // 상대방 메시지: 왼쪽 정렬
  return (
    <div className="flex items-start gap-2 sm:gap-3 max-w-[94%] sm:max-w-[53.75rem]">
      {/* 아바타 — 모바일 작게 */}
      <div
        className={`flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full ${isPartnerMsg ? "bg-gradient-to-br from-pink-400 to-rose-400" : avatarBg} flex items-center justify-center shadow-sm`}
      >
        {isPartnerMsg ? (
          <Heart className="w-5 h-5 text-white" />
        ) : (
          <span className="text-white text-base font-bold">
            {roleLabel.charAt(0)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-[#928980]">
            {message.sender_id ? "" : roleLabel}
          </span>
          <span
            className={`text-sm px-2 py-0.5 rounded-full font-medium ${isPartnerMsg ? "bg-pink-100 text-pink-500" : badgeBg}`}
          >
            {isPartnerMsg ? `${roleLabel} → 나에게` : roleLabel}
          </span>
        </div>
        <div
          className={`${isPartnerMsg ? "bg-gradient-to-r from-pink-50 to-rose-50 border-pink-200" : `${partnerBubbleBg} border ${partnerBubbleBorder}`} border rounded-2xl rounded-tl-md px-5 py-4 shadow-sm`}
        >
          <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
            {displayContent}
          </p>
        </div>
        {mediationBlock && <MediationCard block={mediationBlock} />}
        <span className="text-sm text-[#B5ADA3] ml-1">
          {formatTime(created_at)}
        </span>
      </div>
    </div>
  );
}


// ── 함께 대화 새로시작 동의 카드 ──
// 양쪽 동의 후에만 cleared_at 갱신 → 일방적 데이터 손실 방지 (이전 사고).
function ClearRequestCard({
  message,
  isRequester,
  createdAt,
}: {
  message: ChatMessage;
  isRequester: boolean;
  createdAt: string;
}) {
  const cr = message.metadata?.clearRequest;
  const respondToClearRequest = useChatStore((s) => s.respondToClearRequest);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!cr) return null;

  const isPending = cr.status === "pending";
  const isAccepted = cr.status === "accepted";
  const isDeclined = cr.status === "declined";

  const handle = async (action: "accept" | "decline") => {
    setPending(action);
    setError(null);
    const result = await respondToClearRequest(message.id, action);
    if (!result.ok) {
      setError(result.error ?? "응답에 실패했어요.");
      setPending(null);
    }
  };

  return (
    <div className="flex justify-center w-full my-2">
      <div className="w-full max-w-[28rem] rounded-xl border border-[#E8DDD3] bg-gradient-to-br from-[#FAF7F2] to-white shadow-sm px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#795252]/10">
            <RefreshCw className="w-3.5 h-3.5 text-[#795252]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#1A1A1F]">
              {isAccepted
                ? "함께 새로 시작했어요"
                : isDeclined
                  ? "함께 새로시작 요청이 거절됐어요"
                  : "함께 대화 새로시작 제안"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[#504444]">
              {isAccepted
                ? "양쪽 화면이 깨끗하게 정리됐어요. 데이터는 보존돼 있어요."
                : isDeclined
                  ? "기존 대화는 그대로 유지돼요."
                  : isRequester
                    ? "상대방 동의를 기다리는 중이에요. 동의하면 양쪽 화면이 정리돼요."
                    : "상대방이 함께 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 정리돼요."}
            </p>

            {/* pending + 상대방 → 액션 버튼 */}
            {isPending && !isRequester && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => handle("accept")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#795252] text-white text-xs font-medium hover:bg-[#946a6a] disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {pending === "accept" ? "처리 중..." : "동의"}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => handle("decline")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#E8DDD3] text-[#504444] text-xs font-medium hover:bg-[#FAF7F2] disabled:opacity-50"
                >
                  <XIcon className="w-3.5 h-3.5" />
                  거절
                </button>
              </div>
            )}
            {error && (
              <p className="mt-2 text-xs text-red-500">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
