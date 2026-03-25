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
      <div className="min-h-screen bg-[#F4F6F8]">
        <div className="mx-auto max-w-[740px] px-4 py-5">
          <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-5">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-24 bg-[#F4F6F8] rounded-md" />
              <div className="h-7 w-3/4 bg-[#F4F6F8] rounded-md" />
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-[#F4F6F8] rounded-full" />
                <div className="h-3 w-32 bg-[#F4F6F8] rounded-md" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-[#F4F6F8] rounded-md" />
                <div className="h-4 w-full bg-[#F4F6F8] rounded-md" />
                <div className="h-4 w-2/3 bg-[#F4F6F8] rounded-md" />
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
      <div className="min-h-screen bg-[#F4F6F8]">
        <div className="mx-auto max-w-[740px] px-4 py-16 text-center">
          <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-8">
            <ImageIcon className="w-10 h-10 mx-auto mb-3 text-[#6B7280]" />
            <p className="text-[#1c1c1e] font-medium">
              게시글을 찾을 수 없습니다
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              삭제되었거나 존재하지 않는 글입니다.
            </p>
            <Link
              href="/community"
              className="mt-4 inline-flex items-center px-4 py-2.5 text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors"
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
  const voteCount = post.upvote_count - post.downvote_count;

  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <div className="mx-auto max-w-[740px] px-4 py-5">
        {/* 뒤로가기 */}
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1c1c1e] transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          커뮤니티
        </button>

        {/* 메인 포스트 카드 */}
        <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] overflow-hidden">
          <div className="flex">
            {/* 좌측 투표 스트립 (데스크탑) */}
            <div className="hidden md:flex flex-col items-center w-11 bg-[#FAFAFA] rounded-l-lg pt-3 shrink-0">
              <VoteButtons
                count={voteCount}
                userVote={post.user_vote ?? null}
                onVote={(v) =>
                  votePost(post.id, post.user_vote === v ? 0 : v)
                }
                isLoggedIn={!!user}
              />
            </div>

            {/* 콘텐츠 영역 */}
            <div className="flex-1 min-w-0 p-4">
              {/* 메타: 카테고리 · 작성자 · 시간 */}
              <div className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-3">
                {categoryInfo && (
                  <>
                    <Link
                      href={`/community/${post.category}`}
                      className="font-semibold text-[#1c1c1e] hover:text-[#2563EB] transition-colors"
                    >
                      {categoryInfo.label}
                    </Link>
                    <span>&middot;</span>
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-[#F4F6F8] ring-1 ring-[#E5E7EB] flex items-center justify-center overflow-hidden">
                    {post.author.avatar_url ? (
                      <Image
                        src={post.author.avatar_url}
                        alt=""
                        width={20}
                        height={20}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[9px] font-bold text-[#6B7280]">
                        {post.author.nickname.charAt(0)}
                      </span>
                    )}
                  </div>
                  <span className="hover:underline cursor-pointer font-medium text-[#1c1c1e]">
                    {post.author.nickname}
                  </span>
                </div>
                {badgeLabel(post.author.badge) && (
                  <>
                    <span>&middot;</span>
                    <span className="text-[#FF4500] font-medium">
                      {badgeLabel(post.author.badge)}
                    </span>
                  </>
                )}
                <span>&middot;</span>
                <span>{timeAgo(post.created_at)}</span>
              </div>

              {/* 제목 */}
              <h1 className="text-xl sm:text-2xl font-bold text-[#1c1c1e] leading-snug mb-3">
                {post.title}
              </h1>

              {/* 본문 */}
              <div className="relative">
                {isMembersOnly ? (
                  <>
                    {/* 블러 처리된 미리보기 */}
                    <div
                      className="text-sm text-[#1c1c1e] leading-relaxed whitespace-pre-wrap blur-sm select-none pointer-events-none max-h-40 overflow-hidden"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(post.content.slice(0, 300)),
                      }}
                    />
                    {/* 로그인 유도 오버레이 */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-white via-white/90 to-transparent">
                      <Lock className="w-8 h-8 text-[#6B7280] mb-2" />
                      <p className="text-sm font-bold text-[#1c1c1e] mb-1">
                        회원 전용 게시글입니다
                      </p>
                      <p className="text-xs text-[#6B7280] mb-3">
                        로그인하면 전체 내용을 볼 수 있어요
                      </p>
                      <Link
                        href="/login"
                        className="inline-flex items-center px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors"
                      >
                        로그인하기
                      </Link>
                    </div>
                  </>
                ) : (
                  <div
                    className="text-sm text-[#1c1c1e] leading-relaxed whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(post.content),
                    }}
                  />
                )}
              </div>

              {/* 이미지 갤러리 */}
              {!isMembersOnly && post.images && post.images.length > 0 && (
                <div className="mt-4">
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
                        className="relative aspect-square rounded-lg overflow-hidden bg-[#F4F6F8] hover:opacity-90 transition-opacity"
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
                  <div className="mt-4">
                    <CostShareDisplay data={post.cost_data} />
                  </div>
                )}

              {/* 태그 */}
              {!isMembersOnly && post.tags && post.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/community?tag=${encodeURIComponent(tag)}`}
                      className="px-2.5 py-1 text-xs text-[#6B7280] bg-[#F4F6F8] rounded-lg hover:bg-[#E5E7EB] transition-colors"
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
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {post.vendor_details.map((vendor) => (
                      <Link
                        key={vendor.id}
                        href={`/vendors/${vendor.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#1c1c1e] bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg hover:border-[#6B7280] transition-colors"
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
                          <span className="text-[#6B7280]">
                            {vendor.rating.toFixed(1)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}

              {/* 액션바 */}
              <div className="mt-4 pt-3 border-t border-[#E5E7EB] flex items-center gap-0.5 text-xs font-medium text-[#6B7280]">
                {/* 모바일 투표 */}
                <div className="md:hidden mr-1">
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

                {/* 댓글 수 */}
                <span className="px-2.5 py-1.5 rounded-md hover:bg-[#F4F6F8] cursor-default transition-colors">
                  {post.comment_count ?? 0} 댓글
                </span>

                {/* 공유 */}
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-[#F4F6F8] transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  공유
                </button>

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
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-[#F4F6F8] transition-colors ${
                    post.user_bookmarked ? "text-[#2563EB]" : ""
                  }`}
                >
                  <Bookmark
                    className={`w-3.5 h-3.5 ${
                      post.user_bookmarked ? "fill-current" : ""
                    }`}
                  />
                  저장
                  {post.bookmark_count > 0 && ` ${post.bookmark_count}`}
                </button>

                {/* 신고 */}
                <button
                  type="button"
                  onClick={handleReport}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md hover:bg-[#F4F6F8] transition-colors"
                >
                  <Flag className="w-3.5 h-3.5" />
                  신고
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 공유 토스트 */}
        {shareToast && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1c1c1e] text-white text-sm rounded-lg shadow-lg">
            링크가 복사되었습니다
          </div>
        )}

        {/* 댓글 섹션 */}
        {!isMembersOnly && (
          <div className="mt-3 bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-5">
            <CommentSection postId={post.id} />
          </div>
        )}
      </div>
    </div>
  );
}
