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
    <article className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] hover:shadow-md transition-shadow relative">
      {/* 북마크 버튼 (우상단) */}
      <button
        type="button"
        onClick={handleBookmark}
        className="absolute top-2.5 right-2.5 z-10 p-1 rounded-md hover:bg-[#F4F6F8] transition-colors"
        aria-label="북마크"
      >
        <Bookmark
          className={`w-4 h-4 transition-colors ${
            bookmarked ? "text-[#2563EB] fill-[#2563EB]" : "text-[#B0B0B0] hover:text-[#6B7280]"
          }`}
        />
      </button>

      <div className="flex">
        {/* 왼쪽 투표 스트립 */}
        <div className="flex-shrink-0 w-11 bg-[#FAFAFA] rounded-l-lg flex justify-center">
          <VoteButtons
            count={voteCount}
            userVote={post.user_vote ?? null}
            onVote={(vote) => onVote?.(post.id, vote)}
            isLoggedIn={isLoggedIn}
          />
        </div>

        {/* 오른쪽 콘텐츠 */}
        <div className="flex-1 min-w-0 p-2.5 sm:p-3 pr-8">
          {/* 메타 라인: 아바타 + 카테고리 + 작성자 + 시간 */}
          <div className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-1.5">
            {categoryInfo && (
              <>
                <span className={`font-semibold px-1.5 py-0.5 rounded-md text-[11px] ${categoryInfo.color} bg-current/5`}>
                  {categoryInfo.shortLabel}
                </span>
                <span>&middot;</span>
              </>
            )}
            {/* 작성자 아바타 */}
            {post.author.avatar_url ? (
              <Image
                src={post.author.avatar_url}
                alt={post.author.nickname}
                width={18}
                height={18}
                className="w-[18px] h-[18px] rounded-full object-cover"
              />
            ) : (
              <span className="w-[18px] h-[18px] rounded-full bg-[#E5E7EB] text-[10px] font-bold text-[#6B7280] flex items-center justify-center shrink-0">
                {avatarLetter}
              </span>
            )}
            <span>
              <Link
                href={`/community?author_id=${post.author_id}`}
                className="font-medium text-[#1c1c1e] hover:text-[#2563EB] hover:underline transition-colors"
              >
                {post.author.nickname}
              </Link>
            </span>
            {badgeLabel(post.author.badge) && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-[#FF4500]/10 text-[#FF4500] rounded-md">
                {badgeLabel(post.author.badge)}
              </span>
            )}
            <span>&middot;</span>
            <span>{timeAgo(post.created_at)}</span>
          </div>

          {/* 제목 행: BEST 배지 + 비용 배지 + 제목 + 썸네일 */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={`/community/post/${post.id}`}
                className="text-[15px] font-semibold text-[#1c1c1e] hover:text-[#2563EB] leading-snug line-clamp-2 transition-colors"
              >
                {post.is_weekly_best && (
                  <span className="text-xs font-bold text-[#FF4500] mr-1.5">
                    BEST
                  </span>
                )}
                {post.category === "cost_share" && totalCost != null && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md mr-1.5">
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
                className="shrink-0 w-[96px] h-[72px] rounded-lg overflow-hidden bg-[#F4F6F8]"
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
            <p className="mt-1 text-[13px] text-[#6B7280] leading-snug line-clamp-2">
              {contentPreview}
            </p>
          )}

          {/* 태그 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="bg-[#F4F6F8] text-[#6B7280] rounded-md px-2 py-0.5 text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 하단 액션 행 */}
          <div className="mt-2 flex items-center gap-0.5 text-xs font-medium text-[#6B7280]">
            <Link
              href={`/community/post/${post.id}#comments`}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#F4F6F8] transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span>{post.comment_count}개 댓글</span>
            </Link>
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#F4F6F8] transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>공유</span>
            </button>
            <button
              type="button"
              onClick={handleBookmark}
              className={`flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#F4F6F8] transition-colors ${
                bookmarked ? "text-[#2563EB]" : ""
              }`}
            >
              <Bookmark className="w-4 h-4" fill={bookmarked ? "#2563EB" : "none"} />
              <span>저장</span>
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
