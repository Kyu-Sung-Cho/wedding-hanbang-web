"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PenSquare } from "lucide-react";
import { useCommunityStore } from "@/stores/communityStore";
import {
  COMMUNITY_CATEGORIES,
  CATEGORY_MAP,
} from "@/constants/communityCategories";
import type { CommunityCategory } from "@/types/community.types";
import CategoryTabs from "@/components/community/CategoryTabs";
import SortSelector from "@/components/community/SortSelector";
import PostCard from "@/components/community/PostCard";
import PostSkeleton from "@/components/community/PostSkeleton";
import EmptyState from "@/components/community/EmptyState";
import GamificationWidget from "@/components/community/GamificationWidget";
import { withSessionCache } from "@/utils/sessionCache";

interface PopularTag {
  tag: string;
  count: number;
}

const VALID_KEYS = COMMUNITY_CATEGORIES.map((c) => c.key);

export default function CategoryFeedPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryParam = params.category as string;
  const tagQuery = searchParams.get("tag") ?? "";

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const currentTag = useCommunityStore((s) => s.currentTag);
  const total = useCommunityStore((s) => s.total);

  const [popularTags, setPopularTags] = useState<PopularTag[]>([]);
  const observerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!VALID_KEYS.includes(categoryParam as CommunityCategory)) {
      router.replace("/community");
      return;
    }
    const store = useCommunityStore.getState();
    store.setCategory(categoryParam as CommunityCategory);
    store.setTag(tagQuery || null);
    store.fetchPosts(true);
  }, [categoryParam, currentSort, currentPeriod, tagQuery, router]);

  useEffect(() => {
    let cancelled = false;
    void withSessionCache("community:popular-tags", 10 * 60 * 1000, async () => {
      const res = await fetch("/api/community/popular-tags");
      if (!res.ok) return [] as PopularTag[];
      const data = await res.json();
      return (data.tags ?? data ?? []) as PopularTag[];
    }).then((tags) => {
      if (!cancelled) setPopularTags(tags);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      const s = useCommunityStore.getState();
      if (entry.isIntersecting && s.hasMore && !s.isLoading) {
        s.fetchMorePosts();
      }
    },
    []
  );

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, {
      rootMargin: "200px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const categoryInfo = CATEGORY_MAP[categoryParam as CommunityCategory];
  if (!categoryInfo) return null;

  return (
    <div className="min-h-screen bg-[#fcf9f8] flex flex-col">
      {/* 모바일 카테고리 */}
      <div className="lg:hidden px-4 sm:px-6 pt-4">
        <CategoryTabs />
      </div>

      <div className="flex-1 flex w-full">
        {/* 왼쪽 사이드바 — community 페이지와 동일한 폭/스타일 */}
        <aside className="hidden lg:flex bg-[#fcf9f8] h-[calc(100vh-5rem)] w-80 xl:w-96 2xl:w-[420px] sticky top-20 flex-col pt-12 pb-8 px-6 border-r border-[#e4e2e1] z-40 overflow-y-auto">
          <CategoryTabs />

          <div className="mt-auto pt-4 px-2">
            <Link
              href="/community/post/write"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 text-base font-medium text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] rounded-full transition-all duration-200"
            >
              <PenSquare className="w-5 h-5" />
              글쓰기
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 — community 페이지와 동일한 padding/max-w */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20 py-6 sm:py-8 md:py-10 xl:py-12 overflow-y-auto">
          <div className="max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-6 sm:space-y-8">
            {/* 카테고리 헤더 */}
            <div>
              <h1 className="font-serif-kr text-2xl sm:text-3xl text-[#1b1c1c] mb-1">
                {categoryInfo.label}
              </h1>
              <p className="text-base text-[#878680]">
                {categoryInfo.description}
              </p>
            </div>

            {/* 정렬 바 — community 페이지와 동일 */}
            <div className="flex items-center gap-4 px-1 border-b border-[#e4e2e1] pb-4">
              <SortSelector
                sort={currentSort}
                period={currentPeriod}
                onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
              />
            </div>

            {/* 활성 태그 필터 표시 */}
            {currentTag && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-[#928980]">필터:</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#795252]/10 text-[#795252] text-sm font-medium">
                  #{currentTag}
                  <button
                    type="button"
                    onClick={() => router.push(`/community/${categoryParam}`)}
                    className="ml-1 w-4 h-4 rounded-full bg-[#795252]/20 hover:bg-[#795252]/30 flex items-center justify-center text-[10px] leading-none"
                    aria-label="태그 필터 제거"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}

            {/* 피드 — community 페이지와 동일 카드 간격(space-y-6) */}
            {isLoading && posts.length === 0 ? (
              <div className="space-y-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <PostSkeleton key={i} />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <EmptyState
                message={`${categoryInfo.label}에 아직 작성된 글이 없습니다`}
                description="첫 번째 글을 작성해 보세요!"
                ctaLabel="글쓰기"
                ctaHref="/community/post/write"
              />
            ) : (
              <div className="space-y-6">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {isLoading && (
                  <div className="space-y-6">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <PostSkeleton key={`more-${i}`} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={observerRef} className="h-1" />
          </div>
        </main>

        {/* 오른쪽 사이드바 — community 페이지와 동일한 frame */}
        <aside className="hidden xl:block w-96 2xl:w-[420px] shrink-0 p-10 border-l border-[#e4e2e1] sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto bg-[#fcf9f8] space-y-5">
          <GamificationWidget />

          <div className="bg-white rounded-2xl border border-[#F0EFED] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0EFED]">
              <h3 className="text-lg font-medium text-[#1A1A1F]">인기 카테고리</h3>
            </div>
            <div className="divide-y divide-[#F0EFED]">
              {COMMUNITY_CATEGORIES.map((cat, i) => (
                <Link
                  key={cat.key}
                  href={`/community/${cat.key}`}
                  className={`flex items-center gap-4 px-6 py-3.5 hover:bg-[#FAFAF8] transition-colors duration-150 ${
                    cat.key === categoryParam ? "bg-[#FAFAF8]" : ""
                  }`}
                >
                  <span className="text-base font-medium text-[#B5ADA3] w-5 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-base text-[#1A1A1F] font-medium">
                      {cat.label}
                    </div>
                    <div className="text-sm text-[#B5ADA3] truncate">
                      {cat.description}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {popularTags.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
              <h3 className="text-lg font-medium text-[#1A1A1F] mb-4">
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {popularTags.slice(0, 15).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community/${categoryParam}?tag=${encodeURIComponent(t.tag)}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-[#878680] bg-[#FAFAF8] rounded-full hover:bg-[#F0EFED] transition-colors duration-200"
                  >
                    #{t.tag}
                    <span className="text-xs text-[#B5ADA3]">{t.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
            <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-1.5">
              웨딩한방 커뮤니티
            </h2>
            <p className="text-base text-[#878680] leading-relaxed mb-3">
              예비 신랑신부를 위한 웨딩 정보 공유 공간
            </p>
            <div className="text-base text-[#B5ADA3]">글 {total || 0}개</div>
          </div>
        </aside>
      </div>

      <Link
        href="/community/post/write"
        className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] rounded-full transition-all duration-200"
        aria-label="글쓰기"
      >
        <PenSquare className="w-5 h-5" />
      </Link>
    </div>
  );
}
