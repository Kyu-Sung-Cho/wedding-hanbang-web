"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

// 순위별 색상: gold, silver, bronze
const RANK_COLORS: Record<number, string> = {
  1: "text-[#C9A96E]",
  2: "text-[#B5ADA3]",
  3: "text-[#C4967E]",
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
      <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🔥</span>
          <div className="h-5 w-24 bg-[#F0EFED] rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 bg-[#F0EFED] rounded animate-pulse shrink-0" />
              <div className="flex-1 h-4 bg-[#F0EFED] rounded animate-pulse" />
              <div className="w-8 h-4 bg-[#F0EFED] rounded animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 데이터 없음
  if (posts.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔥</span>
        <h3 className="font-serif text-lg font-medium text-[#1A1A1F]">
          오늘의 인기글
        </h3>
      </div>

      <div className="space-y-1">
        {posts.map((post, i) => {
          const rank = i + 1;
          const rankColor = RANK_COLORS[rank] ?? "text-[#878680]";

          return (
            <Link
              key={post.id}
              href={`/community/post/${post.id}`}
              className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[#FAFAF8] transition-colors duration-200 group"
            >
              <span
                className={`w-5 text-base font-semibold shrink-0 tabular-nums ${rankColor}`}
              >
                {rank}
              </span>

              <span className="flex-1 text-sm text-[#1A1A1F] truncate min-w-0 group-hover:text-[#C4967E] transition-colors duration-200">
                {post.title}
              </span>

              <span className="text-xs text-[#22C55E] font-medium shrink-0 tabular-nums">
                ▲{post.upvote_count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
