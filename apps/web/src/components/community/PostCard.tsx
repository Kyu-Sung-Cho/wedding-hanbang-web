"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MessageCircle,
  Share2,
  Bookmark,
  Pin,
} from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { PostWithAuthor } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
  isLoggedIn?: boolean;
  onVote?: (postId: string, vote: 1 | -1) => void;
  onBookmark?: (postId: string) => void;
}

// 카테고리별 배지 색상 (sage/rose/tertiary 변주)
const CATEGORY_BADGE_BG: Record<string, string> = {
  is_normal: "bg-[#dee6c4]/30 text-[#5a6147]", // sage (secondary-container)
  tour_review: "bg-[#d4c2c2]/30 text-[#795252]", // rose (outline-variant + primary)
  tips_v2: "bg-[#625b4d]/15 text-[#625b4d]", // tertiary
  ama: "bg-[#795252]/10 text-[#795252]", // primary
  free: "bg-[#dee6c4]/30 text-[#5a6147]", // sage
};

// 비용 포맷 헬퍼
function formatPrice(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}억`;
  }
  return value.toLocaleString("ko-KR");
}

export default function PostCard({ post, onBookmark }: PostCardProps) {
  const categoryInfo = CATEGORY_MAP[post.category];
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);

  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const author = post.author ?? { nickname: "익명" };

  // 이미지 처리
  const images = post.images ?? [];
  const imageCount = images.length;
  const hasImage = imageCount > 0;

  // 카테고리 배지 스타일
  const categoryBadgeStyle = CATEGORY_BADGE_BG[post.category] || "bg-[#dee6c4]/30 text-[#5a6147]";

  function handleBookmark(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBookmarked((prev) => !prev);
    onBookmark?.(post.id);
  }

  return (
    <article className="bg-white rounded-xl p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 border border-transparent hover:border-[#e4e2e1]/50">
      <div className={`flex ${hasImage ? "flex-col-reverse sm:flex-row" : ""} gap-6`}>
        {/* 텍스트 영역 */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                {categoryInfo && (
                  <span className={`text-xs font-medium px-2 py-1 rounded ${categoryBadgeStyle}`}>
                    {categoryInfo.shortLabel}
                  </span>
                )}
                <span className="text-xs text-[#504444]">{timeAgo(post.created_at)}</span>

                {post.ad_disclosure === "sponsored" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEFCE8] text-[#A16207] text-xs font-medium">협찬</span>
                )}
                {post.ad_disclosure === "ad" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-xs font-medium">광고</span>
                )}
              </div>
            </div>

            <Link href={`/community/post/${post.id}`} className="group block">
              <h4 className="text-xl font-serif-kr text-[#1b1c1c] mb-2 hover:text-[#795252] cursor-pointer transition-colors leading-snug line-clamp-2">
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-[#795252] mr-2 text-sm font-medium align-middle">
                    <Pin className="w-3.5 h-3.5" /> PIN
                  </span>
                )}
                {post.is_weekly_best && (
                  <span className="text-[#625b4d] text-xs font-medium mr-2 align-middle tracking-wider uppercase">
                    Best
                  </span>
                )}
                {post.title}
              </h4>
            </Link>

            {contentPreview && (
              <p className="text-[#504444] text-sm line-clamp-2 mb-4">{contentPreview}</p>
            )}

            {/* 비용 데이터 */}
            {post.cost_data && (
              <div className="bg-[#f6f3f2] rounded-lg px-3 py-1.5 mb-4 inline-block">
                <span className="text-xs text-[#504444]">비용: </span>
                <span className="text-sm font-medium text-[#1b1c1c]">{formatPrice(post.cost_data.totalCost)}만원</span>
              </div>
            )}
          </div>

          {/* 하단 */}
          <div className="flex items-center justify-between mt-auto pt-2">
            <div className="flex items-center space-x-2">
              <Link href={`/community?author_id=${post.author_id}`} className="shrink-0">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white text-[8px]">
                  {author.nickname.charAt(0)}
                </div>
              </Link>
              <span className="text-xs text-[#504444]">{author.nickname}</span>
            </div>

            <div className="flex items-center space-x-4 text-[#504444]">
              {/* 댓글 */}
              <Link
                href={`/community/post/${post.id}#comments`}
                className="flex items-center space-x-1 hover:text-[#795252] group"
              >
                <MessageCircle className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" />
                <span className="text-xs">{post.comment_count}</span>
              </Link>

              {/* 북마크 */}
              <button
                type="button"
                onClick={handleBookmark}
                className={`flex items-center space-x-1 group ${
                  bookmarked ? "text-[#795252]" : "hover:text-[#795252]"
                }`}
                aria-label="저장"
              >
                <Bookmark
                  className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100"
                  fill={bookmarked ? "#795252" : "none"}
                />
              </button>

              {/* 공유 */}
              <button
                type="button"
                className="flex items-center space-x-1 hover:text-[#795252] group"
                aria-label="공유"
              >
                <Share2 className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>

        {/* 이미지 (있으면 오른쪽) — 레퍼런스: sm:w-32 h-32 */}
        {hasImage && (
          <Link
            href={`/community/post/${post.id}`}
            className="w-full sm:w-32 h-32 rounded-lg overflow-hidden shrink-0 mt-4 sm:mt-0"
          >
            <Image
              src={images[0]}
              alt=""
              width={128}
              height={128}
              className="w-full h-full object-cover"
            />
          </Link>
        )}
      </div>
    </article>
  );
}
