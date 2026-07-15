"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Flag, Heart, Loader2, Pencil, Trash2, X } from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import type { CommentWithAuthor } from "@/types/community.types";
import Avatar from "./Avatar";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";
import { pathWithAuthReturn } from "@/lib/authReturnPath";
import { communityPostPath } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";

const REPORT_REASONS = [
  { value: "spam", label: "스팸·도배" },
  { value: "abuse", label: "욕설·비하" },
  { value: "ad", label: "광고·홍보" },
  { value: "inappropriate", label: "부적절한 내용" },
  { value: "other", label: "기타" },
] as const;

interface CommentItemProps {
  comment: CommentWithAuthor;
  currentUserId: string | null;
  isReply?: boolean;
  onDelete: (commentId: string) => Promise<boolean>;
  onEdit: (commentId: string, content: string) => Promise<boolean>;
}

export default function CommentItem({
  comment,
  currentUserId,
  isReply = false,
  onDelete,
  onEdit,
}: CommentItemProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportLoginRequired, setReportLoginRequired] = useState(false);

  const { dialogRef: deleteDialogRef } = useAccessibleDialog({
    isOpen: showDeleteConfirm,
    onClose: closeDeleteDialog,
  });
  const { dialogRef: reportDialogRef } = useAccessibleDialog({
    isOpen: showReportDialog,
    onClose: closeReportDialog,
  });

  const isAuthor = comment.viewer_is_author;

  const nickname = comment.author.nickname;
  const avatarUrl = comment.author.avatar_url;
  const loginHref = pathWithAuthReturn(
    weddingPath("/login"),
    communityPostPath(comment.post_id, `comment-${comment.id}`),
  );

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteError("");
    setShowDeleteConfirm(false);
  }

  function closeReportDialog() {
    if (reportSubmitting) return;
    setShowReportDialog(false);
    setReportReason("");
    setReportDetails("");
    setReportError("");
    setReportSubmitted(false);
  }

  function startEdit() {
    setEditContent(comment.content);
    setEditError("");
    setIsEditing(true);
  }

  async function handleEditSubmit() {
    const trimmed = editContent.trim();
    if (!trimmed || submittingEdit) return;

    setEditError("");
    setSubmittingEdit(true);
    try {
      const ok = await onEdit(comment.id, trimmed);
      if (!ok) {
        setEditError("댓글 수정을 저장하지 못했어요. 입력한 내용은 그대로 두었습니다.");
        return;
      }
      setIsEditing(false);
    } catch {
      setEditError("댓글 수정을 저장하지 못했어요. 입력한 내용은 그대로 두었습니다.");
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const ok = await onDelete(comment.id);
      if (ok) {
        setShowDeleteConfirm(false);
        return;
      }
      setDeleteError("댓글을 삭제하지 못했어요. 댓글은 그대로 남아 있습니다.");
    } catch {
      setDeleteError("댓글을 삭제하지 못했어요. 댓글은 그대로 남아 있습니다.");
    } finally {
      setDeleting(false);
    }
  }

  function handleReportClick() {
    setReportLoginRequired(false);
    if (!currentUserId) {
      setReportLoginRequired(true);
      return;
    }
    setReportReason("");
    setReportDetails("");
    setReportError("");
    setReportSubmitted(false);
    setShowReportDialog(true);
  }

  async function handleReportSubmit() {
    if (!reportReason || reportSubmitting) return;
    setReportError("");
    setReportSubmitting(true);
    try {
      const response = await fetch(`/api/community/comments/${comment.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || payload?.success !== true) {
        if (response.status === 401) setReportLoginRequired(true);
        setReportError(
          typeof payload?.error === "string"
            ? payload.error
            : "신고를 접수하지 못했어요. 선택한 내용은 그대로 두었습니다.",
        );
        return;
      }
      setReportSubmitted(true);
    } catch {
      setReportError("네트워크 오류로 신고를 접수하지 못했어요. 선택한 내용은 그대로 두었습니다.");
    } finally {
      setReportSubmitting(false);
    }
  }

  // 삭제된 댓글
  if (comment.is_deleted) {
    return (
      <div
        className={`${
          isReply ? "ml-6 pl-4 border-l border-[#F0EFED]" : ""
        } py-3`}
      >
        <p className="text-sm text-[#B5ADA3] italic">삭제된 댓글입니다</p>

        {/* 삭제된 댓글이라도 답글은 표시 */}
        {!isReply && comment.replies && comment.replies.length > 0 && (
          <div className="mt-1">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                currentUserId={currentUserId}
                isReply
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className={`${
        isReply
          ? "ml-6 pl-4 border-l border-[#F0EFED] hover:border-[#36534E]/30"
          : ""
      } transition-all duration-200`}
    >
      <div className="py-3">
        <div className="flex gap-2">
          <Avatar
            nickname={nickname}
            avatarUrl={avatarUrl}
            size={isReply ? 28 : 32}
            className="shrink-0"
          />

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 */}
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="font-medium text-[#1A1A1F]">
                {nickname}
              </span>

              <span className="text-[#B5ADA3]">&middot;</span>
              <time className="text-[#B5ADA3]" title={comment.created_at}>
                {timeAgo(comment.created_at)}
              </time>
            </div>

            {/* 기존 댓글 본문은 출처를 새로 해석하지 않고 중립적으로 표시 */}
            {isEditing ? (
              <div className="mt-2">
                <textarea
                  value={editContent}
                  onChange={(e) => {
                    setEditContent(e.target.value);
                    setEditError("");
                  }}
                  rows={3}
                  maxLength={2000}
                  className="ugc-text w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#36534E] focus:shadow-[0_0_0_2px_rgba(54,83,78,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                />
                {editError && (
                  <p role="alert" className="mt-1.5 text-xs text-red-500">
                    {editError}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-[#B5ADA3]">
                    {editContent.length}/2000
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditContent(comment.content);
                        setEditError("");
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
                </div>
              </div>
            ) : (
              <p className="ugc-text mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
                {comment.content}
              </p>
            )}

            {/* 기존 좋아요 수는 읽기 정보로만 표시 */}
            {!isEditing && (
              <div className="mt-1.5 flex items-center gap-3 text-[13px] font-medium text-[#B5ADA3]">
              <span className="inline-flex items-center gap-1 px-2 py-1 text-[#878680]">
                <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                좋아요 {comment.upvote_count}
              </span>

              {isAuthor ? (
                <>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 transition-all duration-200 hover:bg-[#FAFAF8] hover:text-[#36534E]"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError("");
                      setShowDeleteConfirm(true);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 transition-all duration-200 hover:bg-[#FAFAF8] hover:text-[#D85A5A]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    삭제
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleReportClick}
                  aria-haspopup="dialog"
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[#635B51] transition-all duration-200 hover:bg-[#FAFAF8] hover:text-[#A94444]"
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                  신고
                </button>
              )}
              </div>
            )}
            {reportLoginRequired && !currentUserId && (
              <p role="alert" className="mt-2 text-xs text-[#8F6662]">
                댓글 신고는 로그인 후 이용할 수 있어요.{" "}
                <Link href={loginHref} className="font-semibold underline underline-offset-2">
                  로그인
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 정확한 댓글을 대상으로 하는 신고 확인 모달 */}
      {showReportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeReportDialog}
        >
          <div
            ref={reportDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`comment-report-title-${comment.id}`}
            aria-describedby={`comment-report-description-${comment.id}`}
            tabIndex={-1}
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            {reportSubmitted ? (
              <div className="p-6 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#36534E]/10 text-[#36534E]">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3
                  id={`comment-report-title-${comment.id}`}
                  className="text-base font-semibold text-[#1A1A1F]"
                >
                  신고가 접수되었습니다
                </h3>
                <p
                  id={`comment-report-description-${comment.id}`}
                  className="mt-2 text-sm leading-relaxed text-[#635B51]"
                >
                  이 댓글을 운영 검토 대상으로 전달했어요.
                </p>
                <button
                  type="button"
                  onClick={closeReportDialog}
                  className="mt-5 min-h-11 w-full rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white hover:bg-[#243832]"
                >
                  확인
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-[#F0EFED] px-5 py-4">
                  <h3
                    id={`comment-report-title-${comment.id}`}
                    className="text-base font-semibold text-[#1A1A1F]"
                  >
                    댓글 신고
                  </h3>
                  <button
                    type="button"
                    onClick={closeReportDialog}
                    disabled={reportSubmitting}
                    aria-label="댓글 신고 창 닫기"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-[#635B51] hover:bg-[#FAFAF8] disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="px-5 py-4">
                  <p
                    id={`comment-report-description-${comment.id}`}
                    className="mb-4 text-sm leading-relaxed text-[#635B51]"
                  >
                    선택한 댓글 하나만 신고됩니다. 가장 가까운 사유를 선택해 주세요.
                  </p>
                  <fieldset className="space-y-2">
                    <legend className="sr-only">댓글 신고 사유</legend>
                    {REPORT_REASONS.map((reason) => (
                      <label
                        key={reason.value}
                        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                          reportReason === reason.value
                            ? "border-[#36534E] bg-[#36534E]/5"
                            : "border-[#E2D3C8] hover:bg-[#FBF8F2]"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`comment-report-reason-${comment.id}`}
                          value={reason.value}
                          checked={reportReason === reason.value}
                          onChange={(event) => {
                            setReportReason(event.target.value);
                            setReportError("");
                          }}
                          className="h-4 w-4 accent-[#36534E]"
                        />
                        <span className="text-sm text-[#1A1A1F]">{reason.label}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="mt-4 block text-sm font-medium text-[#36534E]">
                    추가 설명 <span className="font-normal text-[#878680]">(선택)</span>
                    <textarea
                      value={reportDetails}
                      onChange={(event) => {
                        setReportDetails(event.target.value);
                        setReportError("");
                      }}
                      rows={3}
                      maxLength={500}
                      className="mt-2 w-full resize-none rounded-xl border border-[#E2D3C8] bg-[#FBF8F2] px-3 py-2 text-sm text-[#1A1A1F] outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/10"
                    />
                  </label>
                  {reportError && (
                    <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      <p>{reportError}</p>
                      {reportLoginRequired && (
                        <Link href={loginHref} className="mt-1 inline-block font-semibold underline underline-offset-2">
                          다시 로그인
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 border-t border-[#F0EFED] bg-[#FAFAF8] px-5 py-4">
                  <button
                    type="button"
                    onClick={closeReportDialog}
                    disabled={reportSubmitting}
                    className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-[#635B51] hover:bg-[#F0EFED] disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReportSubmit()}
                    disabled={!reportReason || reportSubmitting}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#A94444] px-4 text-sm font-semibold text-white hover:bg-[#8E3838] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {reportSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {reportSubmitting ? "접수 중..." : "신고하기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeDeleteDialog}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`comment-delete-title-${comment.id}`}
            aria-describedby={`comment-delete-description-${comment.id}`}
            tabIndex={-1}
            className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 text-center">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p id={`comment-delete-title-${comment.id}`} className="text-base font-medium text-[#1A1A1F]">
                댓글을 삭제하시겠습니까?
              </p>
              <p id={`comment-delete-description-${comment.id}`} className="mt-1 text-sm text-[#878680]">
                삭제된 댓글은 복구할 수 없습니다.
              </p>
              {deleteError && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex border-t border-[#F0EFED]">
              <button
                type="button"
                onClick={closeDeleteDialog}
                disabled={deleting}
                className="flex-1 px-4 py-3 text-sm font-medium text-[#878680] hover:bg-[#FAFAF8] transition-all duration-200"
              >
                취소
              </button>
              <div className="w-px bg-[#F0EFED]" />
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 transition-all duration-200"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
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
              currentUserId={currentUserId}
              isReply
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
