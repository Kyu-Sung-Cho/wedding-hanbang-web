"use client";

import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Eye, ThumbsUp } from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
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

  return (
    <article className="bg-white border border-[#F5F2ED] rounded-2xl p-4 sm:p-5 hover:border-[#B5ADA3] transition-colors">
      <div className="flex gap-4">
        {/* 본문 영역 */}
        <div className="flex-1 min-w-0">
          {/* 카테고리 배지 + 비용 뱃지 */}
          <div className="flex items-center gap-2 mb-2">
            {categoryInfo && (
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${categoryInfo.bgColor} ${categoryInfo.color}`}
              >
                {categoryInfo.shortLabel}
              </span>
            )}
            {post.category === "cost_share" && totalCost != null && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-600">
                총 {formatCost(totalCost)}
              </span>
            )}
            {post.is_weekly_best && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-[#C9A96E]/10 text-[#C9A96E]">
                BEST
              </span>
            )}
          </div>

          {/* 제목 */}
          <Link
            href={`/community/post/${post.id}`}
            className="block text-[#1A1A1F] font-medium leading-snug hover:text-[#C4967E] transition-colors line-clamp-2"
          >
            {post.title}
          </Link>

          {/* 본문 미리보기 */}
          {contentPreview && (
            <p className="mt-1.5 text-sm text-[#928980] leading-relaxed line-clamp-2">
              {contentPreview}
            </p>
          )}

          {/* 태그 */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs text-[#928980] bg-[#FAF8F5] rounded-full"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 작성자 + 시간 */}
          <div className="mt-3 flex items-center gap-2 text-xs text-[#B5ADA3]">
            <span className="font-medium text-[#928980]">{post.author.nickname}</span>
            {badgeLabel(post.author.badge) && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#C4967E]/10 text-[#C4967E] rounded">
                {badgeLabel(post.author.badge)}
              </span>
            )}
            <span>&middot;</span>
            <span>{timeAgo(post.created_at)}</span>
          </div>

          {/* 통계 행 */}
          <div className="mt-2 flex items-center gap-4 text-xs text-[#B5ADA3]">
            <span className="flex items-center gap-1">
              <ThumbsUp className="w-3.5 h-3.5" />
              {post.upvote_count - post.downvote_count}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" />
              {post.comment_count}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              {post.view_count}
            </span>
          </div>
        </div>

        {/* 썸네일 */}
        {hasThumbnail && (
          <Link
            href={`/community/post/${post.id}`}
            className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#F5F2ED]"
          >
            <Image
              src={post.images[0]}
              alt=""
              width={96}
              height={96}
              className="w-full h-full object-cover"
            />
          </Link>
        )}
      </div>
    </article>
  );
}
