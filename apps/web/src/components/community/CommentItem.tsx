"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronUp, ChevronDown, Reply, Trash2, X, Sparkles } from "lucide-react";
import { timeAgo } from "@/utils/timeAgo";
import type { CommentWithAuthor, CommunityRank } from "@/types/community.types";

// 아모라 서비스 계정 ID
const AMORA_USER_ID = process.env.NEXT_PUBLIC_AMORA_USER_ID ?? "00000000-0000-0000-0000-000000000000";

interface CommentItemProps {
  comment: CommentWithAuthor;
  postId: string;
  currentUserId: string | null;
  isReply?: boolean;
  onDelete: (commentId: string) => Promise<boolean>;
  onVote: (commentId: string, voteType: 1 | -1 | 0) => Promise<void>;
  onReply: (parentId: string, content: string) => Promise<void>;
}

// 아바타 그래디언트 팔레트 (PostCard 동일)
const AVATAR_GRADIENTS = [
  "from-[#C4967E] to-[#C9A96E]",
  "from-[#A8D8A8] to-[#6BBF6B]",
  "from-[#7EB8D8] to-[#5A9CC0]",
  "from-[#C9A96E] to-[#DCC9A0]",
  "from-[#D88B8B] to-[#C06B6B]",
  "from-[#B39DDB] to-[#7E57C2]",
];

