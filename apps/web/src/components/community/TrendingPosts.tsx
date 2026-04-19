"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

// 순위별 opacity: 1위 가장 진하고, 점차 연해짐
const RANK_OPACITY: Record<number, string> = {
  1: "opacity-100",
  2: "opacity-80",
  3: "opacity-60",
  4: "opacity-40",
  5: "opacity-30",
};

export default function TrendingPosts() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const lastFetchedAt = useRef<number>(0);

  const fetchTrending = useCallback(async (force = false) => {
    // 5분 캐시: 마지막 fetch 이후 5분 이내면 스킵
    const now = Date.now();
    if (!force && now - lastFetchedAt.current < 5 * 60 * 1000) return;

    try {
      const res = await fetch("/api/community/posts?sort=hot&limit=5&page=1");
      if (!res.ok) return;
      const data = await res.json();
      const fetched: TrendingPost[] = (data.posts ?? [])
        .slice(0, 5)
        .map((p: TrendingPost) => ({
          id: p.id,
          title: p.title,
          upvote_count: p.upvote_count,
          comment_count: p.comment_count,
        }));
      setPosts(fetched);
      lastFetchedAt.current = Date.now();
    } catch {
      // 오류 무시
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrending(true);
  }, [fetchTrending]);

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div className="py-2">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-5 w-28 bg-[#F0EFED] rounded animate-pulse" />
        </div>
        <div className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="w-6 h-6 bg-[#F0EFED] rounded animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-[#F0EFED] rounded animate-pulse" />
                <div className="h-3 w-12 bg-[#F0EFED] rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 데이터 없음
  if (posts.length === 0) return null;

  return (
    <div className="py-2">
      {/* 헤더: serif italic + subtle bottom border */}
      <div className="border-b border-[#F0EFED] pb-3 mb-6">
        <h3 className="font-serif-kr text-lg italic text-[#1A1A1F]">
          오늘의 인기글
        </h3>
      </div>

      <div className="space-y-1">
        {posts.map((post, i) => {
          const rank = i + 1;
          const opacity = RANK_OPACITY[rank] ?? "opacity-25";

          return (
            <Link
              key={post.id}
              href={`/community/post/${post.id}`}
              className="flex items-start gap-4 px-1 py-3 rounded-xl hover:bg-[#FDFCFA] transition-colors duration-200 group"
            >
              {/* 순위: serif italic, primary color, 점차 연해짐 */}
              <span
                className={`w-7 font-serif-kr text-lg italic font-medium shrink-0 text-[#C4967E] tabular-nums ${opacity}`}
              >
                {String(rank).padStart(2, "0")}
              </span>

              <div className="flex-1 min-w-0">
                {/* 제목 */}
                <span className="block text-sm text-[#1A1A1F] truncate group-hover:text-[#C4967E] transition-colors duration-200">
                  {post.title}
                </span>
                {/* 댓글 수 */}
                <span className="flex items-center gap-1 mt-1 text-[11px] text-[#B5ADA3]">
                  <MessageCircle className="w-3 h-3" />
                  {post.comment_count}
                </span>
              </div>

              <span className="text-[11px] text-[#22C55E] font-medium shrink-0 tabular-nums mt-0.5">
                +{post.upvote_count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
