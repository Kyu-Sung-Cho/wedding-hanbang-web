"use client";

import { useState } from "react";
import Image from "next/image";
import { Reply, Trash2 } from "lucide-react";
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await onDelete(comment.id);
    setConfirmDelete(false);
  }

  // 삭제된 댓글
  if (comment.is_deleted) {
    return (
      <div className={`${isReply ? "ml-10" : ""} py-3`}>
        <p className="text-sm text-[#B5ADA3] italic">삭제된 댓글입니다</p>

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
    <div className={`${isReply ? "ml-10" : ""}`}>
      <div className="py-3 border-b border-[#F5F2ED] last:border-b-0">
        <div className="flex gap-3">
          {/* 아바타 */}
          <div className="w-8 h-8 rounded-full bg-[#F5F2ED] overflow-hidden flex items-center justify-center text-[#928980] shrink-0">
            {comment.author.avatar_url ? (
              <Image
                src={comment.author.avatar_url}
                alt=""
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs font-medium">
                {comment.author.nickname.charAt(0)}
              </span>
            )}
          </div>

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#1A1A1F]">
                {comment.author.nickname}
              </span>
              {badgeLabel(comment.author.badge) && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#C4967E]/10 text-[#C4967E] rounded">
                  {badgeLabel(comment.author.badge)}
                </span>
              )}
              <span className="text-xs text-[#B5ADA3]">
                {timeAgo(comment.created_at)}
              </span>
            </div>

            {/* 댓글 본문 */}
            <p className="mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
              {comment.content}
            </p>

            {/* 액션 행: 투표, 답글, 삭제 */}
            <div className="mt-2 flex items-center gap-3">
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
                  onClick={() => setShowReplyInput(!showReplyInput)}
                  className="flex items-center gap-1 text-xs text-[#928980] hover:text-[#C4967E] transition-colors"
                >
                  <Reply className="w-3.5 h-3.5" />
                  답글
                </button>
              )}

              {/* 삭제 버튼 (작성자만) */}
              {isAuthor && (
                <button
                  type="button"
                  onClick={handleDelete}
                  onBlur={() => setConfirmDelete(false)}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    confirmDelete
                      ? "text-red-500 font-medium"
                      : "text-[#B5ADA3] hover:text-red-500"
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmDelete ? "삭제 확인" : "삭제"}
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
                  className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl resize-none focus:outline-none focus:border-[#C4967E] transition-colors placeholder:text-[#B5ADA3]"
                />
                <div className="flex items-center justify-end gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReplyInput(false);
                      setReplyContent("");
                    }}
                    className="px-3 py-1.5 text-xs text-[#928980] hover:text-[#1A1A1F] transition-colors"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleReplySubmit}
                    disabled={!replyContent.trim() || submittingReply}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {submittingReply ? "등록 중..." : "등록"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