// 계급 라벨 + 레벨 (PostCard 동일)
const RANK_CONFIG: Record<CommunityRank, { label: string; level: number; bg: string; text: string }> = {
  sprout:    { label: "새싹",   level: 1, bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]" },
  preparing: { label: "준비중", level: 2, bg: "bg-[#7EB8D8]/10", text: "text-[#5A9CC0]" },
  expert:    { label: "전문가", level: 3, bg: "bg-[#C4967E]/10", text: "text-[#C4967E]" },
  master:    { label: "마스터", level: 4, bg: "bg-[#C9A96E]/10", text: "text-[#C9A96E]" },
  senior:    { label: "선배",   level: 5, bg: "bg-[#B39DDB]/10", text: "text-[#7E57C2]" },
};

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

  // 아바타 & 랭크 계산
  const nickname = comment.author?.nickname ?? "익명";
  const isAmoraAI = comment.author_id === AMORA_USER_ID || nickname === "아모라 AI";
  const rank: CommunityRank = (comment.author?.rank as CommunityRank) || "sprout";
  const rankConfig = RANK_CONFIG[rank];
  const gradientIndex = nickname.charCodeAt(0) % AVATAR_GRADIENTS.length;
  const avatarGradient = AVATAR_GRADIENTS[gradientIndex];
  const avatarUrl = comment.author?.avatar_url;
  const isEmoji = avatarUrl ? /\p{Emoji}/u.test(avatarUrl) : false;

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

  // [amora_cta] 마커 파싱 헬퍼
  function renderAmoraContent(content: string) {
    const ctaMarker = "[amora_cta]";
    const ctaIndex = content.indexOf(ctaMarker);
    if (ctaIndex === -1) {
      return (
        <p className="mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
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
        <p className="mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
          {bodyText}
        </p>
        <Link
          href="/chat"
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[#C4967E] bg-[#C4967E]/5 hover:bg-[#C4967E]/10 rounded-lg transition-colors duration-200"
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
      className={`${
        isReply
          ? "ml-6 pl-4 border-l border-[#F0EFED] hover:border-[#C4967E]/30"
          : ""
      } ${
        isAmoraAI ? "bg-[#FAF8F5] rounded-xl -mx-1 px-1" : ""
      } transition-all duration-200`}
    >
      <div className="py-3">
        <div className="flex gap-2">
          {/* 아바타: 아모라는 특별 스타일 */}
          {isAmoraAI ? (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shrink-0 ring-2 ring-[#C4967E]/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
          ) : (
            <div
              className={`rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center shrink-0 ${
                isReply ? "w-7 h-7" : "w-8 h-8"
              }`}
            >
              {avatarUrl && !isEmoji ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={isReply ? 28 : 32}
                  height={isReply ? 28 : 32}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className={`${isEmoji ? "text-sm" : "text-xs font-semibold text-white"}`}>
                  {isEmoji ? avatarUrl : nickname.charAt(0)}
                </span>
              )}
            </div>
          )}

          {/* 내용 */}
          <div className="flex-1 min-w-0">
            {/* 작성자 정보 */}
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className={`font-medium ${isAmoraAI ? "text-[#C4967E]" : "text-[#1A1A1F]"}`}>
                {nickname}
              </span>

              {/* 아모라 AI 배지 */}
              {isAmoraAI ? (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none bg-[#C4967E]/10 text-[#C4967E]">
                  <Sparkles className="w-2.5 h-2.5" />
                  AI
                </span>
              ) : (
                /* 랭크 배지 (pill) */
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none ${rankConfig.bg} ${rankConfig.text}`}>
                  Lv.{rankConfig.level} {rankConfig.label}
                </span>
              )}

              <span className="text-[#B5ADA3]">&middot;</span>
              <time className="text-[#B5ADA3]" title={comment.created_at}>
                {timeAgo(comment.created_at)}
              </time>
            </div>

            {/* 댓글 본문: 아모라 AI는 CTA 파싱 포함 */}
            {isAmoraAI ? (
              renderAmoraContent(comment.content)
            ) : (
              <p className="mt-1 text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words">
                {comment.content}
              </p>
            )}

            {/* 액션 행: 투표, 답글, 삭제 */}
            <div className="mt-1.5 flex items-center gap-3 text-[13px] font-medium text-[#B5ADA3]">
              {/* 인라인 투표 (green/red) */}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onVote(comment.id, comment.user_vote === 1 ? 0 : 1)}
                  className={`p-0.5 rounded transition-colors duration-200 ${
                    comment.user_vote === 1
                      ? "text-[#2E7D5A] bg-[#2E7D5A]/10"
                      : "hover:text-[#2E7D5A]"
                  }`}
                  aria-label="추천"
                >
                  <ChevronUp className="w-4 h-4" strokeWidth={comment.user_vote === 1 ? 2.5 : 2} />
                </button>
                <span
                  className={`text-[13px] font-medium min-w-[1.25rem] text-center ${
                    comment.user_vote === 1
                      ? "text-[#2E7D5A]"
                      : comment.user_vote === -1
                      ? "text-[#D85A5A]"
                      : "text-[#1A1A1F]"
                  }`}
                >
                  {comment.upvote_count}
                </span>
                <button
                  type="button"
                  onClick={() => onVote(comment.id, comment.user_vote === -1 ? 0 : -1)}
                  className={`p-0.5 rounded transition-colors duration-200 ${
                    comment.user_vote === -1
                      ? "text-[#D85A5A] bg-[#D85A5A]/10"
                      : "hover:text-[#D85A5A]"
                  }`}
                  aria-label="비추천"
                >
                  <ChevronDown className="w-4 h-4" strokeWidth={comment.user_vote === -1 ? 2.5 : 2} />
                </button>
              </div>

              {/* 답글 버튼 (최상위 댓글에만) */}
              {!isReply && isLoggedIn && (
                <button
                  type="button"
                  onClick={() => {
                    setShowReplyInput(!showReplyInput);
                    if (showReplyInput) setReplyContent("");
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 ${
                    showReplyInput ? "text-[#C4967E]" : ""
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
              )}

              {/* 삭제 버튼 (작성자만) */}
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#FAFAF8] hover:text-[#D85A5A] transition-all duration-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
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
                  className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#C4967E] focus:shadow-[0_0_0_2px_rgba(196,150,126,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                />
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
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-[#878680] hover:text-[#1A1A1F] rounded-lg hover:bg-[#FAFAF8] transition-all duration-200"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReplySubmit}
                      disabled={!replyContent.trim() || submittingReply}
                      className="px-3 py-1.5 text-sm font-semibold text-white bg-[#795252] hover:bg-[#946a6a] rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
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
                댓글을 삭제하시겠습니까?
              </p>
              <p className="mt-1 text-sm text-[#878680]">
                삭제된 댓글은 복구할 수 없습니다.
              </p>
            </div>
            <div className="flex border-t border-[#F0EFED]">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
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
