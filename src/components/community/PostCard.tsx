"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Share2, Bookmark, Eye } from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import VoteButtons from "./VoteButtons";
import type { PostWithAuthor, BadgeType } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
  isLoggedIn?: boolean;
  onVote?: (postId: string, vote: 1 | -1) => void;
  onBookmark?: (postId: string) => void;
}

// 배지 라벨
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

// 가격 포맷 (만원 단위)
function formatCost(costInManwon: number): string {
  if (costInManwon >= 10000) {
    return `${(costInManwon / 10000).toFixed(1)}억`;
  }
  return `${costInManwon.toLocaleString()}만원`;
}

export default function PostCard({ post, isLoggedIn = false, onVote, onBookmark }: PostCardProps) {
  const categoryInfo = CATEGORY_MAP[post.category];
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);

  // 본문 미리보기: HTML 태그 제거 후 150자
  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

  const hasThumbnail = post.images && post.images.length > 0;
  const totalCost = post.cost_data?.totalCost;
  const voteCount = post.upvote_count - post.downvote_count;

  // 아바타 첫 글자
  const avatarLetter = post.author.nickname?.charAt(0) || "?";

  function handleBookmark() {
    setBookmarked((prev) => !prev);
    onBookmark?.(post.id);
  }

  return (
    <article className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] hover:shadow-md transition-all duration-200">
      <div className="flex">
        {/* 왼쪽 투표 스트립 */}
        <div className="flex-shrink-0 w-10 bg-[#FAFAFA] rounded-l-xl flex justify-center">
          <VoteButtons
            count={voteCount}
            userVote={post.user_vote ?? null}
            onVote={(vote) => onVote?.(post.id, vote)}
            isLoggedIn={isLoggedIn}
          />
        </div>

        {/* 오른쪽 콘텐츠 */}
        <div className="flex-1 min-w-0 p-4">
          {/* 메타 라인: 아바타 + 닉네임 + 배지 + 시간 + 카테고리 */}
          <div className="flex items-center gap-2 text-xs text-[#6B7280] mb-2">
            {/* 작성자 아바타 */}
            {post.author.avatar_url ? (
              <Image
                src={post.author.avatar_url}
                alt={post.author.nickname}
                width={24}
                height={24}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-[#E5E7EB] text-[11px] font-bold text-[#6B7280] flex items-center justify-center shrink-0">
                {avatarLetter}
              </span>
            )}
            <Link
              href={`/community?author_id=${post.author_id}`}
              className="font-medium text-[#1c1c1e] hover:text-[#2563EB] hover:underline transition-all duration-200"
            >
              {post.author.nickname}
            </Link>
            {badgeLabel(post.author.badge) && (
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-[#FF4500]/10 text-[#FF4500] rounded-full">
                {badgeLabel(post.author.badge)}
              </span>
            )}
            <span>&middot;</span>
            <span>{timeAgo(post.created_at)}</span>
            {categoryInfo && (
              <>
                <span>&middot;</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full bg-[#F4F6F8] text-[#6B7280]`}>
                  {categoryInfo.shortLabel}
                </span>
              </>
            )}
          </div>

          {/* 제목 행: BEST 배지 + 비용 배지 + 제목 + 썸네일 */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={`/community/post/${post.id}`}
                className="text-sm font-semibold text-[#1c1c1e] hover:text-[#2563EB] leading-snug line-clamp-2 transition-colors duration-200"
              >
                {post.is_weekly_best && (
                  <span className="text-xs font-bold text-[#FF4500] mr-2">
                    BEST
                  </span>
                )}
                {post.category === "cost_share" && totalCost != null && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg mr-2">
                    총 {formatCost(totalCost)}
                  </span>
                )}
                {post.title}
              </Link>
            </div>

            {/* 썸네일 (오른쪽) */}
            {hasThumbnail && (
              <Link
                href={`/community/post/${post.id}`}
                className="shrink-0 w-20 h-16 sm:w-24 sm:h-[72px] rounded-lg overflow-hidden bg-[#F4F6F8]"
              >
                <Image
                  src={post.images[0]}
                  alt=""
                  width={96}
                  height={72}
                  className="w-full h-full object-cover"
                />
              </Link>
            )}
          </div>

          {/* 본문 미리보기 */}
          {contentPreview && (
            <p className="mt-2 text-xs text-[#6B7280] leading-snug line-clamp-2">
              {contentPreview}
            </p>
          )}

          {/* 태그 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="bg-[#F4F6F8] text-[#6B7280] rounded-lg px-2 py-0.5 text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 하단 액션 행 */}
          <div className="mt-2 flex items-center gap-4 text-xs font-medium text-[#6B7280]">
            <Link
              href={`/community/post/${post.id}#comments`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200"
            >
              <MessageCircle className="w-4 h-4" />
              <span>{post.comment_count}개 댓글</span>
            </Link>
            <button
              type="button"
              onClick={handleBookmark}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200 ${
                bookmarked ? "text-[#2563EB]" : ""
              }`}
            >
              <Bookmark className="w-4 h-4" fill={bookmarked ? "#2563EB" : "none"} />
              <span>저장</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200"
            >
              <Share2 className="w-4 h-4" />
              <span>공유</span>
            </button>
            <span className="flex items-center gap-1 px-2 py-1">
              <Eye className="w-4 h-4" />
              <span>{post.view_count}</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
