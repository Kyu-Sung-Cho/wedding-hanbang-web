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
    <div>
      {/* 헤더 — 레퍼런스: font-headline text-lg border-b pb-2 mb-4 */}
      <h3 className="font-serif-kr text-lg text-[#1A1A1F] mb-4 border-b border-[#F0EFED] pb-2">
        오늘의 인기글
      </h3>

      <ul className="space-y-4">
        {posts.map((post, i) => {
          const rank = i + 1;
          const opacity = RANK_OPACITY[rank] ?? "opacity-25";

          return (
            <li key={post.id} className="group cursor-pointer">
              <Link href={`/community/post/${post.id}`} className="flex items-start space-x-3">
                {/* 순위: serif italic, primary, 점차 연해짐 */}
                <span
                  className={`font-serif-kr italic text-lg leading-none mt-0.5 shrink-0 text-[#C4967E] ${opacity}`}
                >
                  {String(rank).padStart(2, "0")}
                </span>

                <div>
                  <h4 className="text-sm text-[#1A1A1F] group-hover:text-[#C4967E] transition-colors line-clamp-2 leading-snug">
                    {post.title}
                  </h4>
                  <p className="text-xs text-[#504444] mt-1 flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" />
                    {post.comment_count}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
