"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { communityPostPath } from "@/lib/community/routes";
import { scopedCommunitySessionCacheKey } from "@/lib/community/viewerPrivacyCache";
import { useAuthStore } from "@/stores/authStore";
import { withSessionCache } from "@/utils/sessionCache";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

const TRENDING_CACHE_KEY = "community:trending:weekly-top:5";
const TRENDING_TTL_MS = 5 * 60 * 1000;

export default function TrendingPosts() {
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const cacheKey = scopedCommunitySessionCacheKey(TRENDING_CACHE_KEY, viewerId);
  const [result, setResult] = useState<{
    cacheKey: string;
    posts: TrendingPost[];
    loading: boolean;
  }>({ cacheKey, posts: [], loading: true });
  const visibleResult = result.cacheKey === cacheKey
    ? result
    : { cacheKey, posts: [] as TrendingPost[], loading: true };
  const { posts, loading } = visibleResult;

  // sessionStorage 캐시 — 카테고리 navigation으로 remount돼도 같은 세션 안에선 재호출 안 함.
  // 이전엔 컴포넌트 ref 캐시였는데 remount마다 ref 초기화돼서 매번 fetch가 떠 답답했음.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await withSessionCache(
          cacheKey,
          TRENDING_TTL_MS,
          async () => {
            const res = await fetch("/api/community/posts?sort=top&period=week&limit=5&page=1");
            if (!res.ok) return [] as TrendingPost[];
            const json = await res.json();
            return (json.posts ?? []).slice(0, 5).map((p: TrendingPost) => ({
              id: p.id,
              title: p.title,
              upvote_count: p.upvote_count,
              comment_count: p.comment_count,
            })) as TrendingPost[];
          },
          {
            shouldCache: () =>
              !cancelled
              && (useAuthStore.getState().user?.id ?? null) === viewerId,
          },
        );
        if (!cancelled) setResult({ cacheKey, posts: data, loading: false });
      } finally {
        if (!cancelled) {
          setResult((current) =>
            current.cacheKey === cacheKey
              ? { ...current, loading: false }
              : { cacheKey, posts: [], loading: false },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, viewerId]);

  // 로딩 스켈레톤
  if (loading) {
    return (
      <div>
        <h3 className="font-serif-kr text-[var(--hb-text-strong)] mb-3 border-b border-[var(--hb-hairline)] pb-2">
          이번 주 인기글
        </h3>
        <ul className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-start space-x-3">
              <div className="w-6 h-5 bg-[#f0eded] rounded-[6px] animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-[#f0eded] rounded-[6px] animate-pulse" />
                <div className="h-3 w-12 bg-[#f0eded] rounded-[6px] animate-pulse" />
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
      <h3 className="font-serif-kr text-[var(--hb-text-strong)] mb-3 border-b border-[var(--hb-hairline)] pb-2">
        이번 주 인기글
      </h3>
      <ul className="space-y-4">
        {posts.map((p, i) => (
          <li key={p.id} className="group cursor-pointer">
            <Link href={communityPostPath(p.id)} className="flex items-start space-x-3">
              <span
                className={`text-[var(--hb-text-strong)] font-serif-kr italic text-xl leading-none mt-0.5 ${
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
                <h4 className="text-[var(--hb-text-strong)] group-hover:text-[var(--hb-text-strong)] transition-colors line-clamp-2">
                  {p.title}
                </h4>
                <p className="text-xs text-[var(--hb-text-body)] mt-1">답변 {p.comment_count}개</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
