"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Share2,
  Bookmark,
  Eye,
  Pin,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { PostWithAuthor, CommunityRank } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
  isLoggedIn?: boolean;
  onVote?: (postId: string, vote: 1 | -1) => void;
  onBookmark?: (postId: string) => void;
}

// 아바타 그래디언트 팔레트
const AVATAR_GRADIENTS = [
  "from-[#C4967E] to-[#C9A96E]",
  "from-[#A8D8A8] to-[#6BBF6B]",
  "from-[#7EB8D8] to-[#5A9CC0]",
  "from-[#C9A96E] to-[#DCC9A0]",
  "from-[#D88B8B] to-[#C06B6B]",
  "from-[#B39DDB] to-[#7E57C2]",
];

// 계급 라벨 + 레벨
const RANK_CONFIG: Record<CommunityRank, { label: string; level: number; bg: string; text: string }> = {
  sprout:    { label: "새싹",   level: 1, bg: "bg-[#2E7D5A]/10", text: "text-[#2E7D5A]" },
  preparing: { label: "준비중", level: 2, bg: "bg-[#7EB8D8]/10", text: "text-[#5A9CC0]" },
  expert:    { label: "전문가", level: 3, bg: "bg-[#C4967E]/10", text: "text-[#C4967E]" },
  master:    { label: "마스터", level: 4, bg: "bg-[#C9A96E]/10", text: "text-[#C9A96E]" },
  senior:    { label: "선배",   level: 5, bg: "bg-[#B39DDB]/10", text: "text-[#7E57C2]" },
};

// 카테고리 배지 배경색 (20% opacity 효과)
const CATEGORY_BADGE_BG: Record<string, string> = {
  questions: "bg-[#C4967E]/15 text-[#C4967E]",
  reviews: "bg-[#C9A96E]/15 text-[#C9A96E]",
  tips: "bg-[#7EB8D8]/15 text-[#5A9CC0]",
  daily: "bg-[#B39DDB]/15 text-[#7E57C2]",
  seniors: "bg-[#A8D8A8]/15 text-[#2E7D5A]",
};

