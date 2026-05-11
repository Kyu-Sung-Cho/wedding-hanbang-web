"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import {
  PenSquare,
  Star,
  Bookmark,
  Shield,
  Archive,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  MessageCircle,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import Avatar from "@/components/community/Avatar";
import { useCommunityStore } from "@/stores/communityStore";
import type { PostWithAuthor } from "@/types/community.types";
import CategoryTabs from "@/components/community/CategoryTabs";
import SortSelector from "@/components/community/SortSelector";
import PostCard from "@/components/community/PostCard";
import PostSkeleton from "@/components/community/PostSkeleton";
import EmptyState from "@/components/community/EmptyState";
import EmptyFeedStarter from "@/components/community/EmptyFeedStarter";
import FeedComposer from "@/components/community/FeedComposer";
import ServiceBanner from "@/components/community/ServiceBanner";
import GamificationWidget from "@/components/community/GamificationWidget";
import RightSidebar from "@/components/community/RightSidebar";
import TrendingPosts from "@/components/community/TrendingPosts";
import CommunityHero from "@/components/community/CommunityHero";
import CommunityTrustLoop from "@/components/community/CommunityTrustLoop";
import dynamic from "next/dynamic";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import CommunityGuide from "@/components/community/CommunityGuide";
import { withSessionCache } from "@/utils/sessionCache";

