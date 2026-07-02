"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Bookmark,
  Share2,
  Flag,
  Lock,
  ImageIcon,
  X,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Heart,
  List,
  Eye,
  Wallet,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Pin,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { useCommunityStore } from "@/stores/communityStore";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import { sanitizeHtml } from "@/utils/sanitize";
import AiCommentBox from "@/components/community/AiCommentBox";
import CostShareDisplay from "@/components/community/CostShareDisplay";
import CommentSection from "@/components/community/CommentSection";
import ServiceCTA from "@/components/community/ServiceCTA";
import Avatar from "@/components/community/Avatar";
import AdDisclosureBadge from "@/components/community/AdDisclosureBadge";
import PollDisplay from "@/components/community/PollDisplay";
import SlideCarousel from "@/components/community/SlideCarousel";
import { useCommentsRealtime } from "@/hooks/useCommentsRealtime";
import { communityCategoryFeedPath, communityPostPath } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";
import type { PollWithOptions, PostWithAuthor } from "@/types/community.types";

// 비용 포맷 헬퍼 (PostCard와 동일)
function formatPrice(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}억`;
  }
  return value.toLocaleString("ko-KR");
}

// 신고 사유 옵션
const REPORT_REASONS = [
  { value: "spam", label: "스팸/도배" },
  { value: "abuse", label: "욕설/비하" },
  { value: "ad", label: "광고/홍보" },
  { value: "inappropriate", label: "부적절한 내용" },
  { value: "other", label: "기타" },
] as const;

function stripHtmlPreview(value: string, maxLength = 72) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getPostThumbnail(post: PostWithAuthor) {
  const firstSlide = post.slides?.[0];
  if (firstSlide) {
    return firstSlide.thumbnail_url || (firstSlide.type === "image" ? firstSlide.url : null);
  }
  if (post.images?.[0]) return post.images[0];
  const match = post.content.match(/<img\s+[^>]*src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const {
    currentPost: post,
    postLoading,
    fetchPostDetail,
    incrementView,
    votePost,
    toggleBookmark,
    deletePost,
  } = useCommunityStore();

  // 댓글 리얼타임 구독
  useCommentsRealtime(postId);

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 신고 모달 상태
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportError, setReportError] = useState("");

  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 로그인 필요 알림
  const [loginToast, setLoginToast] = useState(false);

  // 낙관적 투표 UI (PostCard 패턴)
  const [optimisticVote, setOptimisticVote] = useState<1 | null | undefined>(undefined);
  const [optimisticDelta, setOptimisticDelta] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [relatedPosts, setRelatedPosts] = useState<PostWithAuthor[]>([]);
  const [popularPosts, setPopularPosts] = useState<PostWithAuthor[]>([]);

  // 유저 상태 확인
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id } : null);
    });
  }, []);

  // 글 불러오기 + 조회수 증가
  useEffect(() => {
    if (postId) {
      fetchPostDetail(postId);
      incrementView(postId);
    }
  }, [postId, fetchPostDetail, incrementView]);

  useEffect(() => {
    if (!post?.id || !post.category) return;

    let cancelled = false;
    const currentPostId = post.id;
    const currentCategory = post.category;

    async function loadRelatedPosts() {
      try {
        const [sameCategoryRes, popularRes] = await Promise.all([
          fetch(`/api/community/posts?category=${encodeURIComponent(currentCategory)}&sort=hot&period=all&limit=10`),
          fetch("/api/community/posts?sort=hot&period=all&limit=10"),
        ]);

        const sameCategoryData = sameCategoryRes.ok
          ? ((await sameCategoryRes.json()) as { posts?: PostWithAuthor[] })
          : { posts: [] };
        const popularData = popularRes.ok
          ? ((await popularRes.json()) as { posts?: PostWithAuthor[] })
          : { posts: [] };

        const sameCategory = Array.from(
          new Map(
            (sameCategoryData.posts ?? [])
              .filter((item) => item.id !== currentPostId)
              .map((item) => [item.id, item])
          ).values()
        ).slice(0, 5);

        const sameIds = new Set(sameCategory.map((item) => item.id));
        const popular = Array.from(
          new Map(
            (popularData.posts ?? [])
              .filter((item) => item.id !== currentPostId && !sameIds.has(item.id))
              .map((item) => [item.id, item])
          ).values()
        ).slice(0, 5);

        if (!cancelled) {
          setRelatedPosts(sameCategory);
          setPopularPosts(popular.length > 0 ? popular : sameCategory.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setRelatedPosts([]);
          setPopularPosts([]);
        }
      }
    }

    void loadRelatedPosts();

    return () => {
      cancelled = true;
    };
  }, [post?.category, post?.id]);

  // 공유 기능
  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: post?.title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      });
    }
  }

  // 신고 모달 열기
  function handleReportClick() {
    if (!user) {
      setLoginToast(true);
      setTimeout(() => setLoginToast(false), 2000);
      return;
    }
    setShowReportModal(true);
    setReportReason("");
    setReportDescription("");
    setReportSubmitted(false);
  }

  // 신고 제출
  async function handleReportSubmit() {
    if (!reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    setReportError("");
    try {
      const res = await fetch(`/api/community/posts/${postId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reportReason,
          details: reportDescription || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data.error || "신고에 실패했습니다.");
        setReportSubmitting(false);
        return;
      }
      setReportSubmitted(true);
      setTimeout(() => {
        setShowReportModal(false);
        setReportSubmitted(false);
      }, 1500);
    } catch {
      setReportError("네트워크 오류가 발생했습니다.");
    } finally {
      setReportSubmitting(false);
    }
  }

  // 삭제 처리
  async function handleDelete() {
    if (!post || deleting) return;
    setDeleting(true);
    const ok = await deletePost(post.id);
    setDeleting(false);
    if (ok) {
      setShowDeleteModal(false);
      router.push(weddingPath());
    }
  }

  // 라이트박스 네비게이션
  function handleLightboxPrev(e: React.MouseEvent) {
    e.stopPropagation();
    if (lightboxIndex !== null && post?.images) {
      setLightboxIndex(
        lightboxIndex === 0 ? post.images.length - 1 : lightboxIndex - 1
      );
    }
  }

  function handleLightboxNext(e: React.MouseEvent) {
    e.stopPropagation();
    if (lightboxIndex !== null && post?.images) {
      setLightboxIndex(
        lightboxIndex === post.images.length - 1 ? 0 : lightboxIndex + 1
      );
    }
  }

  // 좋아요 핸들러
  const handleVote = useCallback(
    async () => {
      if (!user) {
        setLoginToast(true);
        setTimeout(() => setLoginToast(false), 2000);
        return;
      }
      if (isVoting || !post) return;

      const prevVote = post.user_vote === 1 ? 1 : null;
      const newVote: 1 | null = prevVote === 1 ? null : 1;
      const delta = prevVote === 1 ? -1 : 1;

      setOptimisticVote(newVote);
      setOptimisticDelta(delta);
      setIsVoting(true);

      try {
        await votePost(post.id, newVote === null ? 0 : 1);
      } catch {
        setOptimisticVote(undefined);
        setOptimisticDelta(0);
      } finally {
        setIsVoting(false);
      }
    },
    [user, isVoting, post, votePost]
  );

  // 로딩
  if (postLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8]">
        <div className="mx-auto max-w-4xl xl:max-w-5xl px-4 sm:px-6 lg:px-8 py-5">
          <div className="bg-white rounded-2xl shadow-sm border border-[#F0EFED] p-4">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-24 bg-[#F0EFED] rounded-lg" />
              <div className="h-7 w-3/4 bg-[#F0EFED] rounded-lg" />
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-[#F0EFED] rounded-full" />
                <div className="h-3 w-32 bg-[#F0EFED] rounded-lg" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-[#F0EFED] rounded-lg" />
                <div className="h-4 w-full bg-[#F0EFED] rounded-lg" />
                <div className="h-4 w-2/3 bg-[#F0EFED] rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 글 없음
  if (!post) {
    return (
      <div className="min-h-screen bg-[#FAFAF8]">
        <div className="mx-auto max-w-4xl xl:max-w-5xl px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-[#F0EFED] p-8">
            <ImageIcon className="w-10 h-10 mx-auto mb-3 text-[#878680]" />
            <p className="text-[#1A1A1F] font-medium">
              게시글을 찾을 수 없습니다
            </p>
            <p className="mt-1 text-sm text-[#878680]">
              삭제되었거나 존재하지 않는 글입니다.
            </p>
            <Link
              href={weddingPath()}
              className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-[#36534E] hover:bg-[#2B423E] rounded-lg transition-all duration-200"
            >
              커뮤니티로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 멤버전용 & 비로그인
  const isMembersOnly = post.visibility === "members" && !user;
  const categoryInfo = CATEGORY_MAP[post.category];
  const isAuthor = user && user.id === post.author_id;

  // 좋아요 표시값 (낙관적 UI)
  const displayVote = optimisticVote !== undefined ? optimisticVote : (post.user_vote === 1 ? 1 : null);
  const voteCount = Math.max(0, post.upvote_count + optimisticDelta);
  const isLiked = displayVote === 1;

  // 작성자 정보 (PostCard 패턴)
  const author = post.author ?? { nickname: "익명", avatar_url: null, wedding_year: null, wedding_month: null };

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="mx-auto w-full max-w-[1380px] px-4 sm:px-6 lg:px-8 py-5">
        {/* 브레드크럼 네비게이션 */}
        <nav className="flex items-center gap-1 text-sm text-[#B5ADA3] mb-3 overflow-hidden">
          <Link
            href={weddingPath()}
            className="shrink-0 hover:text-[#36534E] transition-colors"
          >
            커뮤니티
          </Link>
          {categoryInfo && (
            <>
              <span className="shrink-0 text-[#B5ADA3]">/</span>
              <Link
                href={communityCategoryFeedPath(post.category)}
                className="shrink-0 hover:text-[#36534E] transition-colors"
              >
                {categoryInfo.label}
              </Link>
            </>
          )}
          <span className="shrink-0 text-[#B5ADA3]">/</span>
          <span className="truncate text-[#1A1A1F]">{post.title}</span>
        </nav>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,720px)_300px] xl:grid-cols-[270px_minmax(0,720px)_300px] lg:items-start lg:justify-center">
          <SimilarPostsRail posts={relatedPosts.length > 0 ? relatedPosts : popularPosts} />
          <main className="min-w-0">
        {/* 메인 포스트 카드 */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#F0EFED] overflow-hidden">
          <div className="flex">
            {/* 콘텐츠 영역 */}
            <div className="flex-1 min-w-0 p-4 sm:p-5">
              {/* 작성자 행: 아바타 + 닉네임 + 시간 + 카테고리 */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-4">
                {/* 아바타 */}
                <Link
                  href={weddingPath(`/community?author_id=${post.author_id}`)}
                  className="shrink-0"
                >
                  <Avatar
                    nickname={author.nickname}
                    avatarUrl={author.avatar_url}
                    role={author.role ?? null}
                    size={36}
                    className="ring-2 ring-white shadow-sm"
                  />
                </Link>

                {/* 닉네임 */}
                <Link
                  href={weddingPath(`/community?author_id=${post.author_id}`)}
                  className="text-[15px] font-medium text-[#1A1A1F] hover:text-[#36534E] transition-colors duration-200 whitespace-nowrap"
                >
                  {author.nickname}
                </Link>

                {/* 결혼 동기 */}
                {author.wedding_year && author.wedding_month && (
                  <>
                    <span className="text-[#B5ADA3] text-[13px] hidden sm:inline">&middot;</span>
                    <span className="text-[13px] text-[#878680] whitespace-nowrap">
                      {String(author.wedding_year).slice(2)}.{String(author.wedding_month).padStart(2, "0")} 동기
                    </span>
                  </>
                )}

                {/* 시간 */}
                <span className="text-[#B5ADA3] text-[13px] hidden sm:inline">&middot;</span>
                <span className="text-[13px] text-[#B5ADA3] whitespace-nowrap">{timeAgo(post.created_at)}</span>

                {/* 카테고리 */}
                {categoryInfo && (
                  <>
                    <span className="text-[#B5ADA3] text-[13px] hidden sm:inline">&middot;</span>
                    <Link
                      href={communityCategoryFeedPath(post.category)}
                      className="text-[13px] font-medium text-[#36534E] hover:text-[#9A6B62] transition-colors duration-200 whitespace-nowrap"
                    >
                      {categoryInfo.label}
                    </Link>
                  </>
                )}

                {/* 광고 표시 배지 — 색맹 친화: 색 + 아이콘 */}
                {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
                  <span className="ml-1 inline-block">
                    <AdDisclosureBadge adDisclosure={post.ad_disclosure} size="sm" />
                  </span>
                )}
                {post.is_verified_review && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[#B89785] text-xs font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    인증후기
                  </span>
                )}
                {post.under_review && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[#B91C1C] text-xs font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    검토 중
                  </span>
                )}
              </div>

              {/* 제목 */}
              <h1 className="text-[23px] sm:text-[26px] font-medium text-[#1A1A1F] leading-snug mb-3">
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-[#36534E] mr-2 text-sm font-medium align-middle">
                    <Pin className="w-4 h-4" />
                    PIN
                  </span>
                )}
                {post.is_weekly_best && (
                  <span className="text-[#B89785] text-sm font-medium mr-2 align-middle">
                    BEST
                  </span>
                )}
                {post.is_resolved && (
                  <span className="inline-flex items-center gap-1 text-[#22C55E] mr-2 text-sm font-medium align-middle">
                    <CheckCircle2 className="w-4 h-4" />
                    해결됨
                  </span>
                )}
                {post.ai_comment && (
                  <span className="inline-flex items-center gap-1 text-[#36534E] mr-2 text-sm font-medium align-middle">
                    <Sparkles className="w-4 h-4" />
                    AI 분석
                  </span>
                )}
                {post.title}
              </h1>

              {/* 카드 게시물 슬라이드 — 본문 위에 인스타 캐러셀로 렌더 */}
              {!isMembersOnly && Array.isArray(post.slides) && post.slides.length > 0 && (
                <div className="mb-4">
                  <SlideCarousel
                    slides={post.slides}
                    aspect="4/5"
                    className="mx-auto w-full max-w-[420px] sm:max-w-[500px] lg:max-w-[560px]"
                  />
                </div>
              )}

              {/* 본문 */}
              <div className="relative">
                {isMembersOnly ? (
                  <>
                    {/* 블러 처리된 미리보기 */}
                    <div
                      className="ugc-text text-base text-[#1A1A1F] leading-relaxed whitespace-pre-wrap blur-sm select-none pointer-events-none max-h-40 overflow-hidden"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(post.content.slice(0, 300)),
                      }}
                    />
                    {/* 로그인 유도 오버레이 */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-white via-white/90 to-transparent">
                      <Lock className="w-8 h-8 text-[#878680] mb-2" />
                      <p className="text-base font-medium text-[#1A1A1F] mb-1">
                        회원 전용 게시글입니다
                      </p>
                      <p className="text-sm text-[#878680] mb-3">
                        로그인하면 전체 내용을 볼 수 있어요
                      </p>
                      <Link
                        href="/login"
                        className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-[#36534E] hover:bg-[#2B423E] rounded-lg transition-all duration-200"
                      >
                        로그인하기
                      </Link>
                    </div>
                  </>
                ) : (
                  <div
                    className="community-post-content ugc-text text-[15px] text-[#1A1A1F] leading-[1.75] whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(post.content),
                    }}
                  />
                )}
              </div>

              {/* 이미지 갤러리 — 카드 게시물(슬라이드)이면 위 캐러셀이 담당하므로 숨김 */}
              {!isMembersOnly && (!post.slides || post.slides.length === 0) && post.images && post.images.length > 0 && (
                <div className="mx-auto mt-4 max-w-[560px]">
                  <div
                    className={`grid gap-2 ${
                      post.images.length === 1
                        ? "grid-cols-1"
                        : post.images.length === 2
                        ? "grid-cols-2"
                        : post.images.length === 3
                        ? "grid-cols-2 sm:grid-cols-3"
                        : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                    }`}
                  >
                    {post.images.map((src, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => !(/\.(mp4|mov|webm)(\?|$)/i.test(src)) && setLightboxIndex(idx)}
                        className={`relative overflow-hidden rounded-xl bg-[#FAFAF8] hover:opacity-90 transition-all duration-200 ${
                          post.images!.length === 1
                            ? "h-[200px] sm:h-[260px]"
                            : "h-[108px] sm:h-[136px]"
                        }`}
                      >
                        {/\.(mp4|mov|webm)(\?|$)/i.test(src) ? (
                          <video
                            src={src}
                            controls
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Image
                            src={src}
                            alt={`이미지 ${idx + 1}`}
                            fill
                            className={post.images!.length === 1 ? "object-contain" : "object-cover"}
                          />
                        )}
                        {/* 4장 이상이고 마지막 보이는 셀일 때 오버레이 */}
                        {post.images!.length > 6 && idx === 5 && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="text-white text-lg font-bold">
                              +{post.images!.length - 6}
                            </span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 아모라 AI 가격 코멘트 (출처 기반 시세 비교, AI 표기) */}
              {!isMembersOnly && post.ai_comment && (
                <div className="mt-5">
                  <AiCommentBox aiComment={post.ai_comment} />
                </div>
              )}

              {/* 라이트박스 */}
              {lightboxIndex !== null && post.images && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                  onClick={() => setLightboxIndex(null)}
                >
                  {/* 닫기 버튼 */}
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(null)}
                    className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  {/* 이전 버튼 */}
                  {post.images.length > 1 && (
                    <button
                      type="button"
                      onClick={handleLightboxPrev}
                      className="absolute left-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}

                  {/* 이미지 */}
                  <Image
                    src={post.images[lightboxIndex]}
                    alt=""
                    width={1200}
                    height={900}
                    className="max-w-full max-h-[90vh] object-contain rounded-2xl"
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* 다음 버튼 */}
                  {post.images.length > 1 && (
                    <button
                      type="button"
                      onClick={handleLightboxNext}
                      className="absolute right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                    >
                      <ChevronRightIcon className="w-5 h-5" />
                    </button>
                  )}

                  {/* 인디케이터 */}
                  {post.images.length > 1 && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                      {post.images.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxIndex(idx);
                          }}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            idx === lightboxIndex
                              ? "bg-white"
                              : "bg-white/40"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 폴(투표/설문) */}
              {!isMembersOnly && post.poll && (
                <PollDisplay
                  poll={
                    {
                      ...post.poll,
                      user_voted_option_ids: post.poll.user_voted_option_ids ?? [],
                    } as PollWithOptions
                  }
                  isAuthenticated={!!user}
                  onLoginRequired={() => {
                    setLoginToast(true);
                    setTimeout(() => setLoginToast(false), 2000);
                  }}
                />
              )}

              {/* 비용 요약 바 + 상세 비용 데이터 */}
              {!isMembersOnly && post.cost_data && (
                <div className="mt-4 space-y-3">
                  {/* 인라인 가격 요약 바 (PostCard 패턴) */}
                  <div className="bg-[#FDFCFA] rounded-xl px-4 py-3 border border-[#F5F2ED] flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[12px] text-[#B5ADA3] leading-none mb-0.5">총 비용</p>
                      <p className="text-base font-semibold text-[#1A1A1F]">{formatPrice(post.cost_data.totalCost)}만원</p>
                    </div>
                    {post.cost_data.region && (
                      <div className="ml-4">
                        <p className="text-[12px] text-[#B5ADA3] leading-none mb-0.5">지역</p>
                        <p className="text-sm font-medium text-[#1A1A1F]">{post.cost_data.region}</p>
                      </div>
                    )}
                    {post.cost_data.guestCount && (
                      <div className="ml-4">
                        <p className="text-[12px] text-[#B5ADA3] leading-none mb-0.5">하객</p>
                        <p className="text-sm font-medium text-[#1A1A1F]">{post.cost_data.guestCount}명</p>
                      </div>
                    )}
                  </div>
                  {/* 상세 비용 표시 */}
                  <CostShareDisplay data={post.cost_data} />
                </div>
              )}

              {/* 태그 */}
              {!isMembersOnly && post.tags && post.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={communityCategoryFeedPath(post.category, tag)}
                      className="px-3 py-1.5 text-sm text-[#878680] bg-[#FAFAF8] rounded-lg hover:bg-[#F0EFED] transition-all duration-200"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}

              {/* 벤더 태그 */}
              {!isMembersOnly &&
                post.vendor_details &&
                post.vendor_details.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.vendor_details.map((vendor) => (
                      <Link
                        key={vendor.id}
                        href={weddingPath(`/vendors/${vendor.id}`)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-lg hover:border-[#B5ADA3] transition-all duration-200"
                      >
                        {vendor.thumbnail_url && (
                          <Image
                            src={vendor.thumbnail_url}
                            alt=""
                            width={16}
                            height={16}
                            className="w-4 h-4 rounded-full object-cover"
                          />
                        )}
                        {vendor.business_name}
                        {vendor.rating != null && (
                          <span className="text-[#878680]">
                            {vendor.rating.toFixed(1)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}

              {/* 액션바 — 모바일: wrap 허용 / 데스크탑: 한 줄 */}
              <div className="mt-5 pt-4 border-t border-[#F0EFED] flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-2 text-[14px] sm:text-[15px] text-[#B5ADA3]">
                <button
                  type="button"
                  onClick={handleVote}
                  disabled={isVoting}
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg transition-all duration-200 whitespace-nowrap ${
                    isLiked ? "bg-[#f6efe5] text-[#36534E]" : "hover:bg-[#FAFAF8]"
                  } disabled:opacity-50`}
                  aria-label="좋아요"
                >
                  <Heart className={`w-4 h-4 ${isLiked ? "fill-current" : ""}`} />
                  좋아요 {voteCount > 0 ? voteCount : ""}
                </button>

                {/* 댓글 수 */}
                <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg cursor-default whitespace-nowrap">
                  {post.comment_count ?? 0} 댓글
                </span>

                {/* 조회수 */}
                <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 whitespace-nowrap">
                  <Eye className="w-4 h-4" />
                  <span>{post.view_count}</span>
                </span>

                {/* 공유 */}
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 whitespace-nowrap"
                >
                  <Share2 className="w-4 h-4" />
                  공유
                </button>

                {/* 북마크 */}
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      setLoginToast(true);
                      setTimeout(() => setLoginToast(false), 2000);
                      return;
                    }
                    toggleBookmark(post.id);
                  }}
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 whitespace-nowrap ${
                    post.user_bookmarked ? "text-[#36534E]" : ""
                  }`}
                >
                  <Bookmark
                    className={`w-4 h-4 ${
                      post.user_bookmarked ? "fill-current" : ""
                    }`}
                  />
                  저장
                </button>

                {/* 신고 */}
                <button
                  type="button"
                  onClick={handleReportClick}
                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 whitespace-nowrap"
                >
                  <Flag className="w-4 h-4" />
                  신고
                </button>

                {/* 수정/삭제 (작성자만) */}
                {isAuthor && (
                  <>
                    <Link
                      href={weddingPath(`/community/post/write?edit=${post.id}`)}
                      className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] text-[#635b51] transition-all duration-200 ml-auto whitespace-nowrap"
                    >
                      수정
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-all duration-200 whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 서비스 CTA (게시글과 댓글 사이) */}
        {!isMembersOnly && (
          <div className="mt-3">
            <ServiceCTA
              category={post.category}
              postId={post.id}
              postTitle={post.title}
              postContent={isMembersOnly ? undefined : post.content}
              priceData={isMembersOnly ? undefined : post.price_data}
            />
          </div>
        )}

        {/* 목록으로 버튼 */}
        <div className="mt-3 flex">
          <Link
            href={categoryInfo ? communityCategoryFeedPath(post.category) : weddingPath()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-[#B5ADA3] hover:text-[#36534E] transition-all duration-200"
          >
            <List className="w-4 h-4" />
            목록으로
          </Link>
        </div>

        {/* 토스트: 링크 복사 */}
        {shareToast && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#1A1A1F] text-white text-sm rounded-lg shadow-lg animate-fade-in">
            링크가 복사되었습니다
          </div>
        )}

        {/* 토스트: 로그인 필요 */}
        {loginToast && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#1A1A1F] text-white text-sm rounded-lg shadow-lg animate-fade-in">
            로그인이 필요합니다
          </div>
        )}

        {/* 신고 모달 */}
        {showReportModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowReportModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {reportSubmitted ? (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#FAFAF8] flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-[#36534E]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <p className="text-base font-medium text-[#1A1A1F]">
                    신고가 접수되었습니다
                  </p>
                  <p className="mt-1 text-sm text-[#878680]">
                    검토 후 조치하겠습니다. 감사합니다.
                  </p>
                </div>
              ) : (
                <>
                  {/* 헤더 */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0EFED]">
                    <h3 className="text-base font-medium text-[#1A1A1F]">
                      게시글 신고
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowReportModal(false)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#FAFAF8] text-[#878680] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 본문 */}
                  <div className="px-5 py-4">
                    <p className="text-sm text-[#878680] mb-4">
                      신고 사유를 선택해 주세요.
                    </p>

                    {/* 사유 선택 */}
                    <div className="space-y-2">
                      {REPORT_REASONS.map((reason) => (
                        <label
                          key={reason.value}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                            reportReason === reason.value
                              ? "border-[#36534E] bg-[#36534E]/5"
                              : "border-[#F0EFED] hover:bg-[#FAFAF8]"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              reportReason === reason.value
                                ? "border-[#36534E]"
                                : "border-[#B5ADA3]"
                            }`}
                          >
                            {reportReason === reason.value && (
                              <div className="w-2 h-2 rounded-full bg-[#36534E]" />
                            )}
                          </div>
                          <span className="text-sm text-[#1A1A1F]">
                            {reason.label}
                          </span>
                          <input
                            type="radio"
                            name="reportReason"
                            value={reason.value}
                            checked={reportReason === reason.value}
                            onChange={(e) => setReportReason(e.target.value)}
                            className="sr-only"
                          />
                        </label>
                      ))}
                    </div>

                    {/* 추가 설명 */}
                    <textarea
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      placeholder="추가 설명 (선택)"
                      rows={3}
                      maxLength={500}
                      className="mt-4 w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#36534E] focus:shadow-[0_0_0_2px_rgba(54,83,78,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                    />
                  </div>

                  {/* 에러 메시지 */}
                  {reportError && (
                    <div className="mx-5 mb-2 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg">
                      {reportError}
                    </div>
                  )}

                  {/* 푸터 */}
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#F0EFED] bg-[#FAFAF8]">
                    <button
                      type="button"
                      onClick={() => setShowReportModal(false)}
                      className="px-4 py-2 text-sm font-medium text-[#878680] hover:text-[#1A1A1F] rounded-lg hover:bg-[#F0EFED] transition-all duration-200"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleReportSubmit}
                      disabled={!reportReason || reportSubmitting}
                      className="px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {reportSubmitting ? "처리 중..." : "신고하기"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 삭제 확인 모달 */}
        {showDeleteModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowDeleteModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                  <Flag className="w-5 h-5 text-red-500" />
                </div>
                <h3 className="text-base font-medium text-[#1A1A1F]">
                  게시글을 삭제하시겠습니까?
                </h3>
                <p className="mt-1 text-sm text-[#878680]">
                  삭제된 글은 복구할 수 없습니다.
                </p>
              </div>
              <div className="flex border-t border-[#F0EFED]">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 px-4 py-3 text-sm font-medium text-[#878680] hover:bg-[#FAFAF8] transition-all duration-200"
                >
                  취소
                </button>
                <div className="w-px bg-[#F0EFED]" />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 transition-all duration-200 disabled:opacity-40"
                >
                  {deleting ? "삭제 중..." : "삭제"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 댓글 섹션 */}
        {!isMembersOnly && (
          <div className="mt-3 bg-white rounded-2xl shadow-sm border border-[#F0EFED] p-4">
            <CommentSection postId={post.id} />
          </div>
        )}
          </main>

          <RelatedPostsSidebar posts={popularPosts.length > 0 ? popularPosts : relatedPosts} />
        </div>
      </div>
    </div>
  );
}

function SimilarPostsRail({ posts }: { posts: PostWithAuthor[] }) {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 rounded-2xl border border-[#eadfc9] bg-white p-4 shadow-sm">
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-[#9d6f36]">연관 글</p>
          <h2 className="font-serif-kr text-[18px] font-medium text-[#071629]">
            비슷한 글
          </h2>
        </div>

        {posts.length > 0 ? (
          <div className="grid gap-3">
            {posts.slice(0, 3).map((item) => {
              const itemCategory = CATEGORY_MAP[item.category];
              const thumb = getPostThumbnail(item);
              return (
                <Link
                  key={item.id}
                  href={communityPostPath(item.id)}
                  className="group block overflow-hidden rounded-xl border border-[#efe4d3] bg-[#fffdf7] transition-colors hover:border-[#36534E]/40 hover:bg-white"
                >
                  {thumb && (
                    <div className="relative aspect-[16/10] w-full bg-[#f8f4ec]">
                      <Image
                        src={thumb}
                        alt=""
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        sizes="270px"
                      />
                    </div>
                  )}
                  <div className="px-3 py-3">
                    <div className="mb-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[#7a8290]">
                      <span className="shrink-0 rounded bg-[#f6ead9] px-1.5 py-0.5 text-[#9d6f36]">
                        {itemCategory?.shortLabel ?? "글"}
                      </span>
                      <span className="truncate">{timeAgo(item.created_at)}</span>
                    </div>
                    <h3 className="line-clamp-4 break-words text-[14px] font-semibold leading-[1.55] text-[#071629]">
                      {item.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-[1.5] text-[#7a8290]">
                      {stripHtmlPreview(item.content, 90)}
                    </p>
                    <p className="mt-2 text-[11px] font-medium text-[#7a8290]">
                      조회 {item.view_count ?? 0} · 댓글 {item.comment_count ?? 0}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-[#fffdf7] px-3 py-4 text-[13px] font-medium leading-relaxed text-[#7a8290]">
            비슷한 글을 준비 중이에요.
          </p>
        )}
      </div>
    </aside>
  );
}

function RelatedPostsSidebar({ posts }: { posts: PostWithAuthor[] }) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 space-y-4">
        <section className="rounded-2xl border border-[#eadfc9] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-serif-kr text-[20px] font-medium text-[#071629]">
                많이 본 글
              </h2>
              <p className="mt-0.5 text-[12px] font-medium text-[#7a8290]">
                이 글을 본 사람들이 이어서 읽는 글
              </p>
            </div>
            <Link
              href={weddingPath()}
              className="text-[12px] font-semibold text-[#36534E]"
            >
              더보기
            </Link>
          </div>

          {posts.length > 0 ? (
            <div className="divide-y divide-[#eadfc9]">
              {posts.map((item) => {
                const thumb = getPostThumbnail(item);
                const itemCategory = CATEGORY_MAP[item.category];
                return (
                  <Link
                    key={item.id}
                    href={communityPostPath(item.id)}
                    className={`grid gap-3 py-3 first:pt-0 last:pb-0 ${
                      thumb ? "grid-cols-[58px_minmax(0,1fr)]" : "grid-cols-1"
                    }`}
                  >
                    {thumb && (
                      <div className="relative h-[58px] w-[58px] overflow-hidden rounded-xl bg-[#f8f4ec]">
                        <Image
                          src={thumb}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="58px"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-[#7a8290]">
                        <span className="shrink-0 rounded bg-[#f6ead9] px-1.5 py-0.5 text-[#9d6f36]">
                          {itemCategory?.shortLabel ?? "커뮤니티"}
                        </span>
                        <span className="truncate">{timeAgo(item.created_at)}</span>
                      </div>
                      <h3 className="line-clamp-2 break-words text-[13px] font-semibold leading-[1.45] text-[#071629]">
                        {item.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-[11px] font-medium text-[#7a8290]">
                        {stripHtmlPreview(item.content)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] font-medium text-[#7a8290]">
                        <span>좋아요 {item.upvote_count ?? 0}</span>
                        <span>댓글 {item.comment_count ?? 0}</span>
                        <span>조회 {item.view_count ?? 0}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl bg-[#fffdf7] px-3 py-4 text-[13px] font-medium leading-relaxed text-[#7a8290]">
              곧 비슷한 글을 더 보여드릴게요.
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
