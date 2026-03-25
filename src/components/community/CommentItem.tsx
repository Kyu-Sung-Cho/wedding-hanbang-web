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
      <div
        className={`${
          isReply ? "pl-4 border-l-2 border-[#E5E7EB] ml-3" : ""
        } py-2`}
      >
        <p className="text-xs text-[#6B7280] italic">삭제된 댓글입니다</p>

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
    <div className={`${isReply ? "pl-4 border-l-2 border-[#E5E7EB] ml-3" : ""}`}>
      <div className="py-2.5">
        <div className="flex gap-2.5">
          {/* 아바타 */}
          <div className="w-7 h-7 rounded-full bg-[#F4F6F8] ring-1 ring-[#E5E7EB] overflow-hidden flex items-center justify-center text-[#6B7280] shrink-0">
            {comment.author.avatar_url ? (
              <Image
                src={comment.author.avatar_url}
                alt=""
                width={28}
                height={28}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[10px] font-bold">
                {comment.author.nickname.charAt(0)}
              </span>
            )}
          </div>

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 - 한 줄 */}
            <div className="flex items-center gap-1 text-xs">
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
              <span className="text-[#6B7280]">
                {timeAgo(comment.created_at)}
              </span>
            </div>

            {/* 댓글 본문 */}
            <p className="mt-1 text-sm text-[#1c1c1e] leading-relaxed whitespace-pre-wrap break-words">
              {comment.content}
            </p>

            {/* 액션 행: 투표, 답글, 삭제 */}
            <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[#6B7280]">
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
                  className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#F4F6F8] transition-colors"
                >
                  <Reply className="w-3 h-3" />
                  답글
                </button>
              )}

              {/* 삭제 버튼 (작성자만) */}
              {isAuthor && (
                <button
                  type="button"
                  onClick={handleDelete}
                  onBlur={() => setConfirmDelete(false)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#F4F6F8] transition-colors ${
                    confirmDelete ? "text-red-500" : ""
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                  {confirmDelete ? "삭제 확인" : "삭제"}
                </button>
              )}
            </div>

            {/* 답글 입력 */}
            {showReplyInput && (
              <div className="mt-2.5">
                <textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="답글을 작성해 주세요..."
                  rows={2}
                  maxLength={2000}
                  className="w-full px-3 py-2.5 text-sm text-[#1c1c1e] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg resize-none focus:outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)] transition-all placeholder:text-[#6B7280]"
                />
                <div className="flex items-center justify-between mt-1.5">
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
                      className="px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1c1c1e] rounded-md hover:bg-[#F4F6F8] transition-all"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReplySubmit}
                      disabled={!replyContent.trim() || submittingReply}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