const CohortCard = dynamic(() => import("@/components/community/CohortCardContainer"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] h-28 animate-pulse" />
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
      className="relative rounded-xl overflow-hidden bg-[#f6f3f2] border border-[#e4e2e1] p-5 sm:p-6 lg:p-7 flex flex-col md:flex-row items-start md:items-center gap-5 sm:gap-6 group cursor-pointer hover:bg-[#f0eded] transition-colors duration-300"
    >
      <div className="absolute top-0 right-0 p-4">
        <Star className="text-[#795252]/40 w-6 h-6" />
      </div>
      <div className="flex-1 z-10 min-w-0">
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-white border border-[#d4c2c2]/30 text-sage-500 text-xs tracking-wider uppercase mb-4">
          <Bookmark className="w-[14px] h-[14px] mr-1.5" />
          에디터 추천
        </div>
        <h2 className="text-2xl lg:text-3xl font-serif-kr text-[#1b1c1c] mb-3 leading-tight group-hover:text-[#795252] transition-colors break-words line-clamp-3">
          {post.title}
        </h2>
        {contentPreview && (
          <p className="text-[#504444] text-sm sm:text-base mb-6 line-clamp-2">{contentPreview}</p>
        )}
        <div className="flex items-center text-sm text-[#504444] flex-wrap">
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

const trustToolLinks = [
  {
    href: "/community/quote-check",
    eyebrow: "계약 전",
    title: "견적 진단",
    text: "원본·수정본·헬퍼비처럼 뒤늦게 붙는 비용을 먼저 확인해요.",
    icon: FileSearch,
    tone: "bg-[#f3e7e1] text-[#795252]",
  },
  {
    href: "/chat",
    eyebrow: "질문 정리",
    title: "아모라 계약 질문",
    text: "상담 전에 업체에 확인할 질문과 회피 답변 체크포인트를 만들어요.",
    icon: MessageCircle,
    tone: "bg-[#eef2df] text-[#5a6147]",
  },
  {
    href: "/community/post/write?category=is_normal",
    eyebrow: "익명 공유",
    title: "견적 카드 올리기",
    text: "지역, 항목, 포함·미포함을 구조화해서 비슷한 견적과 비교해요.",
    icon: PenLine,
    tone: "bg-[#eef0f5] text-[#56627a]",
  },
  {
    href: "/dashboard",
    eyebrow: "내 준비실",
    title: "리포트 저장",
    text: "진단한 견적과 업체 질문을 예산·일정의 다음 행동으로 이어가요.",
    icon: ClipboardCheck,
    tone: "bg-[#f7efd7] text-[#7b6230]",
  },
  {
    href: "/community/tips_v2",
    eyebrow: "계약 팁",
    title: "체크포인트 모음",
    text: "선배들이 남긴 추가금, 환불, 변경 조건 팁을 먼저 확인해요.",
    icon: ShieldCheck,
    tone: "bg-[#f3e7e1] text-[#795252]",
  },
];

function CommunityTrustToolkit() {
  return (
    <section className="rounded-lg border border-[#e4e2e1] bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#795252] uppercase">
            Trust toolkit
          </p>
          <h2 className="mt-1 font-serif-kr text-2xl text-[#1b1c1c]">
            계약 전 손해를 줄이는 커뮤니티 도구
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[#504444]">
            깊은 개인 관리는 내 준비실에서, 커뮤니티는 견적·계약·업체 신뢰를 빠르게 검증해요.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#795252] hover:text-[#946a6a]"
        >
          내 준비실
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
        {trustToolLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex min-h-[142px] flex-col rounded-lg border border-[#eee6e0] bg-[#fffdfb] p-4 transition-colors hover:bg-[#faf4ef]"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.tone}`}>
                <item.icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-medium text-[#928980]">{item.eyebrow}</span>
            </div>
            <p className="text-[15px] font-semibold text-[#1b1c1c]">{item.title}</p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[#504444]">{item.text}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#795252]">
              열기
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </section>
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
  const errorMessage = useCommunityStore((s) => s.errorMessage);
  const clearError = useCommunityStore((s) => s.clearError);

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
    <div className="min-h-screen bg-[#f8f4f1] flex flex-col">
      {/* 모바일/태블릿: 카테고리 */}
      <div className="xl:hidden px-4 sm:px-6 pt-4 overflow-x-auto">
        <CategoryTabs />
      </div>

      <div className="flex-1 flex w-full max-w-[1920px] mx-auto">
        <aside className="hidden xl:flex bg-[#f8f4f1] h-[calc(100vh-4rem)] w-64 2xl:w-72 sticky top-16 flex-col pt-6 pb-5 px-4 border-r border-[#e4e2e1] z-40 overflow-y-auto">
          <div className="mb-5 px-2">
            <p className="mb-2 text-[11px] font-medium text-[#928980]">
              WEDDING HANBANG
            </p>
            <h2 className="font-serif-kr text-2xl text-[#1b1c1c] mb-1">커뮤니티</h2>
            <p className="text-xs leading-relaxed text-[#504444]">
              견적, 후기, 계약 질문을 함께 검증하는 웨딩 거래 신뢰망
            </p>
          </div>

          {/* 동기방 카드 */}
          <div className="mb-4">
            <CohortCard />
          </div>

          <CategoryTabs />

          <div className="mt-4 px-1">
            <Link
              href="/community/post/write"
              className="w-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white py-2.5 rounded-lg font-medium text-sm shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all duration-200 flex items-center justify-center"
            >
              <PenSquare className="mr-2 w-4 h-4" />
              글쓰기
            </Link>
          </div>

          <div className="mt-5 space-y-1 border-t border-[#e4e2e1]/50 pt-4">
            <Link
              href="/community/about"
              className="flex items-center rounded-lg px-3 py-2 text-[#504444] hover:bg-white hover:text-[#795252] group"
            >
              <Shield className="mr-2.5 w-4 h-4 opacity-60 group-hover:opacity-100" />
              <span className="text-sm">신뢰 원칙</span>
            </Link>
            <Link
              href="/community/my/posts"
              className="flex items-center rounded-lg px-3 py-2 text-[#504444] hover:bg-white hover:text-[#795252] group"
            >
              <Archive className="mr-2.5 w-4 h-4 opacity-60 group-hover:opacity-100" />
              <span className="text-sm">내 기록</span>
            </Link>
          </div>
        </aside>

        {/* 가운데: 메인 피드 */}
        <main className="flex-1 min-w-0 px-4 sm:px-5 xl:px-6 2xl:px-8 py-5 sm:py-6 overflow-y-auto">
          <div className="max-w-[1120px] mx-auto space-y-4 sm:space-y-5">
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

            {!isSearching && !currentTag && (
              <CommunityHero
                postCount={total}
                topVendor={vendorTags[0]?.vendor_name ?? null}
              />
            )}

            {!isSearching && !currentTag && <CommunityTrustLoop />}

            {!isSearching && !currentTag && <CommunityTrustToolkit />}

            {/* 에디터 추천 배너 (태그 필터 중엔 숨김 — featured는 전체 글 기반이라 태그와 안 맞을 수 있음) */}
            {featured && !currentTag && <EditorsPick post={featured} />}

            {/* 피드 헤더 (피드 디바이더) */}
            {!isSearching && (
              <div className="flex flex-col gap-2 border-b border-[#d8d1cc] pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
                <div>
                  <p className="text-xs font-medium text-[#928980]">REAL STORIES</p>
                  <h3 className="font-serif-kr text-xl text-[#1b1c1c] sm:text-2xl">
                    최신 글
                  </h3>
                </div>
                <SortSelector
                  sort={currentSort}
                  period={currentPeriod}
                  onSortChange={(s) => useCommunityStore.getState().setSort(s)}
                  onPeriodChange={(p) => useCommunityStore.getState().setPeriod(p)}
                />
              </div>
            )}

            {!isSearching && <FeedComposer />}

            {!isSearching && errorMessage && (
              <div className="flex flex-col gap-3 rounded-xl border border-[#d9c8c8] bg-white px-4 py-3 text-sm text-[#504444] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-[#795252]" />
                  <span className="break-words">{errorMessage}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => useCommunityStore.getState().fetchPosts(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#795252] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#946a6a]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    다시 불러오기
                  </button>
                  <button
                    type="button"
                    onClick={clearError}
                    className="rounded-lg px-2 py-2 text-xs font-medium text-[#928980] transition-colors hover:bg-[#f6f3f2] hover:text-[#504444]"
                  >
                    닫기
                  </button>
                </div>
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
                  <EmptyFeedStarter />
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

        <aside className="hidden xl:block w-80 2xl:w-[360px] shrink-0 px-4 2xl:px-5 py-6 border-l border-[#e4e2e1] sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto bg-[#f8f4f1]">
          <div className="mb-4 rounded-lg border border-[#e4e2e1] bg-white p-4">
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
            <div className="mt-4 rounded-lg border border-[#e4e2e1] bg-white p-4">
              <h3 className="font-serif-kr text-lg text-[#1b1c1c] mb-3 border-b border-[#e4e2e1] pb-2">
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
          <div className="mt-4">
            <GamificationWidget />
          </div>

          <div className="text-center py-4 mt-4">
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
        className="xl:hidden fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 text-white bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] rounded-full transition-all duration-200"
        aria-label="글쓰기"
      >
        <PenSquare className="w-5 h-5" />
      </Link>

      {/* 커뮤니티 가이드 (첫 방문 시) */}
      <CommunityGuide />
    </div>
  );
}
