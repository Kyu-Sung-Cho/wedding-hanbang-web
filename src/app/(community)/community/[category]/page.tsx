"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PenSquare, Hash, Sparkles } from "lucide-react";
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

interface PopularTag {
  tag: string;
  count: number;
}

// 유효한 카테고리 키 목록
const VALID_KEYS = COMMUNITY_CATEGORIES.map((c) => c.key);

export default function CategoryFeedPage() {
  const params = useParams();
  const router = useRouter();
  const categoryParam = params.category as string;

  const {
    posts,
    isLoading,
    hasMore,
    currentSort,
    currentPeriod,
    fetchPosts,
    fetchMorePosts,
    setSort,
    setPeriod,
    setCategory,
  } = useCommunityStore();

  const [popularTags, setPopularTags] = useState<PopularTag[]>([]);
  const observerRef = useRef<HTMLDivElement>(null);

  // 카테고리 유효성 검사 및 설정
  useEffect(() => {
    if (!VALID_KEYS.includes(categoryParam as CommunityCategory)) {
      router.replace("/community");
      return;
    }
    setCategory(categoryParam as CommunityCategory);
  }, [categoryParam, setCategory, router]);

  // 글 목록 가져오기
  useEffect(() => {
    if (VALID_KEYS.includes(categoryParam as CommunityCategory)) {
      fetchPosts(true);
    }
  }, [fetchPosts, categoryParam, currentSort, currentPeriod]);

  // 인기 태그 가져오기
  useEffect(() => {
    fetch("/api/community/popular-tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPopularTags(data.tags ?? data ?? []))
      .catch(() => {});
  }, []);

  // 무한스크롤 IntersectionObserver
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !isLoading) {
        fetchMorePosts();
      }
    },
    [hasMore, isLoading, fetchMorePosts]
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

  // 유효하지 않은 카테고리면 리다이렉트 전까지 빈 화면
  if (!categoryInfo) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* 카테고리 설명 헤더 */}
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-xl font-medium text-[#1A1A1F]">
          {categoryInfo.label}
        </h1>
        <p className="mt-1 text-sm text-[#928980]">
          {categoryInfo.description}
        </p>
      </div>

      {/* 카테고리 탭 + 정렬 */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex-1 min-w-0">
          <CategoryTabs />
        </div>
        <div className="shrink-0">
          <SortSelector
            sort={currentSort}
            period={currentPeriod}
            onSortChange={setSort}
            onPeriodChange={setPeriod}
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* 메인 피드 */}
        <div className="flex-1 min-w-0">
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
              ctaHref="/community/write"
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

        {/* 데스크탑 사이드바 */}
        <aside className="hidden lg:block w-72 shrink-0 space-y-4">
          <Link
            href="/community/write"
            className="flex items-center justify-center gap-2 w-full px-5 py-3 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-2xl transition-colors"
          >
            <PenSquare className="w-4 h-4" />
            글쓰기
          </Link>

          {popularTags.length > 0 && (
            <div className="bg-white border border-black/[0.04] rounded-2xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-medium text-[#1A1A1F] mb-3">
                <Hash className="w-4 h-4 text-[#C4967E]" />
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-2">
                {popularTags.slice(0, 12).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community?tag=${encodeURIComponent(t.tag)}`}
                    className="px-3 py-1 text-xs font-medium text-[#928980] bg-[#FAF8F5] rounded-full hover:text-[#C4967E] hover:bg-[#C4967E]/10 transition-colors"
                  >
                    #{t.tag}
                    <span className="ml-1 text-[#B5ADA3]">{t.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-black/[0.04] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#C9A96E]" />
              <h3 className="text-sm font-medium text-[#1A1A1F]">
                웨딩한방 서비스
              </h3>
            </div>
            <p className="text-xs text-[#928980] leading-relaxed mb-3">
              AI 웨딩 플래너가 예산 관리, 일정 관리, 업체 추천까지 한 번에 도와드려요.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center px-4 py-2 text-xs font-medium text-[#C9A96E] border border-[#C9A96E]/30 rounded-xl hover:bg-[#C9A96E]/10 transition-colors"
            >
              무료로 시작하기
            </Link>
          </div>
        </aside>
      </div>

      {/* 모바일 플로팅 글쓰기 버튼 */}
      <Link
        href="/community/write"
        className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-full shadow-lg transition-colors"
        aria-label="글쓰기"
      >
        <PenSquare className="w-5 h-5" />
      </Link>
    </div>
  );
}
