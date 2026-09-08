"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import type { ChatMessage } from "@/types/database.types";
import { Sparkles, BookOpen, ChevronRight, FileText, Heart, ThumbsUp, ThumbsDown, Send, Check, Lock, RefreshCw, X as XIcon, CheckCircle2, Bookmark, BookmarkCheck, User } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { isSavedNoteScopeCurrent, observeSavedNote, refreshSavedNote, setSavedNoteIdentity, useSavedNoteStore } from "@/stores/savedNoteStore";
import MediationCard from "@/components/app/chat/MediationCard";
import AmoraNoteSaveSheet from "./AmoraNoteSaveSheet";
import PersonalActionSaveButton from "./PersonalActionSaveButton";
import { normalizeMediationBlock } from "@/components/app/chat/mediationBlock";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { stripAmoraRequestMarkers } from "@/lib/ai/amoraRequestMarkers";
import { isUuid } from "@/utils/requestValidation";
import { MANNERS_PARTS } from "@/lib/manners/data";
import {
  addStoredChatFeedback,
  parseStoredChatFeedback,
  type StoredChatFeedbackRating,
  type StoredChatFeedbackState,
} from "@/lib/ai/chatFeedbackState";

interface ChatBubbleProps {
  message: ChatMessage;
  isCurrentUser: boolean;
  /** 상대방 메시지에 띄울 이름. 성별 슬롯이 아니라 사람을 가리킨다. */
  senderName?: string | null;
  /** 최근 3개 AI 메시지에만 true — 피드백 버튼 표시용 */
  isRecentAi?: boolean;
  onNegativeFeedback?: (message: ChatMessage) => void;
}

// 이미 피드백한 메시지 ID를 로컬에 저장 (페이지 리로드 시에도 유지)
const FEEDBACK_STORAGE_KEY = "hanbang_chat_feedback";

function getFeedbackState(): StoredChatFeedbackState {
  if (typeof window === "undefined") return {};
  return parseStoredChatFeedback(localStorage.getItem(FEEDBACK_STORAGE_KEY));
}

function setFeedbackState(messageId: string, rating: StoredChatFeedbackRating) {
  if (typeof window === "undefined") return;
  try {
    const state = addStoredChatFeedback(getFeedbackState(), messageId, rating);
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 사용 불가 시 무시
  }
}

/** 기본 문구. 옆의 저장 버튼이 쓰는 "저장 실패 · 다시" 와 같은 결이다. */
const FEEDBACK_FAILED = "의견을 남기지 못했어요. 다시 시도해 주세요.";

/**
 * 피드백 API 호출.
 *
 * 예전에는 `res.ok` 만 돌려줘서 **서버가 준 이유가 여기서 사라졌다.** 1시간에 20회
 * 제한(429), 세션 만료(401), 저장 실패(500) 가 전부 "아무 일도 안 일어남"으로 보였다.
 */
async function submitFeedback(
  messageId: string,
  rating: "good" | "bad",
  correction?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, rating, correction }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      message: typeof data?.error === "string" && data.error.trim()
        ? data.error
        : FEEDBACK_FAILED,
    };
  } catch {
    return { ok: false, message: FEEDBACK_FAILED };
  }
}

function isPdfUrl(url: string) {
  return url.split("?")[0]?.toLowerCase().endsWith(".pdf") ?? false;
}

