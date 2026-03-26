"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PenSquare } from "lucide-react";
import { useCommunityStore } from "@/stores/communityStore";
import type { PostWithAuthor } from "@/types/community.types";
import CategoryTabs from "@/components/community/CategoryTabs";
import SortSelector from "@/components/community/SortSelector";
import PostCard from "@/components/community/PostCard";
import PostSkeleton from "@/components/community/PostSkeleton";
import EmptyState from "@/components/community/EmptyState";
import GamificationWidget from "@/components/community/GamificationWidget";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";

interface PopularTag {
  tag: string;
  count: number;
}

export default function CommunityFeedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAFAF8]" />}>
      <CommunityFeedContent />
    </Suspense>
  );
}

function CommunityFeedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchQuery = searchParams.get("search") ?? "";

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const total = useCommunityStore((s) => s.total);

  const [searchResults, setSearchResults] = useState<PostWithAuthor[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);

  const [popularTags, setPopularTags] = useState<PopularTag[]>([]);
  const observerRef = useRef<HTMLDivElement>(null);

  const isSearching = searchQuery.length > 0;

  // 검색 API 호출
  useEffect(() => {
    if (!isSearching) {
      setSearchResults([]);
      setSearchPage(1);
      setSearchTotal(0);
      return;
    }

    setSearchLoading(true);
    setSearchPage(1);
    fetch(`/api/community/search?q=${encodeURIComponent(searchQuery)}&page=1&limit=20`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setSearchResults(data.posts ?? []);
        setSearchHasMore(data.hasMore ?? false);
        setSearchTotal(data.total ?? 0);
      })
      .catch(() => {
        setSearchResults([]);
        setSearchHasMore(false);
        setSearchTotal(0);
      })
      .finally(() => setSearchLoading(false));
  }, [searchQuery, isSearching]);

  // 검색 결과 더 불러오기
  const fetchMoreSearchResults = useCallback(() => {
    if (!isSearching || searchLoading || !searchHasMore) return;
    const nextPage = searchPage + 1;
    setSearchLoading(true);
    fetch(`/api/community/search?q=${encodeURIComponent(searchQuery)}&page=${nextPage}&limit=20`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setSearchResults((prev) => [...prev, ...(data.posts ?? [])]);
        setSearchHasMore(data.hasMore ?? false);
        setSearchPage(nextPage);
      })
      .catch(() => {})
      .finally(() => setSearchLoading(false));
  }, [isSearching, searchLoading, searchHasMore, searchPage, searchQuery]);

  // 카테고리 초기화 + 글 목록 가져오기
  useEffect(() => {
    if (isSearching) return;
    const store = useCommunityStore.getState();
    store.setCategory(null);
    store.fetchPosts(true);
  }, [currentSort, currentPeriod, isSearching]);

  // 인기 태그 가져오기
  useEffect(() => {
    fetch("/api/community/popular-tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPopularTags(data.tags ?? data ?? []))
      .catch(() => {});
  }, []);

  // 무한스크롤
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (!entry.isIntersecting) return;

      if (isSearching) {
        fetchMoreSearchResults();
      } else {
        const s = useCommunityStore.getState();
        if (s.hasMore && !s.isLoading) {
          s.fetchMorePosts();
        }
      }
    },
    [isSearching, fetchMoreSearchResults]
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

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* 모바일 카테고리 */}
      <div className="lg:hidden px-4 sm:px-6 pt-4">
        <CategoryTabs />
      </div>

      <div className="flex w-full">
        {/* 왼쪽 사이드바: 화면 왼쪽 끝에 붙임 */}
        <aside className="hidden lg:flex flex-col w-[280px] xl:w-[300px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto border-r border-[#F0EFED] bg-white py-5 px-3">
          <CategoryTabs />

          <div className="mt-auto pt-4 px-2">
            <Link
              href="/community/post/write"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 text-base font-medium text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-full transition-all duration-200"
            >
              <PenSquare className="w-5 h-5" />
              글쓰기
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 */}
        <main className="flex-1 min-w-0 px-5 sm:px-8 lg:px-10 py-6">
          <div className="max-w-[800px] mx-auto lg:mx-0 lg:max-w-none">
            {/* 검색 결과 헤더 */}
            {isSearching && (
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2 text-lg text-[#1A1A1F]">
                  <span className="font-medium">검색 결과</span>
                  <span>&ldquo;{searchQuery}&rdquo;</span>
                  {!searchLoading && (
                    <span className="text-[#B5ADA3] text-base">{searchTotal}건</span>
                  )}
                </div>
                <button
                  onClick={() => router.push("/community")}
                  className="text-base text-[#C4967E] hover:text-[#9A6B62] transition-colors duration-200"
                >
                  초기화
                </button>
              </div>
            )}

            {/* 정렬 바 */}
            {!isSearching && (
              <div className="flex items-center gap-4 mb-5 px-1">
                <SortSelector
                  sort={currentSort}
                  period={currentPeriod}
                  onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                  onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
                />
              </div>
            )}

            {/* 피드 */}
            {isSearching ? (
              <>
                {searchLoading && searchResults.length === 0 ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <PostSkeleton key={i} />
                    ))}
                  </div>
                ) : searchResults.length === 0 ? (
                  <EmptyState
                    message={`"${searchQuery}"에 대한 검색 결과가 없습니다`}
                    description="다른 키워드로 검색해 보세요."
                  />
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((post) => (
                      <PostCard key={post.id} post={post} />
                    ))}
                    {searchLoading && (
                      <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <PostSkeleton key={`more-${i}`} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {isLoading && posts.length === 0 ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <PostSkeleton key={i} />
                    ))}
                  </div>
                ) : posts.length === 0 ? (
                  <EmptyState
                    message="아직 작성된 글이 없습니다"
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
              </>
            )}

            <div ref={observerRef} className="h-1" />
          </div>
        </main>

        {/* 오른쪽 사이드바: 화면 오른쪽 끝에 붙임 */}
        <aside className="hidden xl:flex flex-col w-[340px] 2xl:w-[380px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto py-6 pr-6 pl-2 space-y-5 border-l border-[#F0EFED]">
          {/* 게이미피케이션 */}
          <GamificationWidget />

          {/* 인기 카테고리 (레딧의 인기 커뮤니티 스타일) */}
          <div className="bg-white rounded-2xl border border-[#F0EFED] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F0EFED]">
              <h3 className="text-lg font-medium text-[#1A1A1F]">인기 카테고리</h3>
            </div>
            <div className="divide-y divide-[#F0EFED]">
              {COMMUNITY_CATEGORIES.map((cat, i) => (
                <Link
                  key={cat.key}
                  href={`/community/${cat.key}`}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#FAFAF8] transition-colors duration-150"
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

          {/* 인기 태그 */}
          {popularTags.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
              <h3 className="text-lg font-medium text-[#1A1A1F] mb-4">
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-2.5">
                {popularTags.slice(0, 15).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community?tag=${encodeURIComponent(t.tag)}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-[#878680] bg-[#FAFAF8] rounded-full hover:bg-[#F0EFED] transition-colors duration-200"
                  >
                    #{t.tag}
                    <span className="text-xs text-[#B5ADA3]">{t.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 커뮤니티 정보 */}
          <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
            <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-1.5">
              웨딩한방 커뮤니티
            </h2>
            <p className="text-base text-[#878680] leading-relaxed mb-3">
              예비 신랑신부를 위한 웨딩 정보 공유 공간
            </p>
            <div className="text-base text-[#B5ADA3]">글 {total || 0}개</div>
          </div>

          <div className="text-center py-2">
            <Link href="/login" className="text-sm text-[#878680] hover:text-[#C4967E] transition-colors duration-200">
              웨딩한방 서비스 둘러보기 →
            </Link>
          </div>
        </aside>
      </div>

      {/* 모바일 플로팅 글쓰기 */}
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
