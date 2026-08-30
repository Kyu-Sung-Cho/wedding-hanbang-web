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
  Eye,
  Heart,
  Check,
  Layers,
  Play,
} from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { PostWithAuthor } from "@/types/community.types";
import Avatar from "./Avatar";
import AdDisclosureBadge from "./AdDisclosureBadge";
import ContentOriginBadge from "./ContentOriginBadge";
import { communityPostPath, communityPostUrl } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";
import { useCommunityStore } from "@/stores/communityStore";
import { useAuthStore } from "@/stores/authStore";

interface PostCardProps {
  post: PostWithAuthor;
}

// 카테고리별 배지 색상 (soft neutrals + jade accent)
const CATEGORY_BADGE_BG: Record<string, string> = {
  is_normal: "bg-[#dee6c4]/30 text-[var(--hb-success)]", // sage (secondary-container)
  tour_review: "bg-[#dfc9c1]/30 text-[var(--hb-text-strong)]", // warm outline + primary
  tips_v2: "bg-[#635b51]/15 text-[var(--hb-text-body)]", // tertiary
  ama: "bg-[var(--hb-primary)]/10 text-[var(--hb-text-strong)]", // primary
  free: "bg-[#dee6c4]/30 text-[var(--hb-success)]", // sage
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
  const [optimisticVote, setOptimisticVote] = useState<1 | null | undefined>(undefined);
  const [optimisticUpvoteDelta, setOptimisticUpvoteDelta] = useState(0);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);
  const [voting, setVoting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  const displayVote = optimisticVote === undefined ? (post.user_vote === 1 ? 1 : null) : optimisticVote;
  const displayUpvoteCount = Math.max(0, (post.upvote_count ?? 0) + optimisticUpvoteDelta);
  const isLiked = displayVote === 1;

  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  // 본문 안에 인라인으로 삽입된 첫 번째 <img>의 src를 추출 — 우측 카드 썸네일 fallback
  const firstInlineImage = (() => {
    const match = post.content.match(/<img\s+[^>]*src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  })();

  const author = post.author ?? { nickname: "익명" };

  // 이미지 처리
  // 카드 게시물(슬라이드) > 첨부 이미지 > 본문 인라인 이미지 fallback
  const slides = post.slides ?? [];
  const hasSlides = slides.length > 0;
  const firstSlide = hasSlides ? slides[0] : null;
  const isVideoSlide = firstSlide?.type === "video";
  const slideThumb = firstSlide
    ? firstSlide.thumbnail_url || (isVideoSlide ? null : firstSlide.url)
    : null;

  const images = post.images ?? [];
  const thumbUrl = slideThumb ?? images[0] ?? firstInlineImage;
  const hasImage = !!thumbUrl;

  // 카테고리 배지 스타일
  const categoryBadgeStyle = CATEGORY_BADGE_BG[post.category] || "bg-[#dee6c4]/30 text-[var(--hb-success)]";

  function showLoginToast() {
    setLoginPrompt(true);
    setTimeout(() => setLoginPrompt(false), 2000);
  }

  /** 서버가 거절한 이유를 이미 있는 인라인 토스트로 말한다. */
  function showActionToast(message: string) {
    setActionToast(message);
    setTimeout(() => setActionToast(null), 3000);
  }

  async function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoggedIn) return showLoginToast();
    if (voting) return;

    const prev = displayVote;
    const next: 1 | null = prev === 1 ? null : 1;
    const delta = prev === 1 ? -1 : 1;
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
    // 먼저 뒤집되 **되돌릴 준비를 한다.** 예전에는 실패해도 채워진 채 남아서
    // 저장된 줄 알고 화면을 떠났다. 같은 파일의 추천(handleLike)은 이미 되돌린다.
    const previous = bookmarked;
    setBookmarked(!previous);
    setBookmarking(true);
    try {
      const result = await toggleBookmark(post.id);
      if (!result.ok) {
        setBookmarked(previous);
        showActionToast(result.message);
      }
    } catch {
      setBookmarked(previous);
      showActionToast("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBookmarking(false);
    }
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === "undefined") return;
    const url = communityPostUrl(window.location.origin, post.id);
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
    <article className="relative rounded-lg border border-[#ece7e3] bg-white p-4 transition-all duration-300 hover:border-[#d8d1cc] hover:shadow-[var(--shadow-raised)] sm:p-5">
      {/* 인라인 토스트 */}
      {(shareToast || loginPrompt || actionToast) && (
        <div
          role={actionToast ? "alert" : undefined}
          className="absolute top-3 right-3 z-10 inline-flex max-w-[80%] items-center gap-1.5 rounded-full bg-[#1A1A1F] px-3 py-1.5 text-xs font-medium text-white shadow-lg animate-fade-in"
        >
          {shareToast ? (
            <>
              <Check className="w-3.5 h-3.5" />
              링크 복사됨
            </>
          ) : actionToast ? (
            actionToast
          ) : (
            "로그인이 필요해요"
          )}
        </div>
      )}
      <div className={`flex ${hasImage ? "flex-row" : ""} gap-4 sm:gap-5`}>
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
                <span suppressHydrationWarning className="text-xs sm:text-sm text-[var(--hb-text-body)]">{timeAgo(post.created_at)}</span>

                {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
                  <AdDisclosureBadge
                    adDisclosure={post.ad_disclosure}
                    sponsorshipDetail={post.sponsorship_detail}
                    size="sm"
                  />
                )}
              </div>
            </div>

            <Link href={communityPostPath(post.id)} className="group block">
              <h4 className="text-[17px] sm:text-lg font-serif-kr text-[var(--hb-text-strong)] mb-2.5 hover:text-[var(--hb-text-strong)] cursor-pointer transition-colors leading-snug line-clamp-2 break-words">
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-[var(--hb-text-strong)] mr-2 text-sm font-medium align-middle">
                    <Pin className="w-3.5 h-3.5" /> PIN
                  </span>
                )}
                {post.is_weekly_best && (
                  <span className="text-[var(--hb-text-body)] text-xs font-medium mr-2 align-middle tracking-wider uppercase">
                    Best
                  </span>
                )}
                {post.title}
              </h4>
            </Link>

            {contentPreview && (
              <p className="ugc-text text-[var(--hb-text-body)] text-sm leading-relaxed line-clamp-2 mb-3.5">{contentPreview}</p>
            )}

            {/* 비용 데이터 + 폴 배지 */}
            {(post.cost_data || post.poll) && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {post.cost_data && (
                  <div className="bg-[var(--hb-surface-hover)] rounded-lg px-3 py-1.5 inline-block">
                    <span className="text-xs text-[var(--hb-text-body)]">비용: </span>
                    <span className="text-sm font-medium text-[var(--hb-text-strong)]">{formatPrice(post.cost_data.totalCost)}만원</span>
                  </div>
                )}
                {post.poll && (() => {
                  const isClosed = post.poll.closes_at
                    ? new Date(post.poll.closes_at).getTime() <= Date.now()
                    : false;
                  return (
                    <Link
                      href={communityPostPath(post.id)}
                      className={`inline-flex items-center gap-2 max-w-full px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                        isClosed
                          ? "text-[var(--hb-text-muted)] bg-[var(--hb-surface-hover)] border-[var(--hb-hairline)] hover:bg-white"
                          : "text-[var(--hb-text-strong)] bg-[var(--hb-surface-page)] border-[#f0eeec] hover:border-[var(--hb-primary)] hover:bg-white"
                      }`}
                      title={post.poll.question}
                    >
                      <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[180px] sm:max-w-[220px]">
                        {post.poll.question}
                      </span>
                      <span className="shrink-0 text-[var(--hb-text-muted)]">·</span>
                      <span className="shrink-0 tabular-nums">
                        {post.poll.total_voters === null
                          ? "참여 후 공개"
                          : `${post.poll.total_voters.toLocaleString()}명`}
                      </span>
                      {isClosed && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#e5d8ca] text-[var(--hb-text-body)]">
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
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link
                href={weddingPath(
                  `/community?author_id=${post.author_id}&feed=all#community-feed`,
                )}
                className="shrink-0"
              >
                <Avatar
                  nickname={author.nickname}
                  avatarUrl={(author as { avatar_url?: string | null }).avatar_url ?? null}
                  role={author.role ?? null}
                  size={34}
                />
              </Link>
              <span className="text-sm text-[var(--hb-text-body)] truncate max-w-[140px] sm:max-w-none">
                {author.nickname}
              </span>
              <ContentOriginBadge origin={post.content_origin} />
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3 text-[var(--hb-text-body)] flex-shrink-0 ml-auto">
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
                  className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-all"
                  fill={isLiked ? "currentColor" : "none"}
                />
                {displayUpvoteCount > 0 && (
                  <span className="text-sm tabular-nums">
                    {displayUpvoteCount}
                  </span>
                )}
              </button>

              {/* 댓글 */}
              <Link
                href={communityPostPath(post.id, "comments")}
                className="flex items-center gap-1 hover:text-[var(--hb-text-strong)] group"
              >
                <MessageCircle className="w-5 h-5 opacity-60 group-hover:opacity-100" />
                <span className="text-sm">
                  {(post.comment_count ?? 0) > 0 ? `답변 ${post.comment_count}` : "첫 답변"}
                </span>
              </Link>

              <span className="flex items-center gap-1 text-[var(--hb-text-body)]">
                <Eye className="w-5 h-5 opacity-60" />
                <span className="text-sm">{post.view_count ?? 0}</span>
              </span>

              {/* 북마크 */}
              <button
                type="button"
                onClick={handleBookmark}
                disabled={bookmarking}
                className={`flex items-center group disabled:opacity-60 ${
                  bookmarked ? "text-[var(--hb-text-strong)]" : "hover:text-[var(--hb-text-strong)]"
                }`}
                aria-label="저장"
                title="저장"
              >
                <Bookmark
                  className="w-5 h-5 opacity-60 group-hover:opacity-100"
                  fill={bookmarked ? "#36534E" : "none"}
                />
              </button>

              {/* 공유 */}
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center hover:text-[var(--hb-text-strong)] group"
                aria-label="공유"
                title="공유"
              >
                <Share2 className="w-5 h-5 opacity-60 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>

        {/* 썸네일 (오른쪽) — 카드 게시물 > 첨부 이미지 > 본문 인라인 fallback */}
        {(hasImage || (hasSlides && isVideoSlide && !slideThumb)) && (
          <Link
            href={communityPostPath(post.id)}
            className="relative h-24 w-28 rounded-lg overflow-hidden shrink-0 bg-[#1A1A1F] sm:h-28 sm:w-28 xl:w-32 xl:h-32"
          >
            {thumbUrl ? (
              <Image
                src={thumbUrl}
                alt=""
                width={256}
                height={256}
                className="w-full h-full object-cover"
              />
            ) : firstSlide ? (
              <video
                src={firstSlide.url}
                preload="metadata"
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : null}

            {/* 카드 게시물 인디케이터 — 슬라이드 N장 / 영상 표시 */}
            {hasSlides && (
              <>
                <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/65 text-white text-[10px] font-medium backdrop-blur-sm">
                  <Layers className="w-3 h-3" />
                  {slides.length}
                </span>
                {isVideoSlide && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Play className="w-7 h-7 text-white/95 fill-white/95 drop-shadow" />
                  </span>
                )}
              </>
            )}
          </Link>
        )}
      </div>
    </article>
  );
}
