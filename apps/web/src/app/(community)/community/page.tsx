"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { PenSquare, Star, Bookmark, Shield, Archive } from "lucide-react";
import Avatar from "@/components/community/Avatar";
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
import dynamic from "next/dynamic";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import CommunityGuide from "@/components/community/CommunityGuide";
import { withSessionCache } from "@/utils/sessionCache";

const CohortCard = dynamic(() => import("@/components/community/CohortCardContainer"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl bg-gradient-to-br from-[#795252] to-[#946a6a] h-32 animate-pulse" />
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

// 에디터 추천 배너 컴포넌트 — Atelier Hub 레퍼런스 정확 매칭
function EditorsPick({ post }: { post: PostWithAuthor }) {
  const contentPreview = post.content
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const author = post.author ?? { nickname: "익명", avatar_url: null };
  const images = post.images ?? [];
  const readMinutes = Math.max(1, Math.round(post.content.replace(/<[^>]*>/g, "").length / 400));

  return (
    <Link
      href={`/community/post/${post.id}`}
      className="relative rounded-xl overflow-hidden bg-[#f6f3f2] border border-[#e4e2e1] p-6 sm:p-8 lg:p-10 flex flex-col md:flex-row items-start md:items-center gap-6 sm:gap-8 group cursor-pointer hover:bg-[#f0eded] transition-colors duration-300"
    >
      <div className="absolute top-0 right-0 p-4">
        <Star className="text-[#795252]/40 w-7 h-7 sm:w-8 sm:h-8" />
      </div>
      <div className="flex-1 z-10 min-w-0">
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-white border border-[#d4c2c2]/30 text-sage-500 text-xs tracking-wider uppercase mb-4">
          <Bookmark className="w-[14px] h-[14px] mr-1.5" />
          에디터 추천
        </div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-serif-kr text-[#1b1c1c] mb-4 leading-tight group-hover:text-[#795252] transition-colors break-words line-clamp-3">
          {post.title}
        </h2>
        {contentPreview && (
          <p className="text-[#504444] text-sm sm:text-base mb-6 line-clamp-2">{contentPreview}</p>
        )}
        <div className="flex items-center text-sm sm:text-base text-[#504444] flex-wrap">
          <Avatar
            nickname={author.nickname}
            avatarUrl={(author as { avatar_url?: string | null }).avatar_url ?? null}
            size={28}
            className="mr-2"
          />
          <span>By {author.nickname}</span>
          <span className="mx-2">&middot;</span>
          <span>{readMinutes}분 읽기</span>
        </div>
      </div>
      {images.length > 0 && (
        <div className="w-full md:w-1/3 aspect-[4/3] rounded-lg overflow-hidden shrink-0">
          <Image
            src={images[0]}
            alt=""
            width={480}
            height={360}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        </div>
      )}
    </Link>
  );
}

export default function CommunityFeedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fcf9f8]" />}>
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
  const tagQuery = searchParams.get("tag") ?? "";

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const currentTag = useCommunityStore((s) => s.currentTag);
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

  // 카테고리/태그 동기화 + 글 목록 가져오기
  useEffect(() => {
    if (isSearching) return;
    const store = useCommunityStore.getState();
    store.setCategory(null);
    store.setTag(tagQuery || null);
    store.fetchPosts(true);
  }, [currentSort, currentPeriod, isSearching, tagQuery]);

  // 인기 태그 + 업체 태그 — sessionStorage 10분 캐시 (카테고리 navigation으로 remount돼도 재호출 안 함)
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
    void withSessionCache("community:vendor-tags:12", 10 * 60 * 1000, async () => {
      const res = await fetch("/api/community/vendor-tags?limit=12");
      if (!res.ok) return [] as VendorTag[];
      const data = await res.json();
      return (Array.isArray(data) ? data : data.tags ?? []) as VendorTag[];
    }).then((tags) => {
      if (!cancelled) setVendorTags(tags);
    });
    return () => {
      cancelled = true;
    };
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

  const featured = !isSearching && posts.length > 0
    ? (posts.find((p) => p.is_weekly_best) ?? posts.find((p) => p.is_pinned))
    : null;

  return (
    <div className="min-h-screen bg-[#fcf9f8] flex flex-col">
      {/* 모바일: 동기방 + 카테고리 */}
      <div className="lg:hidden px-4 sm:px-6 pt-4 space-y-3 overflow-x-auto">
        <CohortCard />
        <CategoryTabs />
      </div>

      <div className="flex-1 flex w-full">
        {/* SideNavBar — 더 넓게, 꽉 채우기 */}
        <aside className="hidden lg:flex bg-[#fcf9f8] h-[calc(100vh-5rem)] w-80 xl:w-96 2xl:w-[420px] sticky top-20 flex-col pt-12 pb-8 px-6 border-r border-[#e4e2e1] z-40 overflow-y-auto">
          <div className="mb-10 px-4">
            <h2 className="font-serif-kr text-3xl italic text-[#795252] mb-2">
              커뮤니티
            </h2>
            <p className="text-base text-[#504444] tracking-widest uppercase">
              웨딩한방 커뮤니티
            </p>
          </div>

          {/* 동기방 카드 */}
          <div className="px-2 mb-6">
            <CohortCard />
          </div>

          <CategoryTabs />

          <div className="mt-8 mb-8 px-4">
            <Link
              href="/community/post/write"
              className="w-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white py-4 rounded-lg font-medium text-lg shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all duration-200 flex items-center justify-center"
            >
              <PenSquare className="mr-2 w-6 h-6" />
              글쓰기
            </Link>
          </div>

          <div className="mt-auto space-y-1 pt-6 border-t border-[#e4e2e1]/50 pr-2">
            <Link
              href="/community/guidelines"
              className="flex items-center px-4 py-2 text-[#504444] hover:text-[#795252] group"
            >
              <Shield className="mr-3 w-5 h-5 opacity-60 group-hover:opacity-100" />
              <span className="text-base tracking-wider uppercase">가이드라인</span>
            </Link>
            <Link
              href="/community/archive"
              className="flex items-center px-4 py-2 text-[#504444] hover:text-[#795252] group"
            >
              <Archive className="mr-3 w-5 h-5 opacity-60 group-hover:opacity-100" />
              <span className="text-base tracking-wider uppercase">아카이브</span>
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20 py-6 sm:py-8 md:py-10 xl:py-12 overflow-y-auto">
          <div className="max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-6 sm:space-y-8 md:space-y-12">
            {/* 검색 결과 헤더 */}
            {isSearching && (
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2 text-lg text-[#1b1c1c]">
                  <span className="font-serif-kr italic">검색 결과</span>
                  <span className="text-[#504444]">&ldquo;{searchQuery}&rdquo;</span>
                  {!searchLoading && (
                    <span className="text-[#504444] text-sm">{searchTotal}건</span>
                  )}
                </div>
                <button
                  onClick={() => router.push("/community")}
                  className="text-sm text-[#795252] hover:text-[#946a6a] transition-colors duration-200"
                >
                  초기화
                </button>
              </div>
            )}

            {/* 활성 태그 필터 표시 */}
            {!isSearching && currentTag && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-[#928980]">필터:</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#795252]/10 text-[#795252] text-sm font-medium">
                  #{currentTag}
                  <button
                    type="button"
                    onClick={() => router.push("/community")}
                    className="ml-1 w-4 h-4 rounded-full bg-[#795252]/20 hover:bg-[#795252]/30 flex items-center justify-center text-[10px] leading-none"
                    aria-label="태그 필터 제거"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}

            {/* 에디터 추천 배너 (태그 필터 중엔 숨김 — featured는 전체 글 기반이라 태그와 안 맞을 수 있음) */}
            {featured && !currentTag && <EditorsPick post={featured} />}

            {/* 피드 헤더 (피드 디바이더) */}
            {!isSearching && (
              <div className="flex items-center justify-between gap-3 border-b border-[#e4e2e1] pb-4">
                <h3 className="font-serif-kr text-2xl sm:text-3xl lg:text-4xl text-[#1b1c1c]">
                  최신 글
                </h3>
                <SortSelector
                  sort={currentSort}
                  period={currentPeriod}
                  onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                  onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
                />
              </div>
            )}

            {/* 피드 리스트 */}
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

        {/* Right Sidebar — 레퍼런스: border-l, w-80 */}
        <aside className="hidden xl:block w-96 2xl:w-[420px] shrink-0 p-10 border-l border-[#e4e2e1] sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto bg-[#fcf9f8]">
          <div className="mb-10">
            <TrendingPosts />
          </div>
          <RightSidebar
            popularTags={vendorTags}
            weekly={{
              newPostsThisWeek: total,
              topVendor: vendorTags[0]?.vendor_name ?? null,
              avgStudioPrice: 185,
            }}
          />

          {/* 인기 태그 (해시태그) */}
          {popularTags.length > 0 && (
            <div className="mt-10">
              <h3 className="font-serif-kr text-lg text-[#1b1c1c] mb-4 border-b border-[#e4e2e1] pb-2">
                인기 태그
              </h3>
              <div className="flex flex-wrap gap-x-3 gap-y-2.5">
                {popularTags.slice(0, 15).map((t) => (
                  <Link
                    key={t.tag}
                    href={`/community?tag=${encodeURIComponent(t.tag)}`}
                    className="text-sm text-[#504444] hover:text-[#795252] transition-colors duration-200"
                  >
                    #{t.tag}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 내 활동 (게이미피케이션) */}
          <div className="mt-10">
            <GamificationWidget />
          </div>

          <div className="text-center py-4 mt-6">
            <Link
              href="/"
              className="text-[12px] text-[#504444] hover:text-[#795252] transition-colors duration-200 tracking-widest uppercase"
            >
              웨딩한방 서비스 둘러보기 →
            </Link>
          </div>
        </aside>
      </div>

      {/* 모바일 플로팅 글쓰기 */}
      <Link
        href="/community/post/write"
        className="lg:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] rounded-full transition-all duration-200"
        aria-label="글쓰기"
      >
        <PenSquare className="w-5 h-5" />
      </Link>

      {/* 커뮤니티 가이드 (첫 방문 시) */}
      <CommunityGuide />
    </div>
  );
}
