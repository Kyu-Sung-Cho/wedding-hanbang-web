"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PenSquare, Search, X } from "lucide-react";
import { useCommunityStore } from "@/stores/communityStore";
import type { PostWithAuthor } from "@/types/community.types";
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
  const hasMore = useCommunityStore((s) => s.hasMore);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const total = useCommunityStore((s) => s.total);

  // 검색 결과 상태
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

  // 카테고리 초기화 + 글 목록 가져오기 (검색 중이 아닐 때만)
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

  // 무한스크롤 IntersectionObserver
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
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8">
        {/* 검색 결과 헤더 */}
        {isSearching && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-base text-[#1A1A1F]">
              <span className="font-medium">검색 결과</span>
              <span className="text-[#1A1A1F]">&ldquo;{searchQuery}&rdquo;</span>
              {!searchLoading && (
                <span className="text-[#B5ADA3]">{searchTotal}건</span>
              )}
            </div>
            <button
              onClick={() => router.push("/community")}
              className="text-sm text-[#C4967E] hover:text-[#9A6B62] transition-colors duration-200"
            >
              초기화
            </button>
          </div>
        )}

        {/* 정렬 바 (검색 중이 아닐 때만 표시) */}
        {!isSearching && (
          <div className="bg-white rounded-2xl border border-[#F0EFED] p-4 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <CategoryTabs />
              </div>
              <div className="w-px h-6 bg-[#F0EFED]" />
              <div className="shrink-0">
                <SortSelector
                  sort={currentSort}
                  period={currentPeriod}
                  onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                  onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-6">
          {/* 메인 피드 */}
          <div className="flex-1 min-w-0">
            {isSearching ? (
              <>
                {/* 검색 로딩 */}
                {searchLoading && searchResults.length === 0 ? (
                  <div className="space-y-4">
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
                  <div className="space-y-4">
                    {searchResults.map((post) => (
                      <PostCard key={post.id} post={post} />
                    ))}

                    {/* 추가 로딩 */}
                    {searchLoading && (
                      <div className="space-y-4">
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
                {/* 초기 로딩 */}
                {isLoading && posts.length === 0 ? (
                  <div className="space-y-4">
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
                  <div className="space-y-4">
                    {posts.map((post) => (
                      <PostCard key={post.id} post={post} />
                    ))}

                    {/* 추가 로딩 */}
                    {isLoading && (
                      <div className="space-y-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <PostSkeleton key={`more-${i}`} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* 무한스크롤 감지 요소 */}
            <div ref={observerRef} className="h-1" />
          </div>

          {/* 데스크탑 사이드바 */}
          <aside className="hidden lg:block w-[300px] xl:w-[320px] shrink-0 space-y-4">
            {/* 게이미피케이션 위젯 */}
            <GamificationWidget />

            {/* 커뮤니티 정보 카드 */}
            <div className="bg-white rounded-2xl border border-[#F0EFED] p-6">
              <h2 className="font-serif text-lg font-medium text-[#1A1A1F] mb-1">
                웨딩한방 커뮤니티
              </h2>
              <p className="text-sm text-[#878680] leading-relaxed mb-4">
                예비 신랑신부를 위한<br />
                웨딩 정보 공유 공간
              </p>

              <div className="border-t border-[#F0EFED] py-3 mb-4">
                <span className="text-sm text-[#878680]">글 {total || 0}개</span>
              </div>

              <Link
                href="/community/post/write"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-xl transition-all duration-200"
              >
                <PenSquare className="w-4 h-4" />
                글쓰기
              </Link>
            </div>

            {/* 인기 태그 */}
            {popularTags.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#F0EFED] p-5">
                <h3 className="text-sm font-medium text-[#1A1A1F] mb-3">
                  인기 태그
                </h3>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {popularTags.slice(0, 12).map((t) => (
                    <Link
                      key={t.tag}
                      href={`/community?tag=${encodeURIComponent(t.tag)}`}
                      className="inline-flex items-center gap-1 text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200"
                    >
                      #{t.tag}
                      <span className="text-xs text-[#B5ADA3]">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 웨딩한방 서비스 링크 */}
            <div className="text-center py-3">
              <Link href="/login" className="text-xs text-[#878680] hover:text-[#C4967E] transition-colors duration-200">
                웨딩한방 서비스 둘러보기 →
              </Link>
            </div>
          </aside>
        </div>

        {/* 모바일 플로팅 글쓰기 버튼 */}
        <Link
          href="/community/post/write"
          className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200"
          aria-label="글쓰기"
        >
          <PenSquare className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}
