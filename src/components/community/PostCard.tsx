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
} from "lucide-react";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { PostWithAuthor, BadgeType } from "@/types/community.types";

interface PostCardProps {
  post: PostWithAuthor;
  isLoggedIn?: boolean;
  onVote?: (postId: string, vote: 1 | -1) => void;
  onBookmark?: (postId: string) => void;
}

function badgeText(badge: BadgeType): string | null {
  switch (badge) {
    case "verified_couple":
      return "인증";
    case "top_contributor":
      return "TOP";
    case "admin":
      return "관리자";
    default:
      return null;
  }
}

function formatCost(costInManwon: number): string {
  if (costInManwon >= 10000) {
    const billions = costInManwon / 10000;
    return `${billions % 1 === 0 ? billions.toFixed(0) : billions.toFixed(1)}억`;
  }
  return `${costInManwon.toLocaleString()}만`;
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

  const hasThumbnail = post.images && post.images.length > 0;
  const totalCost = post.cost_data?.totalCost;
  const badge = badgeText(post.author.badge);

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
    <article className="bg-white rounded-2xl border border-[#F0EFED] px-7 py-5 hover:shadow-sm transition-all duration-300">
      {/* 메타 라인 */}
      <div className="flex items-center gap-2 text-[15px] mb-3">
        {categoryInfo && (
          <>
            <span className="font-medium text-[#C4967E]">
              {categoryInfo.shortLabel}
            </span>
            <span className="text-[#B5ADA3]">&middot;</span>
          </>
        )}
        <Link
          href={`/community?author_id=${post.author_id}`}
          className="text-[#1A1A1F] hover:text-[#C4967E] transition-colors duration-200"
        >
          {post.author.nickname}
        </Link>
        {badge && (
          <>
            <span className="text-[#B5ADA3]">&middot;</span>
            <span className="text-[#C9A96E] font-medium">
              {badge}
            </span>
          </>
        )}
        <span className="text-[#B5ADA3]">&middot;</span>
        <span className="text-[#B5ADA3]">{timeAgo(post.created_at)}</span>
      </div>

      {/* 제목 + 썸네일 */}
      <div className="flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <Link
            href={`/community/post/${post.id}`}
            className="group"
          >
            <h3 className="text-xl font-medium text-[#1A1A1F] group-hover:text-[#C4967E] transition-colors duration-200 leading-snug line-clamp-2">
              {post.is_pinned && (
                <span className="inline-flex items-center gap-1 text-[#C4967E] mr-2 text-sm font-medium align-middle">
                  <Pin className="w-4 h-4" />
                  PIN
                </span>
              )}

              {post.is_weekly_best && (
                <span className="text-[#C9A96E] text-sm font-medium mr-2 align-middle">
                  BEST
                </span>
              )}

              {post.category === "cost_share" && totalCost != null && (
                <span className="text-[#C9A96E] font-medium mr-2 align-middle">
                  &#8361; {formatCost(totalCost)}
                </span>
              )}

              {post.title}
            </h3>
          </Link>

          {contentPreview && (
            <p className="mt-2 text-[15px] text-[#878680] leading-relaxed line-clamp-2">
              {contentPreview}
            </p>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
              {post.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200 cursor-pointer"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasThumbnail && (
          <Link
            href={`/community/post/${post.id}`}
            className="shrink-0 w-32 h-24 rounded-xl overflow-hidden bg-[#F5F2ED]"
          >
            <Image
              src={post.images[0]}
              alt=""
              width={112}
              height={80}
              className="w-full h-full object-cover"
            />
          </Link>
        )}
      </div>

      {/* 액션 바 */}
      <div className="mt-5 flex items-center gap-7 text-[15px] text-[#B5ADA3]">
        {/* 투표 그룹 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleVote(1)}
            disabled={isVoting}
            className={`p-1 rounded transition-colors duration-200 ${
              displayVote === 1
                ? "text-[#C4967E]"
                : "hover:text-[#C4967E]"
            } disabled:opacity-50`}
            aria-label="추천"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <span
            className={`text-[15px] font-medium min-w-[1.5rem] text-center ${
              displayVote === 1
                ? "text-[#C4967E]"
                : displayVote === -1
                ? "text-[#B5ADA3]"
                : "text-[#1A1A1F]"
            }`}
          >
            {voteCount}
          </span>
          <button
            type="button"
            onClick={() => handleVote(-1)}
            disabled={isVoting}
            className={`p-1 rounded transition-colors duration-200 ${
              displayVote === -1
                ? "text-[#C4967E]"
                : "hover:text-[#C4967E]"
            } disabled:opacity-50`}
            aria-label="비추천"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {/* 댓글 */}
        <Link
          href={`/community/post/${post.id}#comments`}
          className="flex items-center gap-2 hover:text-[#C4967E] transition-colors duration-200"
        >
          <MessageCircle className="w-5 h-5" />
          <span>{post.comment_count}</span>
        </Link>

        {/* 조회수 */}
        <span className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          <span>{post.view_count}</span>
        </span>

        {/* 오른쪽: 북마크 + 공유 */}
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            onClick={handleBookmark}
            className={`p-1 rounded transition-colors duration-200 ${
              bookmarked ? "text-[#C4967E]" : "hover:text-[#C4967E]"
            }`}
            aria-label="저장"
          >
            <Bookmark
              className="w-5 h-5"
              fill={bookmarked ? "#C4967E" : "none"}
            />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:text-[#C4967E] transition-colors duration-200"
            aria-label="공유"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    </article>
  );
}
