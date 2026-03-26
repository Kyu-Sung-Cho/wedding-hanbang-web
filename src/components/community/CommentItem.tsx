"use client";

import { useState } from "react";
import Image from "next/image";
import { Reply, Trash2, X } from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import VoteButtons from "@/components/community/VoteButtons";
import type { CommentWithAuthor, BadgeType } from "@/types/community.types";

interface CommentItemProps {
  comment: CommentWithAuthor;
  postId: string;
  currentUserId: string | null;
  isReply?: boolean;
  onDelete: (commentId: string) => Promise<boolean>;
  onVote: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  onReply: (parentId: string, content: string) => Promise<void>;
}

function badgeLabel(badge: BadgeType): string | null {
  switch (badge) {
    case "verified_couple":
      return "인증 커플";
    case "top_contributor":
      return "우수 기여자";
    case "admin":
      return "관리자";
    default:
      return null;
  }
}

export default function CommentItem({
  comment,
  postId,
  currentUserId,
  isReply = false,
  onDelete,
  onVote,
  onReply,
}: CommentItemProps) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isAuthor = currentUserId === comment.author_id;
  const isLoggedIn = !!currentUserId;

  async function handleReplySubmit() {
    if (!replyContent.trim() || submittingReply) return;
    setSubmittingReply(true);
    await onReply(comment.id, replyContent.trim());
    setReplyContent("");
    setShowReplyInput(false);
    setSubmittingReply(false);
  }

  async function handleDelete() {
    await onDelete(comment.id);
    setShowDeleteConfirm(false);
  }

  // 삭제된 댓글
  if (comment.is_deleted) {
    return (
      <div
        className={`${
          isReply ? "ml-6 pl-4 border-l-2 border-[#E5E7EB]" : ""
        } py-3`}
      >
        <p className="text-sm text-[#6B7280] italic">삭제된 댓글입니다</p>

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
                onVote={onVote}
                onReply={onReply}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${
        isReply
          ? "ml-6 pl-4 border-l-2 border-[#E5E7EB] hover:border-[#2563EB]/30"
          : ""
      } transition-all duration-200`}
    >
      <div className="py-3">
        <div className="flex gap-2">
          {/* 아바타 */}
          <div
            className={`rounded-full bg-[#F4F6F8] ring-1 ring-[#E5E7EB] overflow-hidden flex items-center justify-center text-[#6B7280] shrink-0 ${
              isReply ? "w-7 h-7" : "w-8 h-8"
            }`}
          >
            {comment.author.avatar_url ? (
              <Image
                src={comment.author.avatar_url}
                alt=""
                width={isReply ? 28 : 32}
                height={isReply ? 28 : 32}
                className="w-full h-full object-cover"
              />
            ) : (
              <span
                className="text-xs font-bold"
              >
                {comment.author.nickname.charAt(0)}
              </span>
            )}
          </div>

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 */}
            <div className="flex items-center gap-1 text-sm">
              <span className="font-bold text-[#1c1c1e]">
                {comment.author.nickname}
              </span>
              {badgeLabel(comment.author.badge) && (
                <>
                  <span className="text-[#6B7280]">&middot;</span>
                  <span className="text-[#FF4500] font-medium">
                    {badgeLabel(comment.author.badge)}
                  </span>
                </>
              )}
              <span className="text-[#6B7280]">&middot;</span>
              <time className="text-[#6B7280]" title={comment.created_at}>
                {timeAgo(comment.created_at)}
              </time>
            </div>

            {/* 댓글 본문 */}
            <p className="mt-1 text-sm text-[#1c1c1e] leading-relaxed whitespace-pre-wrap break-words">
              {comment.content}
            </p>

            {/* 액션 행: 투표, 답글, 삭제 */}
            <div className="mt-2 flex items-center gap-2 text-sm font-medium text-[#6B7280]">
              <VoteButtons
                count={comment.upvote_count}
                userVote={comment.user_vote ?? null}
                onVote={(v) =>
                  onVote(comment.id, comment.user_vote === v ? 0 : v)
                }
                compact
                isLoggedIn={isLoggedIn}
              />

              {/* 답글 버튼 (최상위 댓글에만) */}
              {!isReply && isLoggedIn && (
                <button
                  type="button"
                  onClick={() => {
                    setShowReplyInput(!showReplyInput);
                    if (showReplyInput) setReplyContent("");
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200 ${
                    showReplyInput ? "text-[#2563EB]" : ""
                  }`}
                >
                  {showReplyInput ? (
                    <>
                      <X className="w-4 h-4" />
                      답글 취소
                    </>
                  ) : (
                    <>
                      <Reply className="w-4 h-4" />
                      답글
                    </>
                  )}
                </button>
              )}

              {/* 삭제 버튼 (작성자만) */}
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200"
                >
                  <Trash2 className="w-4 h-4" />
                  삭제
                </button>
              )}
            </div>

            {/* 답글 입력 */}
            {showReplyInput && (
              <div className="mt-3">
                <textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="답글을 작성해 주세요..."
                  rows={2}
                  maxLength={2000}
                  className="w-full px-3 py-2 text-sm text-[#1c1c1e] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg resize-none focus:outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)] transition-all duration-200 placeholder:text-[#6B7280]"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-[#6B7280]">
                    {replyContent.length}/2000
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplyInput(false);
                        setReplyContent("");
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-[#6B7280] hover:text-[#1c1c1e] rounded-lg hover:bg-[#F4F6F8] transition-all duration-200"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReplySubmit}
                      disabled={!replyContent.trim() || submittingReply}
                      className="px-3 py-1.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
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
            className="bg-white rounded-xl shadow-xl w-full max-w-xs overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 text-center">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <p className="text-base font-bold text-[#1c1c1e]">
                댓글을 삭제하시겠습니까?
              </p>
              <p className="mt-1 text-sm text-[#6B7280]">
                삭제된 댓글은 복구할 수 없습니다.
              </p>
            </div>
            <div className="flex border-t border-[#E5E7EB]">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-3 text-sm font-medium text-[#6B7280] hover:bg-[#F4F6F8] transition-all duration-200"
              >
                취소
              </button>
              <div className="w-px bg-[#E5E7EB]" />
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
              onVote={onVote}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}
