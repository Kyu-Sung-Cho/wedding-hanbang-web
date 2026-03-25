"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PenSquare, Hash, Sparkles, Search, X } from "lucide-react";
import { useCommunityStore } from "@/stores/communityStore";
import type { PostWithAuthor } from "@/types/community.types";
import CategoryTabs from "@/components/community/CategoryTabs";
import SortSelector from "@/components/community/SortSelector";
import PostCard from "@/components/community/PostCard";
import PostSkeleton from "@/components/community/PostSkeleton";
import EmptyState from "@/components/community/EmptyState";

interface PopularTag {
  tag: string;
  count: number;
}

export default function CommunityFeedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F4F6F8]" />}>
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
    <div className="min-h-screen bg-[#F4F6F8]">
      <div className="mx-auto max-w-[960px] px-4 py-5">
        {/* 검색 결과 헤더 */}
        {isSearching && (
          <div className="flex items-center justify-between bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-3 mb-3">
            <div className="flex items-center gap-2 text-sm text-[#1c1c1e]">
              <Search className="w-4 h-4 text-[#6B7280]" />
              <span className="font-medium">검색 결과: &ldquo;{searchQuery}&rdquo;</span>
              {!searchLoading && (
                <span className="text-[#6B7280]">({searchTotal}건)</span>
              )}
            </div>
            <button
              onClick={() => router.push("/community")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#6B7280] bg-[#F4F6F8] rounded-lg hover:bg-[#E5E7EB] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              검색 초기화
            </button>
          </div>
        )}

        {/* 정렬 바 (검색 중이 아닐 때만 표시) */}
        {!isSearching && (
          <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-2.5 mb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <CategoryTabs />
              </div>
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

                    {/* 추가 로딩 */}
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
                {/* 초기 로딩 */}
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

                    {/* 추가 로딩 */}
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

            {/* 무한스크롤 감지 요소 */}
            <div ref={observerRef} className="h-1" />
          </div>

          {/* 데스크탑 사이드바 */}
          <aside className="hidden lg:block w-[312px] shrink-0 space-y-3">
            {/* 커뮤니티 정보 카드 */}
            <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] overflow-hidden">
              <div className="bg-gradient-to-r from-[#1c1c1e] to-[#374151] h-10" />
              <div className="p-4">
                <h2 className="text-sm font-bold text-[#1c1c1e] mb-1.5">
                  웨딩한방 커뮤니티
                </h2>
                <p className="text-xs text-[#6B7280] leading-relaxed mb-4">
                  예비 신랑신부를 위한 웨딩 정보 공유 커뮤니티입니다. 후기, 비용,
                  팁을 자유롭게 나눠보세요.
                </p>
                <Link
                  href="/community/post/write"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors"
                >
                  <PenSquare className="w-4 h-4" />
                  글쓰기
                </Link>
              </div>
            </div>

            {/* 인기 태그 */}
            {popularTags.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-4">
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-[#1c1c1e] uppercase mb-3">
                  <Hash className="w-3.5 h-3.5 text-[#6B7280]" />
                  인기 태그
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {popularTags.slice(0, 12).map((t) => (
                    <Link
                      key={t.tag}
                      href={`/community?tag=${encodeURIComponent(t.tag)}`}
                      className="px-2.5 py-1 text-xs text-[#6B7280] bg-[#F4F6F8] rounded-lg hover:bg-[#E5E7EB] transition-colors"
                    >
                      #{t.tag}
                      <span className="ml-1 text-[#6B7280]/60">{t.count}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 웨딩한방 서비스 프로모션 */}
            <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-[#6B7280]" />
                <h3 className="text-xs font-bold text-[#1c1c1e]">
                  웨딩한방 서비스
                </h3>
              </div>
              <p className="text-xs text-[#6B7280] leading-relaxed mb-3">
                AI 웨딩 플래너가 예산 관리, 일정 관리, 업체 추천까지 한 번에
                도와드려요.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center px-3.5 py-2 text-xs font-medium text-[#2563EB] border border-[#2563EB] rounded-lg hover:bg-[#2563EB] hover:text-white transition-all"
              >
                무료로 시작하기
              </Link>
            </div>
          </aside>
        </div>

        {/* 모바일 플로팅 글쓰기 버튼 */}
        <Link
          href="/community/post/write"
          className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-2xl shadow-lg hover:shadow-xl transition-all"
          aria-label="글쓰기"
        >
          <PenSquare className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}
