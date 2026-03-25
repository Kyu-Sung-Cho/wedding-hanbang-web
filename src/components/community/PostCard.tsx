"use client";

import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Share2, Bookmark, Eye } from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import VoteButtons from "./VoteButtons";
import type { PostWithAuthor, BadgeType } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
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

export default function PostCard({ post }: PostCardProps) {
  const categoryInfo = CATEGORY_MAP[post.category];

  // 본문 미리보기: HTML 태그 제거 후 150자
  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

  const hasThumbnail = post.images && post.images.length > 0;
  const totalCost = post.cost_data?.totalCost;
  const voteCount = post.upvote_count - post.downvote_count;

  return (
    <article className="bg-white border border-[#ccc]/40 rounded hover:border-[#898989] transition-colors">
      <div className="flex">
        {/* 왼쪽 투표 스트립 */}
        <div className="flex-shrink-0 w-10 bg-[#F8F9FA] rounded-l flex justify-center">
          <VoteButtons
            count={voteCount}
            userVote={null}
            onVote={() => {}}
            isLoggedIn={false}
          />
        </div>

        {/* 오른쪽 콘텐츠 */}
        <div className="flex-1 min-w-0 p-2 sm:p-3">
          {/* 메타 라인: 카테고리 · 작성자 · 시간 */}
          <div className="flex items-center gap-1 text-xs text-[#878A8C] mb-1">
            {categoryInfo && (
              <>
                <span className={`font-bold ${categoryInfo.color}`}>
                  {categoryInfo.shortLabel}
                </span>
                <span>&middot;</span>
              </>
            )}
            <span>
              작성자{" "}
              <span className="font-medium text-[#1c1c1c]">
                {post.author.nickname}
              </span>
            </span>
            {badgeLabel(post.author.badge) && (
              <span className="px-1 py-0.5 text-[10px] font-semibold bg-[#FF4500]/10 text-[#FF4500] rounded-sm">
                {badgeLabel(post.author.badge)}
              </span>
            )}
            <span>&middot;</span>
            <span>{timeAgo(post.created_at)}</span>
          </div>

          {/* 제목 행: BEST 배지 + 비용 배지 + 제목 */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={`/community/post/${post.id}`}
                className="text-lg font-medium text-[#222] hover:underline leading-snug line-clamp-2"
              >
                {post.is_weekly_best && (
                  <span className="text-xs font-bold text-[#FF4500] mr-1.5">
                    BEST
                  </span>
                )}
                {post.category === "cost_share" && totalCost != null && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-sm mr-1.5">
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
                className="shrink-0 w-[96px] h-[72px] rounded overflow-hidden bg-[#F8F9FA]"
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
            <p className="mt-1 text-sm text-[#878A8C] leading-snug line-clamp-2">
              {contentPreview}
            </p>
          )}

          {/* 태그 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="text-xs text-[#878A8C]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 하단 액션 행 */}
          <div className="mt-2 flex items-center gap-1 text-xs font-bold text-[#878A8C]">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[#F8F9FA] transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span>{post.comment_count}개 댓글</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[#F8F9FA] transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>공유</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-[#F8F9FA] transition-colors"
            >
              <Bookmark className="w-4 h-4" />
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