// 비용 포맷 헬퍼
function formatPrice(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}억`;
  }
  return value.toLocaleString("ko-KR");
}

export default function PostCard({ post, isLoggedIn = false, onVote, onBookmark }: PostCardProps) {
  const router = useRouter();
  const categoryInfo = CATEGORY_MAP[post.category];
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);

  const [optimisticVote, setOptimisticVote] = useState<1 | -1 | null | undefined>(undefined);
  const [optimisticDelta, setOptimisticDelta] = useState(0);
  const [isVoting, setIsVoting] = useState(false);

  const displayVote = optimisticVote !== undefined ? optimisticVote : (post.user_vote ?? null);
  const voteCount = post.upvote_count - post.downvote_count + optimisticDelta;

  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const author = post.author ?? { nickname: "익명", rank: "sprout" as CommunityRank, avatar_url: null, wedding_year: null, wedding_month: null };
  const rankConfig = RANK_CONFIG[author.rank];

  // 아바타 그래디언트 결정 (닉네임 첫 글자 해시)
  const gradientIndex = author.nickname.charCodeAt(0) % AVATAR_GRADIENTS.length;
  const avatarGradient = AVATAR_GRADIENTS[gradientIndex];
  const avatarChar = author.avatar_url || author.nickname.charAt(0);
  const isEmoji = author.avatar_url ? /\p{Emoji}/u.test(author.avatar_url) : false;

  // 이미지 처리
  const images = post.images ?? [];
  const imageCount = images.length;
  const displayImages = images.slice(0, 3);
  const extraImageCount = imageCount > 3 ? imageCount - 3 : 0;

  // 카테고리 배지 스타일
  const categoryBadgeStyle = CATEGORY_BADGE_BG[post.category] || "bg-[#C4967E]/15 text-[#C4967E]";

  const handleVote = useCallback(
    async (vote: 1 | -1) => {
      if (!isLoggedIn) {
        router.push("/login");
        return;
      }
      if (isVoting) return;

      const prevVote = post.user_vote ?? null;
      let newVote: 1 | -1 | null;
      let delta = 0;

      if (prevVote === vote) {
        newVote = null;
        delta = -vote;
      } else if (prevVote === null) {
        newVote = vote;
        delta = vote;
      } else {
        newVote = vote;
        delta = vote * 2;
      }

      setOptimisticVote(newVote);
      setOptimisticDelta(delta);
      setIsVoting(true);

      try {
        onVote?.(post.id, vote);
      } catch {
        setOptimisticVote(undefined);
        setOptimisticDelta(0);
      } finally {
        setIsVoting(false);
      }
    },
    [isLoggedIn, isVoting, post.user_vote, post.id, onVote, router]
  );

  function handleBookmark() {
    setBookmarked((prev) => !prev);
    onBookmark?.(post.id);
  }

  return (
    <article className="bg-white rounded-xl border border-transparent hover:border-[#F0EFED]/50 p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 cursor-pointer">
      {/* 작성자 행: 아바타 + 닉네임 + 랭크 배지 + 시간 */}
      <div className="flex items-center gap-2.5 mb-4 text-xs">
        {/* 그래디언트 아바타 */}
        <Link
          href={`/community?author_id=${post.author_id}`}
          className="shrink-0"
        >
          <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center`}>
            <span className={`${isEmoji ? "text-xs" : "text-[10px] font-semibold text-white"}`}>
              {isEmoji ? avatarChar : author.nickname.charAt(0)}
            </span>
          </div>
        </Link>

        {/* 닉네임 */}
        <Link
          href={`/community?author_id=${post.author_id}`}
          className="text-xs font-medium text-[#504444] hover:text-[#C4967E] transition-colors duration-200"
        >
          {author.nickname}
        </Link>

        {/* 랭크 배지 (pill) */}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${rankConfig.bg} ${rankConfig.text}`}>
          Lv.{rankConfig.level}
        </span>

        {/* 시간 */}
        <span className="text-[#B5ADA3] text-xs">&middot;</span>
        <span className="text-xs text-[#B5ADA3]">{timeAgo(post.created_at)}</span>

        {/* 결혼 동기 */}
        {author.wedding_year && author.wedding_month && (
          <>
            <span className="text-[#B5ADA3] text-xs">&middot;</span>
            <span className="text-xs text-[#B5ADA3]">
              {String(author.wedding_year).slice(2)}.{String(author.wedding_month).padStart(2, "0")}
            </span>
          </>
        )}

        {/* 광고 표시 배지 */}
        {post.ad_disclosure === "sponsored" && (
          <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#FEFCE8] text-[#A16207] text-[10px] font-medium">
            협찬
          </span>
        )}
        {post.ad_disclosure === "ad" && (
          <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#FEF2F2] text-[#B91C1C] text-[10px] font-medium">
            광고
          </span>
        )}
        {post.is_verified_review && (
          <span className="ml-1 inline-flex items-center gap-1 text-[#C9A96E] text-[10px] font-medium">
            <ShieldCheck className="w-3 h-3" />
            인증
          </span>
        )}
        {post.under_review && (
          <span className="ml-1 inline-flex items-center gap-1 text-[#B91C1C] text-[10px] font-medium">
            <AlertTriangle className="w-3 h-3" />
            검토 중
          </span>
        )}
      </div>

      {/* 카테고리 배지 (제목 위) */}
      {categoryInfo && (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${categoryBadgeStyle}`}>
          {categoryInfo.shortLabel}
        </span>
      )}

      {/* 제목 — serif, larger */}
      <Link
        href={`/community/post/${post.id}`}
        className="group block"
      >
        <h3 className="font-serif-kr text-xl font-medium text-[#1A1A1F] group-hover:text-[#C4967E] transition-colors duration-200 leading-snug line-clamp-2">
          {post.is_pinned && (
            <span className="inline-flex items-center gap-1 text-[#C4967E] mr-2 text-sm font-medium align-middle">
              <Pin className="w-3.5 h-3.5" />
              PIN
            </span>
          )}

          {post.is_weekly_best && (
            <span className="text-[#C9A96E] text-xs font-medium mr-2 align-middle tracking-wider uppercase">
              Best
            </span>
          )}

          {post.is_resolved && (
            <span className="inline-flex items-center gap-1 text-[#22C55E] mr-2 text-xs font-medium align-middle">
              <CheckCircle2 className="w-3.5 h-3.5" />
              해결
            </span>
          )}

          {post.ai_comment && (
            <span className="inline-flex items-center gap-1 text-[#C4967E] mr-2 text-xs font-medium align-middle">
              <Sparkles className="w-3.5 h-3.5" />
              AI
            </span>
          )}

          {post.title}
        </h3>
      </Link>

      {/* 본문 미리보기 — softer text */}
      {contentPreview && (
        <p className="mt-2 text-sm text-[#504444] leading-relaxed line-clamp-2">
          {contentPreview}
        </p>
      )}

      {/* 비용 데이터 표시 */}
      {post.cost_data && (
        <div className="bg-[#FDFCFA] rounded-xl p-2.5 mt-3">
          <span className="text-[10px] text-[#B5ADA3] tracking-wide uppercase">Cost </span>
          <span className="text-[13px] font-medium text-[#1A1A1F]">{formatPrice(post.cost_data.totalCost)}만원</span>
        </div>
      )}

      {/* 이미지 갤러리 (최대 3장 가로 배열) */}
      {imageCount > 0 && (
        <div className="mt-4 flex gap-2.5">
          {displayImages.map((src, idx) => (
            <Link
              key={idx}
              href={`/community/post/${post.id}`}
              className="relative shrink-0 w-24 h-20 rounded-lg overflow-hidden bg-[#F6F3F2]"
            >
              <Image
                src={src}
                alt=""
                width={96}
                height={80}
                className="w-full h-full object-cover"
              />
              {/* 3번째 이미지에 +N 오버레이 */}
              {idx === 2 && extraImageCount > 0 && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                  <span className="text-white text-sm font-medium">+{extraImageCount}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* 태그 */}
      {post.tags && post.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
          {post.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="text-xs text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200 cursor-pointer"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 액션 바 — subtle, 18px icons, 12px counts */}
      <div className="mt-6 flex items-center gap-6 text-xs text-[#B5ADA3]">
        {/* 투표 그룹 */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => handleVote(1)}
            disabled={isVoting}
            className={`p-1 rounded-full transition-colors duration-200 ${
              displayVote === 1
                ? "text-[#2E7D5A] bg-[#2E7D5A]/10"
                : "hover:text-[#2E7D5A]"
            } disabled:opacity-50`}
            aria-label="추천"
          >
            <ChevronUp className="w-[18px] h-[18px]" />
          </button>
          <span
            className={`text-xs font-medium min-w-[1.25rem] text-center ${
              displayVote === 1
                ? "text-[#2E7D5A]"
                : displayVote === -1
                ? "text-[#D85A5A]"
                : "text-[#504444]"
            }`}
          >
            {voteCount}
          </span>
          <button
            type="button"
            onClick={() => handleVote(-1)}
            disabled={isVoting}
            className={`p-1 rounded-full transition-colors duration-200 ${
              displayVote === -1
                ? "text-[#D85A5A] bg-[#D85A5A]/10"
                : "hover:text-[#D85A5A]"
            } disabled:opacity-50`}
            aria-label="비추천"
          >
            <ChevronDown className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* 댓글 */}
        <Link
          href={`/community/post/${post.id}#comments`}
          className="flex items-center gap-1.5 hover:text-[#C4967E] transition-colors duration-200"
        >
          <MessageCircle className="w-[18px] h-[18px]" />
          <span className="text-xs">{post.comment_count}</span>
        </Link>

        {/* 조회수 */}
        <span className="flex items-center gap-1.5">
          <Eye className="w-[18px] h-[18px]" />
          <span className="text-xs">{post.view_count}</span>
        </span>

        {/* 오른쪽: 북마크 + 공유 */}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleBookmark}
            className={`p-1 rounded-full transition-colors duration-200 ${
              bookmarked ? "text-[#C4967E]" : "hover:text-[#C4967E]"
            }`}
            aria-label="저장"
          >
            <Bookmark
              className="w-[18px] h-[18px]"
              fill={bookmarked ? "#C4967E" : "none"}
            />
          </button>
          <button
            type="button"
            className="p-1 rounded-full hover:text-[#C4967E] transition-colors duration-200"
            aria-label="공유"
          >
            <Share2 className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </article>
  );
}
