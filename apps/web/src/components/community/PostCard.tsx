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
    <article className="bg-white rounded-xl border border-[#F0EFED]/60 hover:border-[#E8E5E0] p-8 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 cursor-pointer">
      <div className={`flex ${imageCount > 0 ? "flex-col-reverse sm:flex-row" : ""} gap-8`}>
        {/* 텍스트 영역 */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            {/* 상단: 카테고리 배지 + 시간 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                {categoryInfo && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded ${categoryBadgeStyle}`}>
                    {categoryInfo.shortLabel}
                  </span>
                )}
                <span className="text-xs text-[#928980]">{timeAgo(post.created_at)}</span>

                {post.ad_disclosure === "sponsored" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEFCE8] text-[#A16207] text-xs font-medium">협찬</span>
                )}
                {post.ad_disclosure === "ad" && (
                  <span className="px-2 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] text-xs font-medium">광고</span>
                )}
              </div>
            </div>

            {/* 제목 — serif */}
            <Link href={`/community/post/${post.id}`} className="group block">
              <h4 className="font-serif-kr text-2xl text-[#1A1A1F] mb-3 group-hover:text-[#C4967E] cursor-pointer transition-colors leading-tight line-clamp-2">
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-[#C4967E] mr-2 text-sm font-medium align-middle">
                    <Pin className="w-3.5 h-3.5" /> PIN
                  </span>
                )}
                {post.is_weekly_best && (
                  <span className="text-[#C9A96E] text-xs font-medium mr-2 align-middle tracking-wider uppercase">Best</span>
                )}
                {post.title}
              </h4>
            </Link>

            {/* 본문 미리보기 */}
            {contentPreview && (
              <p className="text-[#504444] text-[15px] leading-relaxed line-clamp-2 mb-5">
                {contentPreview}
              </p>
            )}

            {/* 비용 데이터 */}
            {post.cost_data && (
              <div className="bg-[#F6F3F2] rounded-lg px-3 py-1.5 mb-5 inline-block">
                <span className="text-xs text-[#504444]">비용: </span>
                <span className="text-sm font-medium text-[#1A1A1F]">{formatPrice(post.cost_data.totalCost)}만원</span>
              </div>
            )}
          </div>

          {/* 하단: 작성자 왼쪽 / 댓글·북마크·공유 오른쪽 */}
          <div className="flex items-center justify-between mt-auto pt-3">
            <div className="flex items-center space-x-2.5">
              <Link href={`/community?author_id=${post.author_id}`} className="shrink-0">
                <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center`}>
                  <span className="text-[11px] font-semibold text-white">
                    {isEmoji ? avatarChar : author.nickname.charAt(0)}
                  </span>
                </div>
              </Link>
              <span className="text-sm text-[#504444]">{author.nickname}</span>
            </div>

            <div className="flex items-center space-x-5 text-[#504444]">
              {/* 댓글 */}
              <Link
                href={`/community/post/${post.id}#comments`}
                className="flex items-center space-x-1.5 hover:text-[#C4967E] transition-colors group"
              >
                <MessageCircle className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" />
                <span className="text-xs">{post.comment_count}</span>
              </Link>

              {/* 북마크 */}
              <button
                type="button"
                onClick={handleBookmark}
                className={`flex items-center transition-colors group ${
                  bookmarked ? "text-[#C4967E]" : "hover:text-[#C4967E]"
                }`}
                aria-label="저장"
              >
                <Bookmark className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" fill={bookmarked ? "#C4967E" : "none"} />
              </button>

              {/* 공유 */}
              <button
                type="button"
                className="flex items-center hover:text-[#C4967E] transition-colors group"
                aria-label="공유"
              >
                <Share2 className="w-[18px] h-[18px] opacity-60 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>

        {/* 이미지 (있으면 오른쪽) */}
        {imageCount > 0 && (
          <Link
            href={`/community/post/${post.id}`}
            className="w-full sm:w-36 h-36 rounded-lg overflow-hidden shrink-0 mt-4 sm:mt-0"
          >
            <Image
              src={images[0]}
              alt=""
              width={144}
              height={144}
              className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
            />
          </Link>
        )}
      </div>
    </article>
  );
}
