"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { communityPostPath } from "@/lib/community/routes";
import { withSessionCache } from "@/utils/sessionCache";
import { useUserScopedClientActor } from "@/components/common/UserScopedClientStateBoundary";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

const TRENDING_CACHE_KEY = "community:trending:weekly-top:5";
const TRENDING_TTL_MS = 5 * 60 * 1000;

export default function TrendingPosts() {
  const actor = useUserScopedClientActor();
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedActorKey, setLoadedActorKey] = useState<string | null>(null);
  const actorKey = actor.status === "ready" ? actor.actorKey : null;
  const visiblePosts = actorKey !== null && loadedActorKey === actorKey ? posts : [];
  const visibleLoading = actorKey === null || loadedActorKey !== actorKey || loading;

  // sessionStorage 캐시 — 카테고리 navigation으로 remount돼도 같은 세션 안에선 재호출 안 함.
  // 이전엔 컴포넌트 ref 캐시였는데 remount마다 ref 초기화돼서 매번 fetch가 떠 답답했음.
  useEffect(() => {
    if (!actorKey) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await withSessionCache<TrendingPost[]>(TRENDING_CACHE_KEY, TRENDING_TTL_MS, actorKey, async (signal) => {
          const res = await fetch("/api/community/posts?sort=top&period=week&limit=5&page=1", { signal });
          if (!res.ok) return [] as TrendingPost[];
          const json = await res.json();
          return (json.posts ?? []).slice(0, 5).map((p: TrendingPost) => ({
            id: p.id,
            title: p.title,
            upvote_count: p.upvote_count,
            comment_count: p.comment_count,
          })) as TrendingPost[];
        });
        if (!cancelled) {
          setPosts(data);
          setLoadedActorKey(actorKey);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          setPosts([]);
          setLoadedActorKey(actorKey);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorKey]);

  // 로딩 스켈레톤
  if (visibleLoading) {
    return (
      <div>
        <h3 className="font-serif-kr text-lg text-[#263832] mb-3 border-b border-[#e5d8ca] pb-2">
          이번 주 인기글
        </h3>
        <ul className="space-y-4">
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

  if (visiblePosts.length === 0) return null;

  return (
    <div>
      <h3 className="font-serif-kr text-lg text-[#263832] mb-3 border-b border-[#e5d8ca] pb-2">
        이번 주 인기글
      </h3>
      <ul className="space-y-4">
        {visiblePosts.map((p, i) => (
          <li key={p.id} className="group cursor-pointer">
            <Link href={communityPostPath(p.id)} className="flex items-start space-x-3">
              <span
                className={`text-[#36534E] font-serif-kr italic text-xl leading-none mt-0.5 ${
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
                <h4 className="text-sm text-[#263832] group-hover:text-[#36534E] transition-colors line-clamp-2 leading-snug">
                  {p.title}
                </h4>
                <p className="text-xs text-[#635b51] mt-1">댓글 {p.comment_count}개</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
