"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

interface PopularTag {
  tag: string;
  count: number;
}

const VALID_KEYS = COMMUNITY_CATEGORIES.map((c) => c.key);

export default function CategoryFeedPage() {
  const params = useParams();
  const router = useRouter();
  const categoryParam = params.category as string;

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
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
    store.fetchPosts(true);
  }, [categoryParam, currentSort, currentPeriod, router]);

  useEffect(() => {
    fetch("/api/community/popular-tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPopularTags(data.tags ?? data ?? []))
      .catch(() => {});
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
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* 모바일 카테고리 */}
      <div className="lg:hidden px-4 sm:px-6 pt-4">
        <CategoryTabs />
      </div>

      <div className="flex max-w-[1600px] mx-auto">
        {/* 왼쪽 사이드바 */}
        <aside className="hidden lg:flex flex-col w-[270px] shrink-0 sticky top-[64px] h-[calc(100vh-64px)] overflow-y-auto border-r border-[#F0EFED] bg-white py-5 px-3">
          <CategoryTabs />

          <div className="mt-auto pt-4 px-1">
            <Link
              href="/community/post/write"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3 text-[15px] font-medium text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-full transition-all duration-200"
            >
              <PenSquare className="w-5 h-5" />
              글쓰기
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5">
          <div className="max-w-[700px] mx-auto lg:mx-0 lg:max-w-none xl:max-w-[750px]">
            {/* 카테고리 헤더 */}
            <div className="mb-5">
              <h1 className="text-xl font-medium text-[#1A1A1F]">
                {categoryInfo.label}
              </h1>
              <p className="mt-1 text-base text-[#878680]">
                {categoryInfo.description}
              </p>
            </div>

            {/* 정렬 바 */}
            <div className="flex items-center gap-4 mb-5 px-1">
              <SortSelector
                sort={currentSort}
                period={currentPeriod}
                onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
              />
            </div>

            {/* 피드 */}
            {isLoading && posts.length === 0 ? (
              <div className="space-y-3">
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
              <div className="space-y-3">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {isLoading && (
                  <div className="space-y-3">
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

        {/* 오른쪽 사이드바 */}
        <aside className="hidden xl:flex flex-col w-[340px] shrink-0 sticky top-[64px] h-[calc(100vh-64px)] overflow-y-auto py-5 pr-8 pl-2 space-y-4">
          <GamificationWidget />

          <div className="bg-white rounded-2xl border border-[#F0EFED] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F0EFED]">
              <h3 className="text-base font-medium text-[#1A1A1F]">인기 카테고리</h3>
            </div>
            <div className="divide-y divide-[#F0EFED]">
              {COMMUNITY_CATEGORIES.map((cat, i) => (
                <Link
                  key={cat.key}
                  href={`/community/${cat.key}`}
                  className={`flex items-center gap-3.5 px-5 py-3 hover:bg-[#FAFAF8] transition-colors duration-150 ${
                    cat.key === categoryParam ? "bg-[#FAFAF8]" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-[#B5ADA3] w-5 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] text-[#1A1A1F] font-medium">
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
            <div className="bg-white rounded-2xl border border-[#F0EFED] p-5">
              <h3 className="text-base font-medium text-[#1A1A1F] mb-4">
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-2">
                {popularTags.slice(0, 15).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community?tag=${encodeURIComponent(t.tag)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#878680] bg-[#FAFAF8] rounded-full hover:bg-[#F0EFED] transition-colors duration-200"
                  >
                    #{t.tag}
                    <span className="text-xs text-[#B5ADA3]">{t.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#F0EFED] p-5">
            <h2 className="font-serif text-lg font-medium text-[#1A1A1F] mb-1">
              웨딩한방 커뮤니티
            </h2>
            <p className="text-sm text-[#878680] leading-relaxed mb-3">
              예비 신랑신부를 위한 웨딩 정보 공유 공간
            </p>
            <div className="text-sm text-[#B5ADA3]">글 {total || 0}개</div>
          </div>
        </aside>
      </div>

      <Link
        href="/community/post/write"
        className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
        aria-label="글쓰기"
      >
        <PenSquare className="w-5 h-5" />
      </Link>
    </div>
  );
}
