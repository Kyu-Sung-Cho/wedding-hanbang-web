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
  ChevronRight,
  X,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  List,
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
function badgeLabel(badge: BadgeType | string | null | undefined): string | null {
  switch (badge) {
    case "senior":
      return "결혼 선배";
    case "master":
      return "웨딩 마스터";
    case "expert":
      return "결준 고수";
    case "preparing":
      return "예비 신부/신랑";
    default:
      return null;
  }
}

// 신고 사유 옵션
const REPORT_REASONS = [
  { value: "spam", label: "스팸/도배" },
  { value: "abuse", label: "욕설/비하" },
  { value: "ad", label: "광고/홍보" },
  { value: "inappropriate", label: "부적절한 내용" },
  { value: "other", label: "기타" },
] as const;

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

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 신고 모달 상태
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(false);

  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 로그인 필요 알림
  const [loginToast, setLoginToast] = useState(false);

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
  function handleReportSubmit() {
    if (!reportReason) return;
    // TODO: API 호출로 신고 전송
    setReportSubmitted(true);
    setTimeout(() => {
      setShowReportModal(false);
      setReportSubmitted(false);
    }, 1500);
  }

  // 삭제 처리
  async function handleDelete() {
    if (!post || deleting) return;
    setDeleting(true);
    const ok = await deletePost(post.id);
    setDeleting(false);
    if (ok) {
      setShowDeleteModal(false);
      router.push("/community");
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

  // 로딩
  if (postLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8]">
        <div className="mx-auto max-w-[1015px] px-4 sm:px-6 lg:px-8 py-5">
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
        <div className="mx-auto max-w-[1015px] px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-[#F0EFED] p-8">
            <ImageIcon className="w-10 h-10 mx-auto mb-3 text-[#878680]" />
            <p className="text-[#1A1A1F] font-medium">
              게시글을 찾을 수 없습니다
            </p>
            <p className="mt-1 text-sm text-[#878680]">
              삭제되었거나 존재하지 않는 글입니다.
            </p>
            <Link
              href="/community"
              className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-[#1A1A1F] hover:bg-[#0D0D0F] rounded-lg transition-all duration-200"
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
  const isAuthor = user && user.id === post.author_id;

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="mx-auto max-w-[1015px] px-4 sm:px-6 lg:px-8 py-5">
        {/* 브레드크럼 네비게이션 */}
        <nav className="flex items-center gap-1 text-sm text-[#B5ADA3] mb-3 overflow-hidden">
          <Link
            href="/community"
            className="shrink-0 hover:text-[#C4967E] transition-colors"
          >
            커뮤니티
          </Link>
          {categoryInfo && (
            <>
              <span className="shrink-0 text-[#B5ADA3]">/</span>
              <Link
                href={`/community/${post.category}`}
                className="shrink-0 hover:text-[#C4967E] transition-colors"
              >
                {categoryInfo.label}
              </Link>
            </>
          )}
          <span className="shrink-0 text-[#B5ADA3]">/</span>
          <span className="truncate text-[#1A1A1F]">{post.title}</span>
        </nav>

        {/* 메인 포스트 카드 */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#F0EFED] overflow-hidden">
          <div className="flex">
            {/* 좌측 투표 스트립 (데스크탑) */}
            <div className="hidden md:flex flex-col items-center w-11 bg-[#FAFAF8] rounded-l-2xl pt-3 shrink-0">
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
              <div className="flex items-center gap-2 text-sm text-[#878680] mb-3">
                {categoryInfo && (
                  <>
                    <Link
                      href={`/community/${post.category}`}
                      className="font-semibold text-[#1A1A1F] hover:text-[#C4967E] transition-all duration-200"
                    >
                      {categoryInfo.label}
                    </Link>
                    <span>&middot;</span>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#F0EFED] ring-1 ring-[#F0EFED] flex items-center justify-center overflow-hidden">
                    {post.author.avatar_url ? (
                      <Image
                        src={post.author.avatar_url}
                        alt=""
                        width={20}
                        height={20}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-bold text-[#878680]">
                        {post.author.nickname.charAt(0)}
                      </span>
                    )}
                  </div>
                  <span className="hover:underline cursor-pointer font-medium text-[#1A1A1F]">
                    {post.author.nickname}
                  </span>
                </div>
                {badgeLabel(post.author.rank) && (
                  <>
                    <span>&middot;</span>
                    <span className="text-[#C4967E] font-medium">
                      {badgeLabel(post.author.rank)}
                    </span>
                  </>
                )}
                <span>&middot;</span>
                <span>{timeAgo(post.created_at)}</span>
              </div>

              {/* 제목 */}
              <h1 className="text-xl sm:text-2xl font-medium text-[#1A1A1F] leading-snug mb-3">
                {post.title}
              </h1>

              {/* 본문 */}
              <div className="relative">
                {isMembersOnly ? (
                  <>
                    {/* 블러 처리된 미리보기 */}
                    <div
                      className="text-base text-[#1A1A1F] leading-relaxed whitespace-pre-wrap blur-sm select-none pointer-events-none max-h-40 overflow-hidden"
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
                        className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-[#1A1A1F] hover:bg-[#0D0D0F] rounded-lg transition-all duration-200"
                      >
                        로그인하기
                      </Link>
                    </div>
                  </>
                ) : (
                  <div
                    className="text-base text-[#1A1A1F] leading-relaxed whitespace-pre-wrap break-words"
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
                        : post.images.length === 3
                        ? "grid-cols-3"
                        : "grid-cols-2 sm:grid-cols-3"
                    }`}
                  >
                    {post.images.map((src, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setLightboxIndex(idx)}
                        className={`relative overflow-hidden rounded-xl bg-[#FAFAF8] hover:opacity-90 transition-all duration-200 ${
                          post.images!.length === 1
                            ? "aspect-video"
                            : "aspect-square"
                        }`}
                      >
                        <Image
                          src={src}
                          alt={`이미지 ${idx + 1}`}
                          fill
                          className="object-cover"
                        />
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

              {/* 비용 공유 데이터 (레거시) */}
              {!isMembersOnly && post.cost_data && (
                <div className="mt-4">
                  <CostShareDisplay data={post.cost_data} />
                </div>
              )}

              {/* 태그 */}
              {!isMembersOnly && post.tags && post.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/community?tag=${encodeURIComponent(tag)}`}
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
                        href={`/vendors/${vendor.id}`}
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

              {/* 액션바 */}
              <div className="mt-4 pt-3 border-t border-[#F0EFED] flex items-center gap-4 text-sm font-medium text-[#B5ADA3]">
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
                <span className="px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] cursor-default transition-all duration-200">
                  {post.comment_count ?? 0} 댓글
                </span>

                {/* 공유 */}
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200"
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
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200 ${
                    post.user_bookmarked ? "text-[#C4967E]" : ""
                  }`}
                >
                  <Bookmark
                    className={`w-4 h-4 ${
                      post.user_bookmarked ? "fill-current" : ""
                    }`}
                  />
                  저장
                  {post.bookmark_count > 0 && ` ${post.bookmark_count}`}
                </button>

                {/* 신고 */}
                <button
                  type="button"
                  onClick={handleReportClick}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#FAFAF8] transition-all duration-200"
                >
                  <Flag className="w-4 h-4" />
                  신고
                </button>

                {/* 삭제 (작성자만) */}
                {isAuthor && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-all duration-200 ml-auto"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 목록으로 버튼 */}
        <div className="mt-3 flex">
          <Link
            href={
              categoryInfo
                ? `/community/${post.category}`
                : "/community"
            }
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-all duration-200"
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
                      className="w-6 h-6 text-[#C4967E]"
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
                              ? "border-[#C4967E] bg-[#C4967E]/5"
                              : "border-[#F0EFED] hover:bg-[#FAFAF8]"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              reportReason === reason.value
                                ? "border-[#C4967E]"
                                : "border-[#B5ADA3]"
                            }`}
                          >
                            {reportReason === reason.value && (
                              <div className="w-2 h-2 rounded-full bg-[#C4967E]" />
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
                      className="mt-4 w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAFAF8] border border-[#F0EFED] rounded-xl resize-none focus:outline-none focus:border-[#C4967E] focus:shadow-[0_0_0_2px_rgba(196,150,126,0.1)] transition-all duration-200 placeholder:text-[#B5ADA3]"
                    />
                  </div>

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
                      disabled={!reportReason}
                      className="px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      신고하기
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
      </div>
    </div>
  );
}
