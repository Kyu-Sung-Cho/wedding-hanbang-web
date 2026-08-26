"use client";

import { useState } from "react";
import type { CommentMutationResult } from "@/stores/communityStore";
import Link from "next/link";
import {
  Check,
  Flag,
  Heart,
  Pencil,
  Reply,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import type {
  CommentWithAuthor,
  ReportReason,
} from "@/types/community.types";
import Avatar from "./Avatar";
import ContentOriginBadge from "./ContentOriginBadge";
import BlockUserButton from "./BlockUserButton";
import { weddingPath } from "@/lib/weddingPaths";
import { normalizeCommunityContentOrigin } from "@/lib/community/contentOrigin";

const COMMENT_REPORT_REASONS: ReadonlyArray<{
  value: ReportReason;
  label: string;
}> = [
  { value: "spam", label: "스팸·도배로 보여요" },
  { value: "abuse", label: "모욕·괴롭힘이 우려돼요" },
  { value: "ad", label: "표시되지 않은 광고가 의심돼요" },
  { value: "privacy", label: "개인정보가 노출된 것 같아요" },
  { value: "inappropriate", label: "커뮤니티에 부적절해 보여요" },
  { value: "other", label: "다른 이유가 있어요" },
];

interface CommentItemProps {
  comment: CommentWithAuthor;
  postId: string;
  currentUserId: string | null;
  isReply?: boolean;
  onDelete: (commentId: string) => Promise<CommentMutationResult>;
  onEdit: (commentId: string, content: string) => Promise<CommentMutationResult>;
  onVote: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  onReply: (parentId: string, content: string) => Promise<boolean>;
  onBlockedUser?: (userId: string) => void;
}

export default function CommentItem({
  comment,
  postId,
  currentUserId,
  isReply = false,
  onDelete,
  onEdit,
  onVote,
  onReply,
  onBlockedUser,
}: CommentItemProps) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  /** 수정·삭제가 거절됐을 때 서버가 준 이유. 답글 경로의 `replyError` 와 같은 역할이다. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | "">("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const isAuthor = currentUserId === comment.author_id;
  const isLoggedIn = !!currentUserId;

  // 아바타 계산
  const nickname = comment.author?.nickname ?? "익명";
  const contentOrigin = normalizeCommunityContentOrigin(comment.content_origin);
  // AI 여부는 서버가 기록한 content_origin만 사용한다. 닉네임과 계정 ID로 추론하지 않는다.
  const isAmoraAI = contentOrigin === "ai";
  const avatarUrl = comment.author?.avatar_url;
  const commentsReturnPath =
    `${weddingPath(`/community/post/${postId}`)}#comments`;
  const loginHref = `/login?redirect=${encodeURIComponent(commentsReturnPath)}`;
  const reportReturnPath =
    `${weddingPath(`/community/post/${postId}`)}#comment-${comment.id}`;
  const reportLoginHref =
    `/login?redirect=${encodeURIComponent(reportReturnPath)}`;

  function startEdit() {
    setEditContent(comment.content);
    setShowReplyInput(false);
    setIsEditing(true);
  }

  async function handleEditSubmit() {
    const trimmed = editContent.trim();
    if (!trimmed || submittingEdit) return;

    setSubmittingEdit(true);
    setActionError(null);
    const result = await onEdit(comment.id, trimmed);
    setSubmittingEdit(false);
    if (result.ok) {
      setIsEditing(false);
      return;
    }
    // 거절도 이유가 있다. 개인정보가 섞였다는 422 가 대표적인데, 예전에는 버튼
    // 라벨만 되돌아오고 왜 안 됐는지 말하지 않아 같은 버튼을 반복해 누르게 됐다.
    setActionError(result.message);
  }

  async function handleReplySubmit() {
    if (!replyContent.trim() || submittingReply) return;
    setSubmittingReply(true);
    setReplyError(null);

    try {
      const ok = await onReply(comment.id, replyContent.trim());
      if (ok) {
        setReplyContent("");
        setShowReplyInput(false);
      } else {
        setReplyError(
          "답글을 등록하지 못했어요. 내용을 그대로 두었으니 다시 시도해 주세요.",
        );
      }
    } catch {
      setReplyError(
        "답글을 등록하지 못했어요. 내용을 그대로 두었으니 다시 시도해 주세요.",
      );
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleDelete() {
    setActionError(null);
    const result = await onDelete(comment.id);
    if (result.ok) {
      setShowDeleteConfirm(false);
      return;
    }
    // 확인창을 닫지 않는다. 닫으면 댓글이 그대로 남은 화면만 보여 "눌렀는데
    // 아무 일도 없었다" 가 된다.
    setActionError(result.message);
  }

  function openReportModal() {
    setReportReason("");
    setReportDescription("");
    setReportError(null);
    setReportSubmitted(false);
    setShowReportModal(true);
  }

  async function handleReportSubmit() {
    if (!reportReason || reportSubmitting || isAuthor) return;

    setReportSubmitting(true);
    setReportError(null);
    try {
      const response = await fetch(
        `/api/community/comments/${comment.id}/report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reportReason,
            details: reportDescription.trim() || undefined,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        if (
          response.status === 409 ||
          body.code === "COMMUNITY_REPORT_ALREADY_EXISTS"
        ) {
          setReportError(
            "이미 접수한 답변이에요. 운영팀의 검토 결과를 기다려 주세요.",
          );
          return;
        }
        setReportError(
          body.error ??
            "신고를 접수하지 못했어요. 내용을 그대로 두었으니 잠시 후 다시 시도해 주세요.",
        );
        return;
      }

      setReportSubmitted(true);
    } catch {
      setReportError(
        "신고를 접수하지 못했어요. 내용을 그대로 두었으니 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      setReportSubmitting(false);
    }
  }

  // 삭제된 댓글
  if (comment.is_deleted) {
    return (
      <div
        id={`comment-${comment.id}`}
        className={`${
          isReply ? "ml-6 pl-4 border-l border-[#F0EFED]" : ""
        } py-3`}
      >
        <p className="text-sm text-[#B5ADA3] italic">
          삭제된 {isReply ? "답글" : "답변"}입니다
        </p>

        {/* 삭제된 댓글이라도 답글은 표시 */}
        {!isReply && comment.replies && comment.replies.length > 0 && (
          <div className="mt-1">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                postId={postId}
                currentUserId={currentUserId}
                isReply
                onDelete={onDelete}
                onEdit={onEdit}
                onVote={onVote}
                onReply={onReply}
                onBlockedUser={onBlockedUser}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // [amora_cta] 마커 파싱 헬퍼
  function renderAmoraContent(content: string) {
    const ctaMarker = "[amora_cta]";
    const ctaIndex = content.indexOf(ctaMarker);
    if (ctaIndex === -1) {
      return (
        <p className="ugc-text mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </p>
      );
    }
    const textBefore = content.slice(0, ctaIndex).trimEnd();
    // CTA 앞의 텍스트에서 마지막 문장을 링크 텍스트로 분리
    const lastArrow = textBefore.lastIndexOf("→");
    const lastNewline = textBefore.lastIndexOf("\n");
    const splitPoint = Math.max(lastArrow, lastNewline);

    let bodyText: string;
    let ctaText: string;
    if (splitPoint > 0 && splitPoint > textBefore.length - 80) {
      // "→" 가 포함된 마지막 문장을 CTA 텍스트로
      const lineStart = textBefore.lastIndexOf("\n", splitPoint - 1);
      bodyText = textBefore.slice(0, lineStart > 0 ? lineStart : splitPoint).trimEnd();
      ctaText = textBefore.slice(lineStart > 0 ? lineStart + 1 : splitPoint).trim();
      // "→" 제거
      ctaText = ctaText.replace(/→/g, "").trim();
    } else {
      bodyText = textBefore;
      ctaText = "아모라와 대화해보세요";
    }

    return (
      <>
        <p className="ugc-text mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
          {bodyText}
        </p>
        <Link
          href={weddingPath("/chat")}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[#36534E] bg-[#36534E]/5 hover:bg-[#36534E]/10 rounded-lg transition-colors duration-200"
        >
          {ctaText}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className={`${
        isReply
          ? "ml-6 pl-4 border-l border-[#F0EFED] hover:border-[#36534E]/30"
          : ""
      } ${
        isAmoraAI ? "bg-[#FAF8F5] rounded-xl -mx-1 px-1" : ""
      } transition-all duration-200`}
    >
      <div className="py-3">
        <div className="flex gap-2">
          {/* 아바타: 아모라는 특별 스타일 */}
          {isAmoraAI ? (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#36534E] to-[#2B423E] flex items-center justify-center shrink-0 ring-2 ring-[#36534E]/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
          ) : (
            <Avatar
              nickname={nickname}
              avatarUrl={avatarUrl}
              role={comment.author?.role ?? null}
              size={isReply ? 28 : 32}
              className="shrink-0"
            />
          )}

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 */}
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <span className={`font-medium ${isAmoraAI ? "text-[#36534E]" : "text-[#1A1A1F]"}`}>
                {nickname}
              </span>

              <ContentOriginBadge origin={contentOrigin} />

              <span className="text-[#B5ADA3]">&middot;</span>
              <time className="text-[#B5ADA3]" title={comment.created_at}>
                {timeAgo(comment.created_at)}
              </time>
            </div>

            {/* 댓글 본문: 아모라 AI는 CTA 파싱 포함 */}
            {isEditing ? (
              <div className="mt-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="ugc-text w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#36534E] focus:shadow-[0_0_0_2px_rgba(54,83,78,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-[#B5ADA3]">
                    {editContent.length}/2000
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditContent(comment.content);
                        setIsEditing(false);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[#878680] hover:text-[#1A1A1F] rounded-lg hover:bg-[#FAFAF8] transition-all duration-200"
                    >
                      <X className="w-3.5 h-3.5" />
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleEditSubmit}
                      disabled={!editContent.trim() || submittingEdit}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-[#36534E] hover:bg-[#2B423E] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {submittingEdit ? "저장 중..." : "저장"}
                    </button>
                  </div>
                  {actionError ? (
                    <p role="alert" className="mt-2 text-sm text-[#D95F5F]">
                      {actionError}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : isAmoraAI ? (
              renderAmoraContent(comment.content)
            ) : (
              <p className="ugc-text mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
                {comment.content}
              </p>
            )}

            {/* 액션 행: 도움됐어요, 답글, 삭제 */}
            {!isEditing && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[13px] font-medium text-[#B5ADA3]">
              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={() => onVote(comment.id, comment.user_vote === 1 ? 0 : 1)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors duration-200 ${
                    comment.user_vote === 1
                      ? "bg-[#f6efe5] text-[#36534E]"
                      : "hover:bg-[#FAFAF8] hover:text-[#36534E]"
                  }`}
                  aria-label={comment.user_vote === 1 ? "도움됐어요 취소" : "도움됐어요"}
                >
                  <Heart className={`w-3.5 h-3.5 ${comment.user_vote === 1 ? "fill-current" : ""}`} />
                  <span>도움됐어요</span>
                  {comment.upvote_count > 0 ? (
                    <span>{comment.upvote_count}</span>
                  ) : null}
                </button>
              ) : (
                <Link
                  href={loginHref}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-[#FAFAF8] hover:text-[#36534E]"
                  aria-label="로그인하고 도움됐어요 남기기"
                >
                  <Heart className="w-3.5 h-3.5" />
                  <span>도움됐어요</span>
                  {comment.upvote_count > 0 ? (
                    <span>{comment.upvote_count}</span>
                  ) : null}
                </Link>
              )}

              {/* 답글 버튼 (최상위 댓글에만) */}
              {!isReply && (
                isLoggedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowReplyInput(!showReplyInput);
                      if (showReplyInput) {
                        setReplyContent("");
                        setReplyError(null);
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 ${
                      showReplyInput ? "text-[#36534E]" : ""
                    }`}
                  >
                    {showReplyInput ? (
                      <>
                        <X className="w-3.5 h-3.5" />
                        취소
                      </>
                    ) : (
                      <>
                        <Reply className="w-3.5 h-3.5" />
                        답글
                      </>
                    )}
                  </button>
                ) : (
                  <Link
                    href={loginHref}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] hover:text-[#36534E] transition-all duration-200"
                  >
                    <Reply className="w-3.5 h-3.5" />
                    답글
                  </Link>
                )
              )}

              {/* 자신의 답변은 수정·삭제, 다른 사람의 답변은 신고 */}
              {isAuthor && (
                <>
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] hover:text-[#36534E] transition-all duration-200"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] hover:text-[#D85A5A] transition-all duration-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  삭제
                </button>
                </>
              )}
              {!isAuthor && (
                isLoggedIn ? (
                  <>
                    <button
                      type="button"
                      onClick={openReportModal}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 transition-all duration-200 hover:bg-[#FAFAF8] hover:text-[#8F6662]"
                      aria-label={`${isReply ? "답글" : "답변"} 신고`}
                    >
                      <Flag className="h-3.5 w-3.5" />
                      신고
                    </button>
                    <BlockUserButton
                      userId={comment.author_id}
                      nickname={nickname}
                      onBlocked={onBlockedUser}
                    />
                  </>
                ) : (
                  <Link
                    href={reportLoginHref}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 transition-all duration-200 hover:bg-[#FAFAF8] hover:text-[#8F6662]"
                    aria-label={`로그인하고 ${isReply ? "답글" : "답변"} 신고`}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    신고
                  </Link>
                )
              )}
              </div>
            )}

            {/* 답글 입력 */}
            {showReplyInput && (
              <div className="mt-3">
                <textarea
                  value={replyContent}
                  onChange={(e) => {
                    setReplyContent(e.target.value);
                    if (replyError) setReplyError(null);
                  }}
                  placeholder="답글을 작성해 주세요..."
                  rows={2}
                  maxLength={2000}
                  className="ugc-text w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#36534E] focus:shadow-[0_0_0_2px_rgba(54,83,78,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                />
                {replyError ? (
                  <p role="alert" className="mt-2 text-sm text-[#D95F5F]">
                    {replyError}
                  </p>
                ) : null}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-[#B5ADA3]">
                    {replyContent.length}/2000
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplyInput(false);
                        setReplyContent("");
                        setReplyError(null);
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-[#878680] hover:text-[#1A1A1F] rounded-lg hover:bg-[#FAFAF8] transition-all duration-200"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReplySubmit}
                      disabled={!replyContent.trim() || submittingReply}
                      className="px-3 py-1.5 text-sm font-semibold text-white bg-[#36534E] hover:bg-[#2B423E] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {submittingReply ? "등록 중..." : "등록"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 text-center">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-base font-medium text-[#1A1A1F]">
                {isReply ? "답글" : "답변"}을 삭제하시겠습니까?
              </p>
              <p className="mt-1 text-sm text-[#878680]">
                삭제된 {isReply ? "답글" : "답변"}은 복구할 수 없습니다.
              </p>
              {actionError ? (
                <p role="alert" className="mt-3 text-sm text-[#D95F5F]">
                  {actionError}
                </p>
              ) : null}
            </div>
            <div className="flex border-t border-[#F0EFED]">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 px-4 py-3 text-sm font-medium text-[#878680] hover:bg-[#FAFAF8] transition-all duration-200"
              >
                취소
              </button>
              <div className="w-px bg-[#F0EFED]" />
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 transition-all duration-200"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {showReportModal && !isAuthor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowReportModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`comment-report-title-${comment.id}`}
            className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            {reportSubmitted ? (
              <div className="p-6 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4f1] text-[#36534E]">
                  <Check className="h-5 w-5" />
                </div>
                <h2
                  id={`comment-report-title-${comment.id}`}
                  className="mt-3 text-base font-semibold text-[#1A1A1F]"
                >
                  신고를 접수했어요
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#635b51]">
                  운영팀이 맥락을 함께 확인할게요. 신고만으로 내용이 잘못됐다고
                  확정하거나 바로 숨기지는 않아요.
                </p>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#36534E] px-4 text-sm font-semibold text-white"
                >
                  확인
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-[#F0EFED] p-5">
                  <div>
                    <h2
                      id={`comment-report-title-${comment.id}`}
                      className="text-base font-semibold text-[#1A1A1F]"
                    >
                      {isReply ? "답글" : "답변"} 신고
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-[#878680]">
                      가장 가까운 이유를 골라 주세요. 신고 내용은 작성자에게
                      공개되지 않아요.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="rounded-lg p-1.5 text-[#878680] hover:bg-[#FAFAF8]"
                    aria-label="신고 창 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-5">
                  <fieldset>
                    <legend className="text-sm font-semibold text-[#1A1A1F]">
                      신고 이유
                    </legend>
                    <div className="mt-3 grid gap-2">
                      {COMMENT_REPORT_REASONS.map((reason) => (
                        <label
                          key={reason.value}
                          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                            reportReason === reason.value
                              ? "border-[#36534E] bg-[#eef4f1] text-[#263832]"
                              : "border-[#F0EFED] text-[#635b51] hover:border-[#d8d1cc]"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`comment-report-reason-${comment.id}`}
                            value={reason.value}
                            checked={reportReason === reason.value}
                            onChange={() => {
                              setReportReason(reason.value);
                              setReportError(null);
                            }}
                            className="h-4 w-4 accent-[#36534E]"
                          />
                          {reason.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="mt-4 block">
                    <span className="text-sm font-semibold text-[#1A1A1F]">
                      운영팀이 알아야 할 내용{" "}
                      <span className="font-normal text-[#B5ADA3]">(선택)</span>
                    </span>
                    <textarea
                      value={reportDescription}
                      onChange={(event) => {
                        setReportDescription(event.target.value.slice(0, 1000));
                        setReportError(null);
                      }}
                      rows={3}
                      maxLength={1000}
                      placeholder="문제가 우려되는 부분을 짧게 알려 주세요."
                      className="mt-2 w-full resize-none rounded-xl border border-[#F0EFED] bg-[#FAFAF8] px-3 py-2 text-sm text-[#1A1A1F] outline-none transition-colors placeholder:text-[#B5ADA3] focus:border-[#36534E]"
                    />
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-[#878680]">
                    전화번호·주소·계좌번호처럼 노출된 개인정보를 설명란에 다시
                    적지 마세요.
                  </p>

                  {reportError && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg bg-[#fbf2f0] px-3 py-2 text-sm leading-relaxed text-[#8F6662]"
                    >
                      {reportError}
                    </p>
                  )}

                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowReportModal(false)}
                      className="min-h-11 flex-1 rounded-lg border border-[#d8d1cc] px-4 text-sm font-semibold text-[#635b51]"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReportSubmit}
                      disabled={!reportReason || reportSubmitting}
                      className="min-h-11 flex-1 rounded-lg bg-[#36534E] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {reportSubmitting ? "접수 중..." : "신고 접수"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 답글 목록 */}
      {!isReply && comment.replies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              postId={postId}
              currentUserId={currentUserId}
              isReply
              onDelete={onDelete}
              onEdit={onEdit}
              onVote={onVote}
              onReply={onReply}
              onBlockedUser={onBlockedUser}
            />
          ))}
        </div>
      )}
    </div>
  );
}
