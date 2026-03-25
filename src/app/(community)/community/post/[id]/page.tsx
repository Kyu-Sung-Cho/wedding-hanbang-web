"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Bookmark,
  Share2,
  Flag,
  Lock,
  ImageIcon,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { useCommunityStore } from "@/stores/communityStore";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import { sanitizeHtml } from "@/utils/sanitize";
import VoteButtons from "@/components/community/VoteButtons";
import CostShareDisplay from "@/components/community/CostShareDisplay";
import CommentSection from "@/components/community/CommentSection";
import type { BadgeType } from "@/types/community.types";

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
  } = useCommunityStore();

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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

  // 신고
  function handleReport() {
    if (!user) {
      alert("로그인이 필요합니다.");
      return;
    }
    // 추후 신고 모달 구현
    alert("신고가 접수되었습니다.");
  }

  // 로딩
  if (postLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-24 bg-[#F5F2ED] rounded" />
          <div className="h-8 w-3/4 bg-[#F5F2ED] rounded" />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#F5F2ED] rounded-full" />
            <div className="space-y-1.5">
              <div className="h-4 w-20 bg-[#F5F2ED] rounded" />
              <div className="h-3 w-16 bg-[#F5F2ED] rounded" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-[#F5F2ED] rounded" />
            <div className="h-4 w-full bg-[#F5F2ED] rounded" />
            <div className="h-4 w-2/3 bg-[#F5F2ED] rounded" />
          </div>
        </div>
      </div>
    );
  }

  // 글 없음
  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F5F2ED] flex items-center justify-center mb-4 text-[#B5ADA3]">
          <ImageIcon className="w-7 h-7" />
        </div>
        <p className="text-[#1A1A1F] font-medium">
          게시글을 찾을 수 없습니다
        </p>
        <p className="mt-1.5 text-sm text-[#928980]">
          삭제되었거나 존재하지 않는 글입니다.
        </p>
        <Link
          href="/community"
          className="mt-5 inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-xl transition-colors"
        >
          커뮤니티로 돌아가기
        </Link>
      </div>
    );
  }

  // 멤버전용 & 비로그인
  const isMembersOnly = post.visibility === "members" && !user;
  const categoryInfo = CATEGORY_MAP[post.category];
  const voteCount = post.upvote_count - post.downvote_count;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex gap-6">
        {/* 데스크탑 투표 버튼 (좌측) */}
        <div className="hidden md:flex flex-col items-center pt-20 shrink-0">
          <div className="sticky top-24">
            <VoteButtons
              count={voteCount}
              userVote={post.user_vote ?? null}
              onVote={(v) => votePost(post.id, post.user_vote === v ? 0 : v)}
              isLoggedIn={!!user}
            />
          </div>
        </div>

        {/* 메인 콘텐츠 */}
        <div className="flex-1 min-w-0">
          {/* 뒤로가기 */}
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-[#928980] hover:text-[#1A1A1F] transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            커뮤니티
          </button>

          {/* 카테고리 배지 */}
          {categoryInfo && (
            <Link
              href={`/community/${post.category}`}
              className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg ${categoryInfo.bgColor} ${categoryInfo.color} mb-3`}
            >
              {categoryInfo.label}
            </Link>
          )}

          {/* 제목 */}
          <h1 className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-2xl sm:text-3xl font-medium text-[#1A1A1F] leading-tight">
            {post.title}
          </h1>

          {/* 작성자 정보 */}
          <div className="mt-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#F5F2ED] overflow-hidden flex items-center justify-center text-[#928980] shrink-0">
              {post.author.avatar_url ? (
                <Image
                  src={post.author.avatar_url}
                  alt=""
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-medium">
                  {post.author.nickname.charAt(0)}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#1A1A1F]">
                  {post.author.nickname}
                </span>
                {badgeLabel(post.author.badge) && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#C4967E]/10 text-[#C4967E] rounded">
                    {badgeLabel(post.author.badge)}
                  </span>
                )}
              </div>
              <span className="text-xs text-[#B5ADA3]">
                {timeAgo(post.created_at)}
              </span>
            </div>
          </div>

          {/* 본문 */}
          <div className="relative mt-6">
            {isMembersOnly ? (
              <>
                {/* 블러 처리된 미리보기 */}
                <div
                  className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap blur-sm select-none pointer-events-none max-h-40 overflow-hidden"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(post.content.slice(0, 300)),
                  }}
                />
                {/* 로그인 유도 오버레이 */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-[#FAF8F5] via-[#FAF8F5]/90 to-transparent">
                  <div className="w-12 h-12 rounded-2xl bg-[#F5F2ED] flex items-center justify-center mb-3 text-[#B5ADA3]">
                    <Lock className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-[#1A1A1F] mb-1">
                    회원 전용 게시글입니다
                  </p>
                  <p className="text-xs text-[#928980] mb-4">
                    로그인하면 전체 내용을 볼 수 있어요
                  </p>
                  <Link
                    href="/login"
                    className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-xl transition-colors"
                  >
                    로그인하기
                  </Link>
                </div>
              </>
            ) : (
              <div
                className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words prose-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content) }}
              />
            )}
          </div>

          {/* 이미지 갤러리 */}
          {!isMembersOnly && post.images && post.images.length > 0 && (
            <div className="mt-6">
              <div
                className={`grid gap-2 ${
                  post.images.length === 1
                    ? "grid-cols-1"
                    : post.images.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-2 sm:grid-cols-3"
                }`}
              >
                {post.images.map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    className="relative aspect-square rounded-xl overflow-hidden bg-[#F5F2ED] hover:opacity-90 transition-opacity"
                  >
                    <Image
                      src={src}
                      alt={`이미지 ${idx + 1}`}
                      fill
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 라이트박스 */}
          {lightboxIndex !== null && post.images && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              onClick={() => setLightboxIndex(null)}
            >
              <Image
                src={post.images[lightboxIndex]}
                alt=""
                width={1200}
                height={900}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* 비용 공유 데이터 */}
          {!isMembersOnly &&
            post.category === "cost_share" &&
            post.cost_data && (
              <div className="mt-6">
                <CostShareDisplay data={post.cost_data} />
              </div>
            )}

          {/* 태그 */}
          {!isMembersOnly && post.tags && post.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/community?tag=${encodeURIComponent(tag)}`}
                  className="px-3 py-1 text-xs font-medium text-[#928980] bg-[#FAF8F5] rounded-full hover:text-[#C4967E] hover:bg-[#C4967E]/10 transition-colors"
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
              <div className="mt-4 flex flex-wrap gap-2">
                {post.vendor_details.map((vendor) => (
                  <Link
                    key={vendor.id}
                    href={`/vendors/${vendor.id}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#1A1A1F] bg-white border border-[#F5F2ED] rounded-xl hover:border-[#C4967E] transition-colors"
                  >
                    {vendor.thumbnail_url && (
                      <Image
                        src={vendor.thumbnail_url}
                        alt=""
                        width={20}
                        height={20}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    )}
                    {vendor.business_name}
                    {vendor.rating != null && (
                      <span className="text-[#C9A96E]">
                        {vendor.rating.toFixed(1)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}

          {/* 액션바 */}
          <div className="mt-6 pt-4 border-t border-[#F5F2ED] flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 모바일 투표 */}
              <div className="md:hidden">
                <VoteButtons
                  count={voteCount}
                  userVote={post.user_vote ?? null}
                  onVote={(v) =>
                    votePost(post.id, post.user_vote === v ? 0 : v)
                  }
                  compact
                  isLoggedIn={!!user}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* 북마크 */}
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    alert("로그인이 필요합니다.");
                    return;
                  }
                  toggleBookmark(post.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl transition-colors ${
                  post.user_bookmarked
                    ? "text-[#C9A96E] bg-[#C9A96E]/10"
                    : "text-[#928980] bg-[#FAF8F5] hover:text-[#C9A96E]"
                }`}
              >
                <Bookmark
                  className={`w-4 h-4 ${
                    post.user_bookmarked ? "fill-current" : ""
                  }`}
                />
                {post.bookmark_count > 0 && post.bookmark_count}
              </button>

              {/* 공유 */}
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#928980] bg-[#FAF8F5] rounded-xl hover:text-[#1A1A1F] transition-colors"
              >
                <Share2 className="w-4 h-4" />
                공유
              </button>

              {/* 신고 */}
              <button
                type="button"
                onClick={handleReport}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#928980] bg-[#FAF8F5] rounded-xl hover:text-red-500 transition-colors"
              >
                <Flag className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 공유 토스트 */}
          {shareToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#1A1A1F] text-white text-sm rounded-xl shadow-lg">
              링크가 복사되었습니다
            </div>
          )}

          {/* 댓글 섹션 */}
          {!isMembersOnly && (
            <div className="mt-8">
              <CommentSection postId={post.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