function ChatImageAttachments({
  messageId,
  metadata,
}: {
  messageId: string;
  metadata: ChatMessage["metadata"];
}) {
  const storedImageUrls = metadata?.imageUrls ?? [];
  const storedImagePaths = metadata?.imagePaths ?? [];
  const attachmentKey = `${messageId}|${[...storedImagePaths, ...storedImageUrls].join("|")}`;
  const hasAttachments = storedImagePaths.length > 0 || storedImageUrls.length > 0;
  const [signedImageState, setSignedImageState] = useState<{ key: string; urls: string[] }>({
    key: "",
    urls: [],
  });

  useEffect(() => {
    if (!hasAttachments) return;

    let cancelled = false;

    fetch("/api/chat/image-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    })
      .then((res) => (res.ok ? res.json() : { urls: [] }))
      .then((payload: { urls?: { signedUrl?: string | null }[] }) => {
        if (cancelled) return;
        setSignedImageState({
          key: attachmentKey,
          urls: (payload.urls ?? [])
            .map((item) => item.signedUrl)
            .filter((url): url is string => Boolean(url)),
        });
      })
      .catch(() => {
        if (!cancelled) setSignedImageState({ key: attachmentKey, urls: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [attachmentKey, hasAttachments, messageId]);

  const signedImageUrls =
    signedImageState.key === attachmentKey ? signedImageState.urls : [];
  const imageUrls = signedImageUrls;
  if (imageUrls.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap justify-end mb-1">
      {imageUrls.map((url, i) =>
        isPdfUrl(url) ? (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-white/10 border border-white/20 hover:bg-white/20 transition-colors"
          >
            <FileText className="w-5 h-5 text-white/80" />
            <span className="text-sm text-white/80">PDF 문서</span>
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- Dynamic signed attachment URLs are not good candidates for next/image optimization.
          <img
            key={i}
            src={url}
            alt={`첨부 이미지 ${i + 1}`}
            className="max-w-[200px] max-h-[200px] rounded-[6px] object-cover border border-white/20 shadow-sm"
          />
        )
      )}
    </div>
  );
}

// AI 메시지 피드백 UI
export function AiFeedbackRow({
  messageId,
  onNegativeFeedback,
}: {
  messageId: string;
  onNegativeFeedback?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "input" | "submitted">(() => {
    const saved = getFeedbackState();
    return saved[messageId] ? "submitted" : "idle";
  });
  const [correction, setCorrection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const handleGood = useCallback(async () => {
    setIsSubmitting(true);
    setFeedbackError(null);
    const result = await submitFeedback(messageId, "good");
    if (result.ok) {
      setFeedbackState(messageId, "good");
      setStatus("submitted");
    } else {
      setFeedbackError(result.message);
    }
    setIsSubmitting(false);
  }, [messageId]);

  const handleBadClick = useCallback(() => {
    onNegativeFeedback?.();
    setStatus("input");
  }, [onNegativeFeedback]);

  const handleBadSubmit = useCallback(async () => {
    if (!correction.trim()) return;
    setIsSubmitting(true);
    setFeedbackError(null);
    const result = await submitFeedback(messageId, "bad", correction.trim());
    if (result.ok) {
      setFeedbackState(messageId, "bad");
      setStatus("submitted");
    } else {
      // 적은 내용은 그대로 둔다 — 다시 보낼 수 있어야 한다.
      setFeedbackError(result.message);
    }
    setIsSubmitting(false);
  }, [messageId, correction]);

  if (status === "submitted") {
    return (
      <div
        role="status"
        className="mt-2 flex items-center gap-1.5 text-sm text-[var(--hb-text-muted)]"
      >
        <Check className="w-4 h-4" />
        <span>의견을 남겼어요</span>
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
            placeholder="예: 더 짧게, 덜 딱딱하게"
            className="flex-1 text-base px-3 py-2 rounded-[6px] border border-[#E8E0D8] bg-[#FAF8F5] text-[var(--hb-text-strong)] placeholder-[#B5ADA3] focus:outline-none focus:border-[#C4967E]/40"
            autoFocus
            disabled={isSubmitting}
          />
          <button
            type="button"
            aria-label="의견 보내기"
            onClick={handleBadSubmit}
            disabled={isSubmitting || !correction.trim()}
            className="p-2 rounded-[6px] bg-[#C4967E]/10 text-[#9A6B62] hover:bg-[#C4967E]/20 disabled:opacity-40 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {feedbackError ? (
          <p role="alert" className="text-sm text-[#D95F5F]">
            {feedbackError}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-[var(--hb-text-muted)]">
          이 의견과 해당 공유 답변은 품질 확인용 기록에 저장돼요. 민감정보는
          적지 마세요. 다음 답변을 바로 바꾸려면 채팅에 그대로 말씀해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      {feedbackError ? (
        <p role="alert" className="text-sm text-[#D95F5F]">
          {feedbackError}
        </p>
      ) : null}
    <div
      data-testid="amora-feedback-row"
      className="flex items-center gap-3 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover/ai:opacity-100 sm:focus-within:opacity-100"
    >
      <button
        type="button"
        onClick={handleGood}
        disabled={isSubmitting}
        className="flex items-center gap-1.5 text-sm text-[var(--hb-text-muted)] hover:text-[#C4967E] transition-colors disabled:opacity-40"
        title="도움됐어요"
      >
        <ThumbsUp className="w-4 h-4" />
        <span>도움됐어요</span>
      </button>
      <button
        type="button"
        onClick={handleBadClick}
        disabled={isSubmitting}
        className="flex items-center gap-1.5 text-sm text-[var(--hb-text-muted)] hover:text-[var(--hb-text-muted)] transition-colors disabled:opacity-40"
        title="아쉬워요"
      >
        <ThumbsDown className="w-4 h-4" />
        <span>아쉬워요</span>
      </button>
    </div>
    </div>
  );
}

// 아모라가 한 말 저장 — 대화가 길어지면 앞에서 들은 중요한 말이 스크롤 뒤로
// 묻힌다. 저장해 두면 /wedding/saved 한 곳에서 다시 볼 수 있다.
export function SaveNoteButton({ messageId, content, coupleId }: { messageId: string; content: string; coupleId: string }) {
  const scope = useSavedNoteStore(state => state.scope);
  return <MessageSaveNoteButton key={`${scope}:${messageId}`} scope={scope} coupleId={coupleId} messageId={messageId} content={content} />;
}

function MessageSaveNoteButton({ messageId, content, coupleId, scope }: { messageId: string; content: string; coupleId: string; scope: number }) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "deleting" | "error">("idle");
  const entry = useSavedNoteStore(state => state.entries[messageId]);
  const savedNote = entry?.note;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unappliedMemo, setUnappliedMemo] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const savedLinkRef = useRef<HTMLAnchorElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusAfterDelete = useRef(false);

  useEffect(() => observeSavedNote(messageId, coupleId), [messageId, coupleId]);

  useEffect(() => {
    if (status === "saved") savedLinkRef.current?.focus();
  }, [status]);
  useEffect(() => {
    if (!savedNote && focusAfterDelete.current) { focusAfterDelete.current = false; triggerRef.current?.focus(); }
  }, [savedNote]);

  const handleSave = useCallback(async (memo: string) => {
    if (!reviewOpen || saveInFlight.current || !isSavedNoteScopeCurrent(scope) || memo.length > 500) return;
    saveInFlight.current = true;
    setStatus("saving");
    setSaveError(null);
    try {
      const response = await fetch("/api/amora/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 본문은 서버가 공유 메시지 원문에서 읽는다. 클라이언트 사본은 전송하지 않는다.
        body: JSON.stringify({ messageId, memo }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!isSavedNoteScopeCurrent(scope)) return;
      if (
        !response.ok
        || !payload
        || typeof payload !== "object"
        || !("saved" in payload)
        || payload.saved !== true
        || !("id" in payload) || !isUuid(payload.id)
        || !("memoApplied" in payload) || typeof payload.memoApplied !== "boolean"
        || ("savedByMe" in payload && typeof payload.savedByMe !== "boolean")
      ) {
        const error = payload && typeof payload === "object" && "error" in payload
          && typeof payload.error === "string" && payload.error.trim()
          ? payload.error.slice(0, 400)
          : "저장 여부를 확인하지 못했어요. 로그인 상태를 확인하고 다시 시도해 주세요.";
        setSaveError(error);
        setStatus("error");
        return;
      }
      setUnappliedMemo(payload.memoApplied ? null : memo);
      setSavedNoteIdentity(scope, messageId, { id: payload.id, messageId, savedByMe: "savedByMe" in payload ? payload.savedByMe === true : null });
      setStatus("saved");
      setReviewOpen(false);
    } catch {
      if (!isSavedNoteScopeCurrent(scope)) return;
      setSaveError("저장 여부를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setStatus("error");
    } finally {
      saveInFlight.current = false;
    }
  }, [messageId, reviewOpen, scope]);

  const handleUnsave = async () => {
    if (!savedNote?.savedByMe || saveInFlight.current || !isSavedNoteScopeCurrent(scope)) return;
    saveInFlight.current = true; setStatus("deleting"); setSaveError(null);
    try {
      const response = await fetch("/api/amora/notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedNote.id }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!isSavedNoteScopeCurrent(scope)) return;
      if (!response.ok || !payload || typeof payload !== "object" || !("deleted" in payload) || payload.deleted !== true || !("id" in payload) || payload.id !== savedNote.id) {
        setSaveError("저장 취소를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."); setStatus("error"); return;
      }
      focusAfterDelete.current = true;
      setSavedNoteIdentity(scope, messageId, null); setUnappliedMemo(null); setStatus("idle");
    } catch {
      if (isSavedNoteScopeCurrent(scope)) { setSaveError("저장 취소를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."); setStatus("error"); }
    } finally { saveInFlight.current = false; }
  };

  const closeReview = () => {
    if (!saveInFlight.current) setReviewOpen(false);
  };

  if (savedNote && !reviewOpen) {
    return (
      <div>
      {savedNote.savedByMe === false && <p className="mb-1 text-sm text-[var(--hb-text-muted)]">파트너가 저장한 답변이에요.</p>}
      {saveError && <p role="alert" className="mb-2 text-sm text-[var(--hb-text-muted)]">{saveError}</p>}
      {unappliedMemo !== null && <div role="status" className="mb-2 text-sm leading-relaxed text-[var(--hb-text-muted)]">
        <p>답변은 이미 저장되어 있어요. 이번 메모는 반영되지 않았어요. 저장함에서 기존 메모를 확인하고 수정해 주세요.</p>
        {unappliedMemo && <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3">내가 쓴 메모 다시 보기</summary><p className="select-text break-words whitespace-pre-wrap">{unappliedMemo}</p></details>}
      </div>}
      <Link
        ref={savedLinkRef}
        {...weddingLinkProps("/saved")}
        className="flex items-center gap-1.5 text-sm text-[#9A6B62] transition-colors hover:text-[#C4967E]"
      >
        <BookmarkCheck className="w-4 h-4" />
        <span>저장함 · 보러가기</span>
      </Link>
      {savedNote.savedByMe && <Button variant="ghost" type="button" aria-label="내 저장 취소" disabled={status === "deleting"} onClick={() => void handleUnsave()} className="mt-1 min-h-11 px-0! py-0! font-normal! text-sm! text-[var(--hb-text-muted)]! hover:bg-transparent! hover:text-[#9A6B62]! disabled:opacity-40!">{status === "deleting" ? "취소 중…" : "내 저장 취소"}</Button>}
      {entry?.status === "error" && <Button variant="ghost" type="button" onClick={() => refreshSavedNote(messageId)} className="min-h-11 px-0! py-0! font-normal! text-sm! text-[var(--hb-text-muted)]! hover:bg-transparent!">저장 상태 다시 확인</Button>}
      </div>
    );
  }

  return (
    <>
    {entry?.status === "error" && <Button variant="ghost" type="button" onClick={() => refreshSavedNote(messageId)} className="min-h-11 px-0! py-0! font-normal! text-sm! text-[var(--hb-text-muted)]! hover:bg-transparent!">저장 상태 다시 확인</Button>}
    <button
      ref={triggerRef}
      type="button"
      onClick={() => { setSaveError(null); setReviewOpen(true); }}
      disabled={status === "saving" || entry?.status === "loading"}
      aria-haspopup="dialog"
      aria-expanded={reviewOpen}
      className="flex items-center gap-1.5 text-sm text-[var(--hb-text-muted)] transition-colors hover:text-[#C4967E] disabled:opacity-40"
      title="나중에 다시 보기"
    >
      <Bookmark className="w-4 h-4" />
      <span>{entry?.status === "loading" ? "저장 상태 확인 중…" : status === "error" ? "저장 실패 · 다시" : "저장"}</span>
    </button>
    {reviewOpen && (
      <AmoraNoteSaveSheet
        content={content}
        busy={status === "saving"}
        error={saveError}
        onSave={memo => void handleSave(memo)}
        onClose={closeReview}
      />
    )}
    </>
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}.${value("month")}.${value("day")} ${value("hour")}:${value("minute")}`;
}

// [etiquette:N] 태그 파싱
//
// 제목이 붙은 `[etiquette:2:상견례]` 도 받는다.
//
// 프롬프트는 `[etiquette:번호]` 만 쓰라고 하지만 모델은 제목을 덧붙인다
// (2026-08-23 실측: `[etiquette:2:상견례]`, `[etiquette:3:예물예단]`).
// 숫자만 받는 정규식은 그 형태를 못 잡아 **태그가 날것 그대로 사용자에게
// 보였다.** 모델을 더 조이는 것보다 화면이 관대한 편이 안전하다 — 못 읽으면
// 그대로 노출되고, 읽으면 읽기 카드가 된다.
function parseEtiquetteTags(text: string): { cleanText: string; partNumbers: number[] } {
  const partNumbers: number[] = [];
  const cleanText = text.replace(/\[etiquette:(\d+)(?::[^\]]*)?\]/g, (_, num) => {
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
        <strong key={`${prefix}-${i}`} className="font-semibold text-[var(--hb-text-strong)]">
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
        <div key={`t-${i}`} className="my-2 overflow-x-auto rounded-[6px] border border-[#E8DDD3] bg-white/80">
          <table className="min-w-[34rem] w-full text-[0.8125rem] sm:text-sm border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2]">
                {headerCells.map((c, ci) => (
                  <th
                    key={ci}
                    className="px-2.5 py-1.5 text-left font-semibold text-[var(--hb-text-strong)] border-b border-[#E8DDD3]"
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
                      className="px-2.5 py-1.5 text-[var(--hb-text-strong)] border-b border-[#E8DDD3]/60 align-top"
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
          className="font-serif-kr font-semibold text-base sm:text-lg text-[var(--hb-text-strong)] mt-3 first:mt-0 mb-1.5"
        >
          {renderInlineMd(headingMatch[2], `h-${i}`)}
        </div>
      );
      i++;
      continue;
    }
    // 불릿 (-, *)
    const checkboxMatch = trimmed.match(/^(?:[-*]\s*)?(?:\[( |x|X)\]|☐|□|✅|✓|✔)\s+(.+)$/);
    if (checkboxMatch) {
      const rawState = checkboxMatch[1];
      const checked = rawState?.toLowerCase() === "x" || /^[✅✓✔]/.test(trimmed);
      blocks.push(
        <div
          key={i}
          className="my-1.5 flex items-start gap-2 rounded-[6px] border border-[#E8DDD3]/70 bg-white/70 px-3 py-2"
        >
          <span
            className={`mt-0.5 flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-[6px] border ${
              checked
                ? "border-[#2E7D5A] bg-[#2E7D5A]"
                : "border-[#B5ADA3] bg-white"
            }`}
          >
            {checked && <Check className="h-3 w-3 text-white" />}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            {renderInlineMd(checkboxMatch[2], `cb-${i}`)}
          </span>
        </div>
      );
      i++;
      continue;
    }
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberedMatch) {
      blocks.push(
        <div key={i} className="my-1.5 flex items-start gap-2">
          <span className="mt-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#F3E7E1] px-1.5 text-[0.6875rem] font-semibold text-[var(--hb-accent-hover)]">
            {numberedMatch[1]}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            {renderInlineMd(numberedMatch[2], `n-${i}`)}
          </span>
        </div>
      );
      i++;
      continue;
    }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push(
        <div key={i} className="my-1 flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C4967E]" />
          <span className="min-w-0 flex-1 leading-relaxed">{renderInlineMd(bulletMatch[1], `b-${i}`)}</span>
        </div>
      );
      i++;
      continue;
    }
    // 인용문 (>)
    //
    // 2026-08-26 운영 실측: 8월 아모라 답변 384건 중 27건(7%)에 마크다운 원문이
    // 글자 그대로 찍혔고 그중 25건이 `>` 였다. 하필 **업체에 보낼 문장을 인용문으로
    // 주는 패턴**이라, "복사해서 보내세요" 라고 준 문장 앞에 `>` 가 붙어 나갔다.
    //
    // 프롬프트로 서식을 금지하는 방식은 쓰지 않는다 — 모델이 지키지 않으면 그대로
    // 재발하고, 실제로 넉 달간 재발했다. 렌더러가 받아 주는 쪽이 결정적이다.
    if (/^>\s?/.test(trimmed)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <div
          key={`q-${i}`}
          className="my-2 border-l-2 border-[#C4967E]/60 bg-[#FBF7F4] py-2 pl-3 pr-2 text-[var(--hb-text-body)]"
        >
          {quoted.map((q, qi) => (
            <div key={qi} className="leading-relaxed">
              {q === "" ? <span className="block h-2" /> : renderInlineMd(q, `q-${i}-${qi}`)}
            </div>
          ))}
        </div>
      );
      continue;
    }
    // 수평선 (---, ***, ___)
    if (/^([-*_])\1{2,}$/.test(trimmed.replace(/\s+/g, ""))) {
      blocks.push(<div key={i} className="my-3 border-t border-[#E8DDD3]" />);
      i++;
      continue;
    }
    // 코드펜스 (```) — 안쪽은 서식을 적용하지 않고 그대로 보여 준다.
    if (/^```/.test(trimmed)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 펜스
      blocks.push(
        <pre
          key={`c-${i}`}
          className="my-2 overflow-x-auto rounded-[6px] bg-[#F5F1EE] px-3 py-2 text-[0.8125rem] leading-relaxed text-[#3A3330]"
        >
          {code.join("\n")}
        </pre>
      );
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
  senderName = null,
  isRecentAi = false,
  onNegativeFeedback,
}: ChatBubbleProps) {
  const { sender_role, content, created_at } = message;

  // 함께 대화 새로 시작 — 동의 요청 메시지는 별도 카드로 렌더 (양쪽에 보임)
  if (message.metadata?.clearRequest) {
    return (
      <ClearRequestCard
        message={message}
        isRequester={isCurrentUser}
      />
    );
  }

  // AI 메시지
  if (sender_role === "ai") {
    const { cleanText, partNumbers } = parseEtiquetteTags(stripAmoraRequestMarkers(content));
    const mediationBlock = normalizeMediationBlock(message.metadata?.mediation);
    const aiIsPrivate =
      message.visibility === "bride_private" || message.visibility === "groom_private";

    return (
      <div className="group/ai flex max-w-[90%] items-start gap-2 sm:max-w-[80%]">
        {/* AI 아바타 — 모바일에선 작게 */}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--amora-accent,#486455)] sm:size-8">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--amora-muted,#605E54)]">
            아모라
            {aiIsPrivate && (
              <span className="inline-flex items-center gap-1 text-xs text-[#5a6147] font-normal">
                <Lock className="w-3 h-3" />
                나만 보기
              </span>
            )}
          </span>
          <div className={`rounded-[14px] rounded-bl-[4px] border bg-[var(--amora-sage-pale,#DBE3D6)] px-[14px] py-[11px] ${
            aiIsPrivate ? "border-[#5a6147]/25 ring-1 ring-[#5a6147]/10" : "border-transparent"
          }`}>
            <div className="break-words text-[13px] leading-[1.6] text-[#233426] sm:text-[14px]">
              {renderAiMarkdown(cleanText)}
            </div>
            {/* 2026-08-19 — 태그가 가리키는 챕터로 직접 보낸다. 같은 날 레거시 25편을
                `/manners` 스키마로 이관해서, 이제 태그는 `?part=N` 한 URL이 아니라
                주제마다 고유한 `/manners/<slug>`로 떨어진다(`legacyNumber`로 대응).
                존재하지 않는 번호는 카드를 그리지 않는다 — 죽은 링크보다 낫다. */}
            {partNumbers.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {partNumbers.map((num) => {
                  const part = MANNERS_PARTS.find((candidate) => candidate.legacyNumber === num);
                  if (!part) return null;
                  return (
                    <Link
                      key={num}
                      {...weddingLinkProps(`/manners/${part.slug}`)}
                      className="flex items-center gap-3 rounded-[6px] border border-[#E8D5CD]/40 bg-gradient-to-r from-[#FAF7F2] to-[#F5F0E8] px-3 py-3 transition-colors hover:border-[#C4967E]/30 group"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--hb-primary)]">
                        <BookOpen className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium text-[var(--hb-text-strong)]">{part.title}</p>
                        <p className="truncate text-sm text-[var(--hb-text-muted)]">{part.subtitle}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 flex-shrink-0 text-[var(--hb-text-muted)] transition-colors group-hover:text-[#C4967E]" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          {mediationBlock && (
            <MediationCard
              key={`${message.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}
              block={mediationBlock}
              messageId={message.id}
            />
          )}
          <span className="text-[11px] text-[var(--hb-text-muted)] ml-1">
            {formatTime(created_at)}
          </span>
          {/* AI 고지 footer 는 채팅 상단 헤더 배지로 통합됨 — 메시지별 반복 제거.
              AI 기본법(2026.1.22) 표시 의무는 ChatContent 헤더 "AI 생성" 배지 +
              /ai-policy 링크로 충족. 가독성 회복 (이전 사고: 매 메시지 footer 가
              과잉). */}
          {/* 저장·피드백 — 저장은 모든 아모라 메시지에, 피드백은 최근 3개에만.
              나중에 다시 볼 말은 최근 것만이 아니다. */}
          {aiIsPrivate && <PersonalActionSaveButton messageId={message.id} coupleId={message.couple_id} content={message.content} personalActionDraft={message.metadata?.personal_action_draft} personalActionsView={message.metadata?.personal_actions_view} />}
          {!aiIsPrivate && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SaveNoteButton messageId={message.id} content={message.content} coupleId={message.couple_id} />
              {isRecentAi && (
                <AiFeedbackRow
                  messageId={message.id}
                  onNegativeFeedback={() => onNegativeFeedback?.(message)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 사용자 메시지 (내 메시지 = 오른쪽, 상대방 = 왼쪽)
  // 라벨은 성별 슬롯(bride/groom)이 아니라 사람 이름으로 만든다. 사용자는 역할을
  // 고른 적이 없을 수 있고, 골랐더라도 자기 대화에 성별이 붙기를 요청한 적은 없다.
  // sender_id가 null인 과거 메시지에 현재 파트너 이름을 붙이면 오귀속이므로,
  // 이름은 호출부에서 sender_id를 대조해 넘겨준 경우에만 쓴다.
  const senderLabel = senderName ?? (message.sender_id ? "상대방" : "이전 참여자");

  // 색은 성별이 아니라 "나 vs 상대" 축으로 가른다. 이전 신부 색(#C4967E)은 흰 글자
  // 대비 2.62:1로 WCAG AA 미달이었다 — 중립화가 접근성 수정을 겸한다.
  const myBubbleBg = "bg-[var(--amora-ink,#26251F)]";
  const partnerBubbleBg = "bg-[var(--amora-warm,#F4EDE0)]";
  const partnerBubbleBorder = "border-[#E8DDD3]";

  // 상대 아바타는 아모라의 세이지 색과 구분한다.
  const avatarBg = "bg-[var(--amora-rose-deep,#7D5753)]";
  const badgeBg = "bg-[#795252]/12 text-[var(--hb-accent-hover)]";

  // 사용자 메시지에서 선택 태그 숨김
  const displayContent = stripSelectionTags(content);

  // 이미지 URL 목록
  // 상대방에게 보낸 직접 메시지 여부
  const isPartnerMsg = message.metadata?.target === "partner";
  // 비공개 메시지 (RLS로 본인+아모라만 SELECT됨 — 여기 도달했으면 본인이 볼 권한 있음)
  const isPrivateMsg =
    message.visibility === "bride_private" || message.visibility === "groom_private";

  if (isCurrentUser) {
    // 내 메시지: 오른쪽 정렬
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-1.5">
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
              <span className="text-xs text-[#5a6147] font-medium">나만 보기</span>
            </div>
          )}
          {/* 첨부 파일 (이미지 + PDF) */}
          <ChatImageAttachments messageId={message.id} metadata={message.metadata} />
          <div
            className={`${isPartnerMsg ? "bg-[var(--amora-rose-deep,#7D5753)]" : myBubbleBg} rounded-[14px] rounded-br-[4px] px-[14px] py-[11px]`}
          >
            <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-white sm:text-[14px]">
              {displayContent}
            </p>
          </div>
          <span className="text-[11px] text-[var(--hb-text-muted)] mr-1">
            {formatTime(created_at)}
          </span>
        </div>
      </div>
    );
  }

  // 상대방 메시지: 왼쪽 정렬
  return (
    <div className="flex max-w-[90%] items-start gap-2 sm:max-w-[80%]">
      {/* 아바타 — 모바일 작게 */}
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${avatarBg} sm:size-8`}
      >
        {isPartnerMsg ? (
          <Heart className="w-5 h-5 text-white" />
        ) : (
          senderName ? (
            <span className="text-white text-base font-bold">
              {senderName.slice(0, 2)}
            </span>
          ) : (
            <User className="w-5 h-5 text-white" />
          )
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm px-2 py-0.5 rounded-full font-medium ${isPartnerMsg ? "bg-pink-100 text-pink-500" : badgeBg}`}
          >
            {isPartnerMsg ? `${senderLabel} → 나에게` : senderLabel}
          </span>
        </div>
        <ChatImageAttachments messageId={message.id} metadata={message.metadata} />
        <div
          className={`${isPartnerMsg ? "bg-[var(--amora-rose-pale,#EDD9D0)] border-transparent" : `${partnerBubbleBg} ${partnerBubbleBorder}`} rounded-[14px] rounded-bl-[4px] border px-[14px] py-[11px]`}
        >
          <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--hb-text-strong)] sm:text-[14px]">
            {displayContent}
          </p>
        </div>
        <span className="text-[11px] text-[var(--hb-text-muted)] ml-1">
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
}: {
  message: ChatMessage;
  isRequester: boolean;
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
      <div className="w-full max-w-[28rem] rounded-[6px] border border-[#E8DDD3] bg-gradient-to-br from-[#FAF7F2] to-white shadow-sm px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(54,83,78,0.10)]">
            <RefreshCw className="w-3.5 h-3.5 text-[var(--hb-accent-hover)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--hb-text-strong)]">
              {isAccepted
                ? "함께 새로 시작했어요"
                : isDeclined
                  ? "함께 새로 시작 요청이 거절됐어요"
                  : "함께 대화 새로 시작 제안"}
            </p>
            {/* 2026-09-03: "데이터는 보존돼 있어요" 는 맞지만 무엇이 남는지를 말하지
                않아, 서버 기록과 아모라의 기억까지 지워진 것으로 읽혔다. 이 요청이
                실제로 바꾸는 것은 **양쪽 화면**뿐이다 — 원문·아모라 맥락은 그대로다.
                문구는 같은 흐름의 화면 정리 대화상자(ChatContent.tsx)가 이미 쓰는 것을
                그대로 쓴다. */}
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--hb-text-body)]">
              {isAccepted
                ? "양쪽 화면이 깨끗하게 정리됐어요. 해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요."
                : isDeclined
                  ? "기존 대화는 그대로 유지돼요."
                  : isRequester
                    ? "상대방 동의를 기다리는 중이에요. 동의하면 양쪽 화면이 정리돼요. 해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요."
                    : "상대방이 함께 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 정리돼요. 해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요."}
            </p>
            {!isDeclined && (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--hb-text-muted)]">
                실제로 지우려면 — 비공개 대화는 비공개 상담의 &lsquo;화면 정리 → 비공개 대화·아모라 기억 삭제&rsquo;에서, 아모라의 기억은 설정의 &lsquo;아모라가 기억하는 것&rsquo;에서 초기화할 수 있어요.
              </p>
            )}

            {/* pending + 상대방 → 액션 버튼 */}
            {isPending && !isRequester && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => handle("accept")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[6px] bg-[var(--hb-primary)] text-white text-xs font-medium bg-[var(--hb-text-body)] disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {pending === "accept" ? "처리 중..." : "동의"}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => handle("decline")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[6px] bg-white border border-[#E8DDD3] text-[var(--hb-text-body)] text-xs font-medium hover:bg-[#FAF7F2] disabled:opacity-50"
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
