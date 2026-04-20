"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

export default function TrendingPosts() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const lastFetchedAt = useRef<number>(0);

  const fetchTrending = useCallback(async (force = false) => {
    // 5분 캐시
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
      <div>
        <h3 className="font-serif-kr text-2xl text-[#1b1c1c] mb-4 border-b border-[#e4e2e1] pb-2">
          오늘의 인기글
        </h3>
        <ul className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-start space-x-3">
              <div className="w-6 h-5 bg-[#f0eded] rounded animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-[#f0eded] rounded animate-pulse" />
                <div className="h-3 w-12 bg-[#f0eded] rounded animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (posts.length === 0) return null;

  return (
    <div>
      <h3 className="font-serif-kr text-2xl text-[#1b1c1c] mb-4 border-b border-[#e4e2e1] pb-2">
        오늘의 인기글
      </h3>
      <ul className="space-y-5">
        {posts.map((p, i) => (
          <li key={p.id} className="group cursor-pointer">
            <Link href={`/community/post/${p.id}`} className="flex items-start space-x-3">
              <span
                className={`text-[#795252] font-serif-kr italic text-2xl leading-none mt-0.5 ${
                  i === 0
                    ? ""
                    : i === 1
                    ? "opacity-70"
                    : i === 2
                    ? "opacity-50"
                    : "opacity-30"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h4 className="text-[17px] text-[#1b1c1c] group-hover:text-[#795252] transition-colors line-clamp-2 leading-snug">
                  {p.title}
                </h4>
                <p className="text-sm text-[#504444] mt-1.5">{p.comment_count} replies</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
