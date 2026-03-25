"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Share2, Bookmark, Eye } from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import VoteButtons from "./VoteButtons";
import type { PostWithAuthor, BadgeType, CommunityCategory } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
  isLoggedIn?: boolean;
  onVote?: (postId: string, vote: 1 | -1) => void;
  onBookmark?: (postId: string) => void;
}

// 카테고리 색상 배지 스타일 (Tailwind는 동적 클래스 불가)
const CATEGORY_BADGE_STYLES: Record<string, string> = {
  "text-rose-600": "bg-rose-50 text-rose-700 border border-rose-200",
  "text-amber-600": "bg-amber-50 text-amber-700 border border-amber-200",
  "text-emerald-600": "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "text-yellow-600": "bg-yellow-50 text-yellow-700 border border-yellow-200",
  "text-sky-600": "bg-sky-50 text-sky-700 border border-sky-200",
  "text-violet-600": "bg-violet-50 text-violet-700 border border-violet-200",
  "text-slate-600": "bg-slate-50 text-slate-700 border border-slate-200",
};

// 사용자 배지 스타일
const USER_BADGE_CONFIG: Record<string, { icon: string; label: string; style: string } | null> = {
  member: null,
  verified_couple: {
    icon: "\uD83D\uDC8D",
    label: "인증 커플",
    style: "bg-rose-50 text-rose-600 border border-rose-200",
  },
  top_contributor: {
    icon: "\u2B50",
    label: "탑 기여자",
    style: "bg-amber-50 text-amber-600 border border-amber-200",
  },
  admin: {
    icon: "\uD83D\uDEE1\uFE0F",
    label: "관리자",
    style: "bg-blue-50 text-blue-600 border border-blue-200",
  },
};

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
  const imageCount = post.images?.length ?? 0;
  const totalCost = post.cost_data?.totalCost;
  const voteCount = post.upvote_count - post.downvote_count;

  // 인기 게시글 판단
  const isHot = voteCount >= 10;
  const isVeryHot = voteCount >= 50;

  // 아바타 첫 글자
  const avatarLetter = post.author.nickname?.charAt(0) || "?";

  // 카테고리 배지 스타일
  const catBadgeStyle = categoryInfo
    ? CATEGORY_BADGE_STYLES[categoryInfo.color] || "bg-[#F4F6F8] text-[#6B7280]"
    : "bg-[#F4F6F8] text-[#6B7280]";

  // 사용자 배지 설정
  const userBadge = USER_BADGE_CONFIG[post.author.badge] ?? null;

  function handleBookmark() {
    setBookmarked((prev) => !prev);
    onBookmark?.(post.id);
  }

  // 카드 배경색: 주간 베스트면 따뜻한 톤
  const cardBg = post.is_weekly_best ? "bg-[#FFFBF5]" : "bg-white";

  // 고정 게시글 상단 보더
  const pinnedBorder = post.is_pinned ? "border-t-2 border-t-[#2563EB]" : "";

  return (
    <article
      className={`${cardBg} rounded-xl shadow-sm border border-[#E5E7EB] hover:shadow-md transition-all duration-200 ${pinnedBorder}`}
    >
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
          <div className="flex items-center gap-2 text-xs text-[#6B7280] mb-2 flex-wrap">
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

            {/* 사용자 배지 (member 제외) */}
            {userBadge && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${userBadge.style}`}
              >
                <span className="text-[10px] leading-none">{userBadge.icon}</span>
                {userBadge.label}
              </span>
            )}

            <span>&middot;</span>
            <span>{timeAgo(post.created_at)}</span>

            {/* 고정 표시 */}
            {post.is_pinned && (
              <>
                <span>&middot;</span>
                <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2563EB]">
                  <span className="text-[10px] leading-none">{"\uD83D\uDCCC"}</span>
                  고정됨
                </span>
              </>
            )}

            {/* 카테고리 배지 (색상 적용) */}
            {categoryInfo && (
              <>
                <span>&middot;</span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${catBadgeStyle}`}
                >
                  {categoryInfo.shortLabel}
                </span>
              </>
            )}
          </div>

          {/* 제목 행: 고정 아이콘 + BEST 배지 + 비용 배지 + 제목 + 썸네일 */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <Link
                href={`/community/post/${post.id}`}
                className="text-sm font-semibold text-[#1c1c1e] hover:text-[#2563EB] leading-snug line-clamp-2 transition-colors duration-200"
              >
                {/* 고정 게시글 아이콘 */}
                {post.is_pinned && (
                  <span className="text-[#2563EB] mr-1">{"\uD83D\uDCCC"}</span>
                )}

                {/* 주간 베스트 배지 */}
                {post.is_weekly_best && (
                  <span className="inline-flex items-center text-[11px] font-bold text-white bg-gradient-to-r from-[#FF4500] to-[#FF6B35] px-2 py-0.5 rounded mr-2 align-middle">
                    <span className="mr-0.5">{"\uD83D\uDD25"}</span>BEST
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

            {/* 썸네일 (오른쪽) + 이미지 카운트 오버레이 */}
            {hasThumbnail && (
              <Link
                href={`/community/post/${post.id}`}
                className="shrink-0 w-20 h-16 sm:w-24 sm:h-[72px] rounded-lg overflow-hidden bg-[#F4F6F8] relative"
              >
                <Image
                  src={post.images[0]}
                  alt=""
                  width={96}
                  height={72}
                  className="w-full h-full object-cover"
                />
                {/* 이미지 카운트 배지 */}
                {imageCount > 1 && (
                  <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <span>{"\uD83D\uDCF7"}</span>
                    {imageCount}
                  </span>
                )}
              </Link>
            )}
          </div>

          {/* 본문 미리보기 */}
          {contentPreview && (
            <p className="mt-2 text-xs text-[#6B7280] leading-snug line-clamp-2">
              {contentPreview}
            </p>
          )}

          {/* 태그 (블루 틴트) */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] rounded-lg px-2 py-0.5 text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 하단 액션 행 */}
          <div className="mt-2 flex items-center gap-4 text-xs font-medium text-[#6B7280]">
            {/* 투표 수 표시 (인기글은 강조) */}
            <span
              className={`flex items-center gap-1 px-2 py-1 ${
                isHot
                  ? `text-[#FF4500] ${isVeryHot ? "text-base font-bold" : "font-bold"}`
                  : ""
              }`}
            >
              {isHot && <span className="text-[10px]">{"\u25B2"}</span>}
              {voteCount > 0 ? `+${voteCount}` : voteCount}
            </span>

            {/* 댓글 수 (댓글 있으면 강조) */}
            <Link
              href={`/community/post/${post.id}#comments`}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[#F4F6F8] transition-all duration-200 ${
                post.comment_count > 0 ? "text-[#1c1c1e] font-semibold" : ""
              }`}
            >
              <MessageCircle
                className="w-4 h-4"
                fill={post.comment_count > 0 ? "#F4F6F8" : "none"}
              />
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
