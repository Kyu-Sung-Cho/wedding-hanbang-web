"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MessageCircle,
  Share2,
  Bookmark,
  Pin,
  BarChart3,
  Heart,
  Check,
} from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { PostWithAuthor } from "@/types/community.types";
import Avatar from "./Avatar";
import { useCommunityStore } from "@/stores/communityStore";
import { useAuthStore } from "@/stores/authStore";

interface PostCardProps {
  post: PostWithAuthor;
}

// 카테고리별 배지 색상 (sage/rose/tertiary 변주)
const CATEGORY_BADGE_BG: Record<string, string> = {
  is_normal: "bg-[#dee6c4]/30 text-sage-500", // sage (secondary-container)
  tour_review: "bg-[#d4c2c2]/30 text-[#795252]", // rose (outline-variant + primary)
  tips_v2: "bg-[#625b4d]/15 text-[#625b4d]", // tertiary
  ama: "bg-[#795252]/10 text-[#795252]", // primary
  free: "bg-[#dee6c4]/30 text-sage-500", // sage
};

// 비용 포맷 헬퍼
function formatPrice(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}억`;
  }
  return value.toLocaleString("ko-KR");
}

export default function PostCard({ post }: PostCardProps) {
  const categoryInfo = CATEGORY_MAP[post.category];
  const { votePost, toggleBookmark } = useCommunityStore();
  const { profile } = useAuthStore();
  const isLoggedIn = !!profile;

  // 낙관적 UI — 좋아요/북마크/공유
  const [optimisticVote, setOptimisticVote] = useState<1 | -1 | null | undefined>(undefined);
  const [optimisticUpvoteDelta, setOptimisticUpvoteDelta] = useState(0);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);
  const [voting, setVoting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);

  const displayVote = optimisticVote === undefined ? (post.user_vote ?? null) : optimisticVote;
  const displayUpvoteCount = (post.upvote_count ?? 0) + optimisticUpvoteDelta;
  const isLiked = displayVote === 1;

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
  const categoryBadgeStyle = CATEGORY_BADGE_BG[post.category] || "bg-[#dee6c4]/30 text-sage-500";

  function showLoginToast() {
    setLoginPrompt(true);
    setTimeout(() => setLoginPrompt(false), 2000);
  }

  async function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoggedIn) return showLoginToast();
    if (voting) return;

    const prev = displayVote;
    let next: 1 | -1 | null;
    let delta = 0;
    if (prev === 1) {
      next = null;
      delta = -1;
    } else if (prev === -1) {
      next = 1;
      delta = 2;
    } else {
      next = 1;
      delta = 1;
    }
    setOptimisticVote(next);
    setOptimisticUpvoteDelta((d) => d + delta);
    setVoting(true);
    try {
      await votePost(post.id, next === null ? 0 : next);
    } catch {
      // 실패 시 롤백
      setOptimisticVote(prev);
      setOptimisticUpvoteDelta((d) => d - delta);
    } finally {
      setVoting(false);
    }
  }

  async function handleBookmark(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoggedIn) return showLoginToast();
    if (bookmarking) return;
    setBookmarked((prev) => !prev);
    setBookmarking(true);
    try {
      await toggleBookmark(post.id);
    } finally {
      setBookmarking(false);
    }
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/community/post/${post.id}`;
    const title = post.title;

    // 모바일 — 네이티브 시트
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // 사용자가 취소한 경우 — silent
        return;
      }
    }
    // 데스크탑 — 클립보드
    try {
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <article className="relative bg-white rounded-2xl p-5 sm:p-6 md:p-7 lg:p-8 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 border border-transparent hover:border-[#e4e2e1]/50">
      {/* 인라인 토스트 */}
      {(shareToast || loginPrompt) && (
        <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1A1A1F] text-white text-xs font-medium shadow-lg animate-fade-in">
          {shareToast ? (
            <>
              <Check className="w-3.5 h-3.5" />
              링크 복사됨
            </>
          ) : (
            "로그인이 필요해요"
          )}
        </div>
      )}
      <div className={`flex ${hasImage ? "flex-col-reverse sm:flex-row" : ""} gap-5 sm:gap-6 lg:gap-8`}>
        {/* 텍스트 영역 */}
        <div className="flex-1 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 sm:space-x-3 flex-wrap">
                {categoryInfo && (
                  <span className={`text-xs sm:text-sm font-medium px-2.5 py-1 rounded ${categoryBadgeStyle}`}>
                    {categoryInfo.shortLabel}
                  </span>
                )}
                <span className="text-xs sm:text-sm text-[#504444]">{timeAgo(post.created_at)}</span>

                {post.ad_disclosure === "sponsored" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEFCE8] text-[#A16207] text-xs font-medium">협찬</span>
                )}
                {post.ad_disclosure === "ad" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-xs font-medium">광고</span>
                )}
              </div>
            </div>

            <Link href={`/community/post/${post.id}`} className="group block">
              <h4 className="text-lg sm:text-xl md:text-2xl xl:text-[28px] font-serif-kr text-[#1b1c1c] mb-3 hover:text-[#795252] cursor-pointer transition-colors leading-snug line-clamp-2 break-words">
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
              <p className="text-[#504444] text-sm sm:text-base lg:text-[15px] xl:text-base leading-relaxed line-clamp-2 mb-5">{contentPreview}</p>
            )}

            {/* 비용 데이터 + 폴 배지 */}
            {(post.cost_data || post.poll) && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {post.cost_data && (
                  <div className="bg-[#f6f3f2] rounded-lg px-3 py-1.5 inline-block">
                    <span className="text-xs text-[#504444]">비용: </span>
                    <span className="text-sm font-medium text-[#1b1c1c]">{formatPrice(post.cost_data.totalCost)}만원</span>
                  </div>
                )}
                {post.poll && (() => {
                  const isClosed = post.poll.closes_at
                    ? new Date(post.poll.closes_at).getTime() <= Date.now()
                    : false;
                  return (
                    <Link
                      href={`/community/post/${post.id}`}
                      className={`inline-flex items-center gap-2 max-w-full px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                        isClosed
                          ? "text-[#928980] bg-[#f6f3f2] border-[#e4e2e1] hover:bg-white"
                          : "text-[#795252] bg-[#fcf9f8] border-[#f0eeec] hover:border-[#795252] hover:bg-white"
                      }`}
                      title={post.poll.question}
                    >
                      <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[180px] sm:max-w-[220px]">
                        {post.poll.question}
                      </span>
                      <span className="shrink-0 text-[#B5ADA3]">·</span>
                      <span className="shrink-0 tabular-nums">
                        {post.poll.total_voters.toLocaleString()}명
                      </span>
                      {isClosed && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#e4e2e1] text-[#504444]">
                          마감
                        </span>
                      )}
                    </Link>
                  );
                })()}
              </div>
            )}
          </div>

          {/* 하단 — 닉네임 길어지면 액션이 자연스럽게 wrap */}
          <div className="flex items-center justify-between flex-wrap gap-y-2 gap-x-3 mt-auto pt-2">
            <div className="flex items-center space-x-2 min-w-0">
              <Link href={`/community?author_id=${post.author_id}`} className="shrink-0">
                <Avatar
                  nickname={author.nickname}
                  avatarUrl={(author as { avatar_url?: string | null }).avatar_url ?? null}
                  size={40}
                />
              </Link>
              <span className="text-sm sm:text-base text-[#504444] truncate max-w-[140px] sm:max-w-none">
                {author.nickname}
              </span>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 text-[#504444] flex-shrink-0 ml-auto">
              {/* 좋아요 */}
              <button
                type="button"
                onClick={handleLike}
                disabled={voting}
                className={`flex items-center gap-1 group transition-colors disabled:opacity-60 ${
                  isLiked ? "text-[#D85A5A]" : "hover:text-[#D85A5A]"
                }`}
                aria-label="좋아요"
                title="좋아요"
              >
                <Heart
                  className="w-5 h-5 sm:w-6 sm:h-6 opacity-70 group-hover:opacity-100 transition-all"
                  fill={isLiked ? "currentColor" : "none"}
                />
                {displayUpvoteCount > 0 && (
                  <span className="text-sm sm:text-base tabular-nums">
                    {displayUpvoteCount}
                  </span>
                )}
              </button>

              {/* 댓글 */}
              <Link
                href={`/community/post/${post.id}#comments`}
                className="flex items-center gap-1 hover:text-[#795252] group"
              >
                <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 opacity-60 group-hover:opacity-100" />
                <span className="text-sm sm:text-base">{post.comment_count}</span>
              </Link>

              {/* 북마크 */}
              <button
                type="button"
                onClick={handleBookmark}
                disabled={bookmarking}
                className={`flex items-center group disabled:opacity-60 ${
                  bookmarked ? "text-[#795252]" : "hover:text-[#795252]"
                }`}
                aria-label="저장"
                title="저장"
              >
                <Bookmark
                  className="w-5 h-5 sm:w-6 sm:h-6 opacity-60 group-hover:opacity-100"
                  fill={bookmarked ? "#795252" : "none"}
                />
              </button>

              {/* 공유 */}
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center hover:text-[#795252] group"
                aria-label="공유"
                title="공유"
              >
                <Share2 className="w-5 h-5 sm:w-6 sm:h-6 opacity-60 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>

        {/* 이미지 (있으면 오른쪽) — 레퍼런스: sm:w-32 h-32 */}
        {hasImage && (
          <Link
            href={`/community/post/${post.id}`}
            className="w-full h-40 sm:w-44 sm:h-44 lg:w-52 lg:h-52 xl:w-60 xl:h-60 rounded-xl overflow-hidden shrink-0"
          >
            <Image
              src={images[0]}
              alt=""
              width={256}
              height={256}
              className="w-full h-full object-cover"
            />
          </Link>
        )}
      </div>
    </article>
  );
}
