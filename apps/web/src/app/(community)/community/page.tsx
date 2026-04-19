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
import ServiceBanner from "@/components/community/ServiceBanner";
import GamificationWidget from "@/components/community/GamificationWidget";
import RightSidebar from "@/components/community/RightSidebar";
import TrendingPosts from "@/components/community/TrendingPosts";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";
import dynamic from "next/dynamic";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import CommunityGuide from "@/components/community/CommunityGuide";

const CohortCard = dynamic(() => import("@/components/community/CohortCardContainer"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl bg-[#1A1A1F] h-32 animate-pulse" />
  ),
});

interface PopularTag {
  tag: string;
  count: number;
}

interface VendorTag {
  vendor_name: string;
  mention_count: number;
}

export default function CommunityFeedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAFAF8]" />}>
      <CommunityFeedContent />
    </Suspense>
  );
}

function CommunityFeedContent() {
  // 리얼타임: 새 글/수정/삭제 즉시 반영
  useCommunityRealtime();

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
  const [vendorTags, setVendorTags] = useState<VendorTag[]>([]);
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

  // 인기 태그 + 업체 태그 가져오기
  useEffect(() => {
    fetch("/api/community/popular-tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPopularTags(data.tags ?? data ?? []))
      .catch(() => {});
    fetch("/api/community/vendor-tags?limit=12")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setVendorTags(Array.isArray(data) ? data : data.tags ?? []))
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
      {/* 모바일: 동기방 + 카테고리 */}
      <div className="lg:hidden px-4 sm:px-6 pt-4 space-y-3">
        <CohortCard />
        <CategoryTabs />
      </div>

      <div className="flex w-full">
        {/* 왼쪽 사이드바 */}
        <aside className="hidden lg:flex flex-col w-[280px] xl:w-[300px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto bg-white py-8 px-3">
          {/* serif italic 헤더 */}
          <div className="px-5 mb-8">
            <h2 className="font-serif-kr text-2xl italic text-[#1A1A1F] leading-tight">
              커뮤니티
            </h2>
          </div>

          {/* 동기방 카드 */}
          <div className="px-2 mb-6">
            <CohortCard />
          </div>

          <CategoryTabs />

          <div className="mt-auto pt-6 px-2 space-y-2.5">
            <Link
              href="/community/quick-review"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3 text-sm font-medium text-[#504444] bg-transparent hover:bg-[#F6F3F2] rounded-full transition-all duration-200"
            >
              15초 후기
            </Link>
            <Link
              href="/community/post/write"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 text-sm font-medium text-white bg-[#1A1A1F] hover:bg-[#2d2d30] rounded-full transition-all duration-200"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 */}
        <main className="flex-1 min-w-0 px-6 sm:px-8 lg:px-12 py-8">
          <div className="max-w-[800px] mx-auto lg:mx-0 lg:max-w-none">
            {/* 검색 결과 헤더 */}
            {isSearching && (
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2 text-lg text-[#1A1A1F]">
                  <span className="font-serif-kr italic">검색 결과</span>
                  <span className="text-[#504444]">&ldquo;{searchQuery}&rdquo;</span>
                  {!searchLoading && (
                    <span className="text-[#B5ADA3] text-sm">{searchTotal}건</span>
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

            {/* 피드 헤더: serif title + sort dropdown */}
            {!isSearching && (
              <div className="flex items-center justify-between mb-8 border-b border-[#F0EFED]/60 pb-4">
                <h2 className="font-serif-kr text-xl text-[#1A1A1F]">
                  최근 대화
                </h2>
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
                  <div className="space-y-6">
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
                  <div className="space-y-6">
                    {searchResults.map((post, idx) => (
                      <div key={post.id}>
                        <PostCard post={post} />
                        {/* 4번째, 14번째, 24번째 글 뒤에 서비스 배너 삽입 */}
                        {(idx === 4 || (idx > 4 && (idx - 4) % 10 === 0)) && (
                          <div className="mt-6">
                            <ServiceBanner index={Math.floor((idx - 4) / 10)} />
                          </div>
                        )}
                      </div>
                    ))}
                    {searchLoading && (
                      <div className="space-y-6">
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
                  <div className="space-y-6">
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
                  <div className="space-y-6">
                    {posts.map((post, idx) => (
                      <div key={post.id}>
                        <PostCard post={post} />
                        {/* 4번째, 14번째, 24번째 글 뒤에 서비스 배너 삽입 */}
                        {(idx === 4 || (idx > 4 && (idx - 4) % 10 === 0)) && (
                          <div className="mt-6">
                            <ServiceBanner index={Math.floor((idx - 4) / 10)} />
                          </div>
                        )}
                      </div>
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
              </>
            )}

            <div ref={observerRef} className="h-1" />
          </div>
        </main>

        {/* 오른쪽 사이드바 */}
        <aside className="hidden xl:flex flex-col w-[340px] 2xl:w-[380px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] overflow-y-auto py-8 pr-8 pl-4 space-y-8">
          {/* 1. 오늘의 인기글 */}
          <TrendingPosts />

          {/* 2. 이번 주 요약 + 3. 많이 찾는 업체 + 커뮤니티 원칙 + 아모라 CTA */}
          <RightSidebar
            popularTags={vendorTags}
            weekly={{
              newPostsThisWeek: total,
              topVendor: vendorTags[0]?.vendor_name ?? null,
              avgStudioPrice: 185,
            }}
          />

          {/* 4. 인기 태그 (해시태그) */}
          {popularTags.length > 0 && (
            <div className="bg-[#FDFCFA] rounded-2xl p-6">
              <h3 className="font-serif-kr text-lg italic text-[#1A1A1F] border-b border-[#F0EFED] pb-2 mb-5">
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-x-3 gap-y-2.5">
                {popularTags.slice(0, 15).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community?tag=${encodeURIComponent(t.tag)}`}
                    className="text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200"
                  >
                    #{t.tag}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 5. 내 활동 (게이미피케이션) */}
          <GamificationWidget />

          <div className="text-center py-4">
            <Link href="/" className="text-xs text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200 tracking-wide">
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

      {/* 커뮤니티 가이드 (첫 방문 시) */}
      <CommunityGuide />
    </div>
  );
}
