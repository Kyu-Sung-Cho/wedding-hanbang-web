"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  Bookmark,
  Building2,
  CalendarCheck,
  Camera,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Flame,
  Gift,
  Heart,
  HeartHandshake,
  Megaphone,
  MessageCircle,
  Palette,
  PenSquare,
  RefreshCw,
  Search,
  Share2,
  Shirt,
  Sparkles,
  AlertCircle,
  Users,
} from "lucide-react";
import AdDisclosureBadge from "@/components/community/AdDisclosureBadge";
import EmptyFeedStarter from "@/components/community/EmptyFeedStarter";
import EmptyState from "@/components/community/EmptyState";
import FeedComposer from "@/components/community/FeedComposer";
import PostSkeleton from "@/components/community/PostSkeleton";
import { COMMUNITY_CATEGORIES, CATEGORY_MAP } from "@/constants/communityCategories";
import { getCategoryMarketPrice, getLatestPeriodId, getNationalTotal } from "@/constants/marketPrices";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";
import type {
  CommunityCategory,
  CommunityFeedQuery,
  InitialCommunityFeed,
  PostSort,
  PostWithAuthor,
  TimePeriod,
} from "@/types/community.types";
import { timeAgo } from "@/utils/timeAgo";
import { withSessionCache } from "@/utils/sessionCache";

interface VendorTag {
  vendor_name: string;
  mention_count: number;
}

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

interface BestPostPayload {
  mode: "week" | "best";
  posts: TrendingPost[];
}

const shell = "w-full max-w-none px-3 lg:px-5";
const sortValues: PostSort[] = ["new", "hot", "top", "my_cohort", "my_posts"];
const periodValues: TimePeriod[] = ["week", "month", "all"];

const sortLabels: Record<PostSort, string> = {
  hot: "인기순",
  new: "최신순",
  top: "좋아요순",
  my_cohort: "내 동기글",
  my_posts: "내 글",
};

const periodLabels: Record<TimePeriod, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
};

const categoryDisplayLabels: Record<CommunityCategory, string> = {
  is_normal: "정상인가요?",
  tour_review: "후기",
  tips_v2: "꿀팁",
  ama: "선배 Q&A",
  free: "자유",
};

const heroSignals: Array<{ icon: LucideIcon; label: string }> = [
  { icon: HeartHandshake, label: "실제 후기 공유" },
  { icon: CalendarCheck, label: "가격·계약 질문" },
  { icon: Users, label: "동기방 대화" },
  { icon: Heart, label: "함께 준비" },
];

const searchCategories: Array<{ icon: LucideIcon; label: string; query?: string; category?: CommunityCategory }> = [
  { icon: HeartHandshake, label: "웨딩홀 후기", query: "웨딩홀", category: "tour_review" },
  { icon: CalendarCheck, label: "스드메 후기", query: "스드메", category: "tour_review" },
  { icon: ClipboardList, label: "예산 정보", query: "예산", category: "is_normal" },
  { icon: Gift, label: "스토리 & 꿀팁", category: "tips_v2" },
  { icon: Megaphone, label: "박람회 & 이벤트", query: "박람회" },
  { icon: Award, label: "부케 & 드레스", query: "드레스", category: "tour_review" },
  { icon: ClipboardCheck, label: "예단 & 혼수", query: "예단" },
  { icon: CalendarCheck, label: "신혼여행", query: "신혼여행" },
];

const cohortPreviewRows = [
  { period: "2026년 1분기 (1~3월)", note: "준비 시작", href: "/community/cohort?year=2026&quarter=1", cta: "입장" },
  { period: "2026년 2분기 (4~6월)", note: "비교 활발", href: "/community/cohort?year=2026&quarter=2", cta: "입장" },
  { period: "2026년 3분기 (7~9월)", note: "예약·후기", href: "/community/cohort?year=2026&quarter=3", cta: "입장" },
  { period: "2026년 4분기 (10~12월)", note: "체크리스트", href: "/community/cohort?year=2026&quarter=4", cta: "입장" },
  { period: "날짜 미정·하반기 이후", note: "일정 잡기", href: "/onboarding", cta: "설정" },
];

function buildCommunityCategoryHref(category: CommunityCategory) {
  return `/community?category=${category}&feed=all#community-feed`;
}

function formatCount(value: number) {
  return value.toLocaleString("ko-KR");
}

function buildCommunityHubHref(item: { query?: string; category?: CommunityCategory }) {
  const params = new URLSearchParams();
  if (item.query) params.set("search", item.query);
  if (item.category) params.set("category", item.category);
  params.set("feed", "all");
  const query = params.toString();
  return query ? `/community?${query}#community-feed` : "/community#community-feed";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function getPostImage(post: PostWithAuthor) {
  const firstSlide = post.slides?.[0];
  if (firstSlide) {
    if (firstSlide.thumbnail_url) return firstSlide.thumbnail_url;
    if (firstSlide.type === "image") return firstSlide.url;
  }
  if (post.images?.[0]) return post.images[0];
  const inline = post.content.match(/<img\s+[^>]*src=["']([^"']+)["']/i);
  return inline?.[1] ?? null;
}

export default function CommunityLandingClient({
  initialFeed,
  initialQuery = {},
}: {
  initialFeed?: InitialCommunityFeed;
  initialQuery?: CommunityFeedQuery;
}) {
  useCommunityRealtime();

  const router = useRouter();
  const searchQuery = initialQuery.search ?? "";
  const categoryQuery = initialQuery.category ?? "";
  const tagQuery = initialQuery.tag ?? "";
  const authorQuery = initialQuery.author_id ?? "";
  const sortQuery = initialQuery.sort ?? "";
  const periodQuery = initialQuery.period ?? "";
  const feedQuery = initialQuery.feed ?? "";
  const selectedCategory = COMMUNITY_CATEGORIES.some((category) => category.key === categoryQuery)
    ? (categoryQuery as CommunityCategory)
    : null;

  const posts = useCommunityStore((s) => s.posts);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const currentSort = useCommunityStore((s) => s.currentSort);
  const currentPeriod = useCommunityStore((s) => s.currentPeriod);
  const currentTag = useCommunityStore((s) => s.currentTag);
  const total = useCommunityStore((s) => s.total);
  const errorMessage = useCommunityStore((s) => s.errorMessage);
  const clearError = useCommunityStore((s) => s.clearError);

  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [searchResults, setSearchResults] = useState<PostWithAuthor[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [vendorTags, setVendorTags] = useState<VendorTag[]>([]);
  const observerRef = useRef<HTMLDivElement>(null);

  const isSearching = searchQuery.trim().length > 0;
  const normalizedSort = sortValues.includes(sortQuery as PostSort) ? (sortQuery as PostSort) : "new";
  const normalizedPeriod = periodValues.includes(periodQuery as TimePeriod) ? (periodQuery as TimePeriod) : "week";
  const hasFocusedFeed = Boolean(selectedCategory || tagQuery || authorQuery || isSearching);
  const showFullFeed = feedQuery === "all" || hasFocusedFeed;
  const canUseInitialFeed =
    !isSearching &&
    !selectedCategory &&
    !tagQuery &&
    !authorQuery &&
    normalizedSort === "new" &&
    normalizedPeriod === "week" &&
    posts.length === 0 &&
    Boolean(initialFeed?.posts.length);
  const feedPosts = canUseInitialFeed ? (initialFeed?.posts ?? []) : posts;
  const visiblePosts = isSearching ? searchResults : showFullFeed ? feedPosts : feedPosts.slice(0, 6);
  const activeTotal = isSearching ? searchTotal : canUseInitialFeed ? (initialFeed?.total ?? 0) : total;
  const isPreviewFeed = !isSearching && !showFullFeed;
  const fullFeedHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (authorQuery) params.set("author_id", authorQuery);
    params.set("sort", normalizedSort);
    if (normalizedSort === "top") params.set("period", normalizedPeriod);
    params.set("feed", "all");
    return `/community?${params.toString()}#community-feed`;
  }, [authorQuery, normalizedPeriod, normalizedSort, selectedCategory, tagQuery]);
  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const store = useCommunityStore.getState();
    if (store.currentSort !== normalizedSort) store.setSort(normalizedSort);
    if (store.currentPeriod !== normalizedPeriod) store.setPeriod(normalizedPeriod);
  }, [normalizedPeriod, normalizedSort]);

  useEffect(() => {
    if (!isSearching) {
      setSearchResults([]);
      setSearchPage(1);
      setSearchTotal(0);
      setSearchHasMore(false);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchPage(1);

    const params = new URLSearchParams({
      q: searchQuery,
      page: "1",
      limit: "20",
    });
    if (selectedCategory) params.set("category", selectedCategory);

    fetch(`/api/community/search?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setSearchResults(data.posts ?? []);
        setSearchHasMore(data.hasMore ?? false);
        setSearchTotal(data.total ?? 0);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setSearchResults([]);
        setSearchHasMore(false);
        setSearchTotal(0);
      })
      .finally(() => setSearchLoading(false));

    return () => controller.abort();
  }, [isSearching, searchQuery, selectedCategory]);

  const fetchMoreSearchResults = useCallback(() => {
    if (!isSearching || searchLoading || !searchHasMore) return;
    const nextPage = searchPage + 1;
    const params = new URLSearchParams({
      q: searchQuery,
      page: String(nextPage),
      limit: "20",
    });
    if (selectedCategory) params.set("category", selectedCategory);
    setSearchLoading(true);
    fetch(`/api/community/search?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        setSearchResults((prev) => [...prev, ...(data.posts ?? [])]);
        setSearchHasMore(data.hasMore ?? false);
        setSearchPage(nextPage);
      })
      .catch(() => {})
      .finally(() => setSearchLoading(false));
  }, [isSearching, searchHasMore, searchLoading, searchPage, searchQuery, selectedCategory]);

  useEffect(() => {
    if (!canUseInitialFeed || !initialFeed) return;
    useCommunityStore.getState().hydrateInitialFeed(initialFeed);
  }, [canUseInitialFeed, initialFeed]);

  useEffect(() => {
    if (isSearching) return;
    const store = useCommunityStore.getState();
    store.setCategory(selectedCategory);
    store.setTag(tagQuery || null);
    store.setAuthorId(authorQuery || null);
    store.fetchPosts(true);
  }, [authorQuery, currentPeriod, currentSort, isSearching, selectedCategory, tagQuery]);

  useEffect(() => {
    let cancelled = false;
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

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (!entry.isIntersecting) return;

      if (isSearching) {
        fetchMoreSearchResults();
        return;
      }

      if (!showFullFeed) return;

      const state = useCommunityStore.getState();
      if (state.hasMore && !state.isLoading) {
        state.fetchMorePosts();
      }
    },
    [fetchMoreSearchResults, isSearching, showFullFeed]
  );

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: "260px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchDraft.trim();
    if (!trimmed) {
      router.push("/community");
      return;
    }
    router.push(`/community?search=${encodeURIComponent(trimmed)}#community-feed`);
  }

  function setSort(nextSort: PostSort) {
    useCommunityStore.getState().setSort(nextSort);
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (authorQuery) params.set("author_id", authorQuery);
    params.set("sort", nextSort);
    if (nextSort === "top") params.set("period", currentPeriod);
    if (showFullFeed) params.set("feed", "all");
    router.push(`/community?${params.toString()}`, { scroll: false });
  }

  function setPeriod(nextPeriod: TimePeriod) {
    useCommunityStore.getState().setPeriod(nextPeriod);
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (authorQuery) params.set("author_id", authorQuery);
    params.set("sort", "top");
    params.set("period", nextPeriod);
    if (showFullFeed) params.set("feed", "all");
    router.push(`/community?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_50%,#fbf8ee_100%)] text-[#061a34]">
      <Hero topVendor={vendorTags[0]?.vendor_name ?? null} />
      <SearchHub searchDraft={searchDraft} onSearchDraftChange={setSearchDraft} onSubmit={submitSearch} />
      <CategoryBar
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        currentPeriod={currentPeriod}
        currentTag={currentTag}
        onSortChange={setSort}
        onPeriodChange={setPeriod}
        onClearTag={() => router.push("/community")}
      />
      <CommunityMain
        posts={visiblePosts}
        total={activeTotal}
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        searchQuery={searchQuery}
        isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && visiblePosts.length === 0 : isLoading}
        errorMessage={isSearching ? null : errorMessage}
        clearError={clearError}
      />
      <div ref={observerRef} className="h-1" />
      <Link
        href="/community/post/write"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#061a34] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5 md:hidden"
        aria-label="글쓰기"
        data-tutorial-target="community-write"
      >
        <PenSquare className="h-5 w-5" />
      </Link>
    </div>
  );
}

function Hero({ topVendor }: { topVendor: string | null }) {
  return (
    <section className={`${shell} relative grid grid-cols-1 items-center gap-6 pt-4 md:min-h-[465px] md:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.1fr)] md:gap-10 xl:min-h-[500px] xl:gap-16`}>
      <div className="relative z-10 py-6 md:py-8">
        <p className="mb-4 flex items-center gap-2 text-[14px] font-medium text-[#26364a] md:mb-6 md:text-[15px]">
          예비부부가 함께 만드는 결혼 준비의 모든 것
          <Sparkles className="h-4 w-4 text-[#b68a3a]" />
        </p>

        <h1 className="font-serif-kr text-[34px] font-medium leading-[1.35] text-[#061a34] sm:text-[36px] xl:text-[52px]">
          경험을 나누고,
          <br />
          더 완벽한 <span className="block text-[#b68a3a] sm:inline">결혼을 준비해요.</span>
        </h1>

        <p className="mt-5 text-[15px] font-medium leading-[1.85] text-[#38475c] md:mt-7 md:text-[16px]">
          실제 후기와 정보로 현명하게 준비하고,
          <br />
          서로 돕고 나누며 행복한 결혼을 만들어 가요.
        </p>

        <div className="mt-6 grid max-w-[590px] grid-cols-4 gap-1 md:mt-8">
          {heroSignals.map((item, index) => (
            <div
              key={item.label}
              className={`flex min-h-[66px] flex-col items-center justify-center gap-[7px] px-1 text-center text-[11px] font-medium leading-snug text-[#34445a] md:min-h-[76px] md:gap-[9px] md:px-3 md:text-[12px] ${
                index < heroSignals.length - 1 ? "border-r border-[#eadfc9]" : ""
              }`}
            >
              <item.icon className="h-6 w-6 stroke-[1.55] text-[#b68a3a] md:h-8 md:w-8" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {topVendor && (
          <p className="mt-5 text-[12px] font-semibold text-[#7a8290]">
            지금 많이 언급되는 업체: <span className="text-[#9d6f36]">{topVendor}</span>
          </p>
        )}
      </div>

      <div className="relative min-h-[260px] self-stretch overflow-hidden rounded-[28px] bg-[url('/images/amora-hero-bouquet-custom.png')] bg-cover bg-[position:center_48%] shadow-[inset_36px_0_56px_rgba(255,253,247,0.88)] md:min-h-[420px] md:rounded-bl-[64px] md:rounded-br-none md:rounded-tr-none xl:min-h-[470px]">
        <div className="absolute inset-y-0 left-0 w-[26%] bg-[linear-gradient(90deg,#fffdf7,rgba(255,253,247,0))]" />
        <div className="absolute inset-x-0 bottom-0 h-[36%] bg-[linear-gradient(0deg,rgba(255,253,247,0.82),rgba(255,253,247,0))]" />
      </div>
    </section>
  );
}

function SearchHub({
  searchDraft,
  onSearchDraftChange,
  onSubmit,
}: {
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className={`${shell} rounded-[18px] border border-[#eadfc9] bg-white/80 px-4 py-4 shadow-[0_10px_30px_rgba(8,22,38,0.04)] md:px-8 md:py-5`}>
      <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="궁금한 정보를 검색해 보세요 (예: 웨딩홀, 스드메, 예산)"
            className="h-[50px] w-full rounded-full border border-[#d8c7ad] bg-white/70 px-5 pr-14 text-[14px] font-medium text-[#061a34] outline-none placeholder:text-[#b49b7c] focus:border-[#b68a3a] md:px-8 md:text-[15px]"
          />
          <button
            type="submit"
            aria-label="검색"
            className="absolute right-5 top-1/2 -translate-y-1/2 text-[#9d6f36]"
          >
            <Search className="h-6 w-6" />
          </button>
        </label>
      </form>

      <div className="mt-4 flex gap-4 overflow-x-auto pb-1 md:mt-6 md:grid md:grid-cols-8 md:gap-0 md:overflow-visible md:pb-0">
        {searchCategories.map((item, index) => (
          <Link
            key={item.label}
            href={buildCommunityHubHref(item)}
            aria-label={`${item.label} 보기`}
            className={`flex min-w-[82px] flex-col items-center gap-2 text-center text-[12px] font-medium text-[#34445a] transition-colors hover:text-[#b68a3a] md:min-w-0 ${
              index < searchCategories.length - 1 ? "md:border-r md:border-[#eadfc9]" : ""
            }`}
          >
            <item.icon className="h-7 w-7 stroke-[1.55] text-[#b68a3a] md:h-8 md:w-8" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CategoryBar({
  selectedCategory,
  currentSort,
  currentPeriod,
  currentTag,
  onSortChange,
  onPeriodChange,
  onClearTag,
}: {
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  currentTag: string | null;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
  onClearTag: () => void;
}) {
  return (
    <section
      className={`${shell} mt-3 flex flex-nowrap items-center gap-3 overflow-x-auto rounded-[16px] border border-[#eadfc9] bg-white/82 p-3 shadow-[0_8px_22px_rgba(8,22,38,0.035)] md:flex-wrap md:overflow-visible`}
      data-tutorial-target="community-categories"
    >
      <Link
        href="/community"
        className={`min-w-[74px] shrink-0 rounded-full border px-5 py-3 text-center text-[14px] font-medium transition-colors ${
          selectedCategory
            ? "border-[#eadfc9] bg-white/70 text-[#34445a] hover:border-[#b68a3a] hover:text-[#b68a3a]"
            : "border-[#061a34] bg-[#061a34] text-white"
        }`}
      >
        전체
      </Link>
      {COMMUNITY_CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={buildCommunityCategoryHref(cat.key)}
          className={`min-w-[84px] shrink-0 rounded-full border px-5 py-3 text-center text-[14px] font-medium transition-colors ${
            selectedCategory === cat.key
              ? "border-[#061a34] bg-[#061a34] text-white"
              : "border-[#eadfc9] bg-white/70 text-[#34445a] hover:border-[#b68a3a] hover:text-[#b68a3a]"
          }`}
        >
          {cat.shortLabel}
        </Link>
      ))}
      {currentTag && (
        <button
          type="button"
          onClick={onClearTag}
          className="rounded-full border border-[#eadfc9] bg-[#fbefd6] px-4 py-3 text-[13px] font-medium text-[#9d6f36]"
        >
          #{currentTag} 지우기
        </button>
      )}

      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">정렬</span>
          <select
            value={currentSort}
            onChange={(event) => onSortChange(event.target.value as PostSort)}
            className="h-11 appearance-none rounded-full border border-[#eadfc9] bg-white/70 px-5 pr-10 text-[14px] font-medium text-[#34445a] outline-none focus:border-[#b68a3a]"
          >
            {sortValues.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabels[sort]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b68a3a]" />
        </label>
        {currentSort === "top" && (
          <label className="relative">
          <span className="sr-only">좋아요 기간</span>
            <select
              value={currentPeriod}
              onChange={(event) => onPeriodChange(event.target.value as TimePeriod)}
              className="h-11 appearance-none rounded-full border border-[#eadfc9] bg-white/70 px-5 pr-10 text-[14px] font-medium text-[#34445a] outline-none focus:border-[#b68a3a]"
            >
              {periodValues.map((period) => (
                <option key={period} value={period}>
                  {periodLabels[period]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b68a3a]" />
          </label>
        )}
      </div>
    </section>
  );
}

function CommunityMain({
  posts,
  total,
  selectedCategory,
  currentSort,
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
}) {
  return (
    <section
      id="community-feed"
      className={`${shell} mt-4 grid grid-cols-1 items-start gap-[18px] scroll-mt-24 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]`}
    >
      <LatestPosts
        posts={posts}
        total={total}
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        searchQuery={searchQuery}
        isLoading={isLoading}
        errorMessage={errorMessage}
        clearError={clearError}
      />
      <RightPanels />
    </section>
  );
}

function LatestPosts({
  posts,
  total,
  selectedCategory,
  currentSort,
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
}) {
  const feedTitle = isSearching
    ? "검색 결과"
    : selectedCategory
      ? `${categoryDisplayLabels[selectedCategory]} 글`
      : currentSort === "hot"
        ? "인기 글"
        : currentSort === "top"
          ? "좋아요 많은 글"
          : currentSort === "my_cohort"
            ? "내 동기글"
            : currentSort === "my_posts"
              ? "내 글"
              : "최신 글";

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
            {feedTitle}
          </h2>
          <p className="mt-1 text-[12px] font-medium text-[#7a8290]">
            {isSearching
              ? `"${searchQuery}" ${formatCount(total)}건`
              : isPreviewFeed
                ? `최근 글 ${formatCount(posts.length)}개를 먼저 보여드려요`
                : currentSort === "hot"
                  ? `반응이 높은 게시글 ${formatCount(total)}개`
                  : currentSort === "top"
                    ? `좋아요 기준 게시글 ${formatCount(total)}개`
                    : `실제 게시글 ${formatCount(total)}개`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPreviewFeed && posts.length > 0 && (
            <Link
              href={fullFeedHref}
              className="inline-flex min-h-10 items-center rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-medium text-[#9d6f36]"
              aria-label="최신 글 더보기"
            >
              더보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          <Link
            href="/community/post/write"
            className="hidden min-h-10 items-center rounded-full bg-[#061a34] px-5 text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] sm:inline-flex"
            data-tutorial-target="community-write"
          >
            글쓰기
            <PenSquare className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-sm text-[#34445a] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#9d6f36]" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => useCommunityStore.getState().fetchPosts(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#061a34] px-3 py-2 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시 불러오기
            </button>
            <button
              type="button"
              onClick={clearError}
              className="rounded-full px-3 py-2 text-xs font-semibold text-[#7a8290] hover:bg-white"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {isLoading && posts.length === 0 ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <PostSkeleton key={index} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        isSearching ? (
          <EmptyState
            message={`"${searchQuery}"에 대한 검색 결과가 없습니다`}
            description="다른 키워드로 검색해 보세요."
          />
        ) : (
          <EmptyFeedStarter />
        )
      ) : (
        <div className="divide-y divide-[#eadfc9]">
          {posts.map((post, index) => (
            <Fragment key={post.id}>
              <CommunityPostRow post={post} priority={index < 2} />
              {!isSearching && index === 1 && <AmoraInlinePromo />}
              {!isSearching && !isPreviewFeed && index === 0 && (
                <div className="py-4" data-tutorial-target="community-composer">
                  <FeedComposer />
                </div>
              )}
            </Fragment>
          ))}
          {isPreviewFeed && posts.length > 0 && (
            <div className="flex justify-center py-5">
              <Link
                href={fullFeedHref}
                className="inline-flex min-h-11 items-center rounded-full border border-[#eadfc9] bg-white px-6 text-[13px] font-semibold text-[#9d6f36] transition-colors hover:border-[#b68a3a] hover:text-[#7f562a]"
                aria-label="최신 글 전체 보기"
              >
                최신 글 더보기
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
          )}
          {!isSearching && posts.length > 0 && <FeedActionBoard />}
          {!isPreviewFeed && isLoading && (
            <div className="space-y-4 py-4">
              {Array.from({ length: 2 }).map((_, index) => (
                <PostSkeleton key={`more-${index}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AmoraInlinePromo() {
  return (
    <div className="py-4">
      <article className="relative overflow-hidden rounded-[18px] border border-[#d8bb86] bg-[linear-gradient(135deg,#fff8ec_0%,#ffffff_48%,#eef4eb_100%)] p-5 shadow-[0_14px_34px_rgba(8,22,38,0.06)] md:grid md:grid-cols-[minmax(0,1fr)_280px] md:items-center md:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative z-10">
          <span className="inline-flex rounded-full bg-white/78 px-3 py-1 text-[12px] font-semibold text-[#9d6f36]">
            아모라 추천
          </span>
          <h3 className="mt-3 font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629] md:text-[27px]">
            후기에서 생긴 궁금증, 아모라에게 바로 물어보세요.
          </h3>
          <p className="mt-3 max-w-[760px] text-[14px] font-medium leading-[1.75] text-[#5d6879]">
            자동으로 견적에 적용되는 기능이 아니라, 커뮤니티에서 본 내용을 바탕으로 아모라 상담을 시작하는 흐름이에요.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-[12px] font-semibold text-[#34445a]">
            {["내 상황 설명하기", "비슷한 질문 정리", "시세 화면 함께 보기"].map((item) => (
              <span key={item} className="rounded-full border border-[#eadfc9] bg-white/72 px-3 py-1.5">
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="relative z-10 mt-5 grid gap-3 md:mt-0">
          <Link
            href="/chat"
            className="group flex min-h-[58px] items-center justify-between rounded-[14px] bg-[#36534E] px-4 text-[13px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.18)] transition-transform hover:-translate-y-0.5"
          >
            아모라에게 물어보기
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/market-prices"
            className="group flex min-h-[54px] items-center justify-between rounded-[14px] border border-[#eadfc9] bg-white/82 px-4 text-[13px] font-semibold text-[#34445a] transition-colors hover:border-[#b68a3a]"
          >
            요즘 시세 먼저 보기
            <ChevronRight className="h-4 w-4 text-[#b68a3a] transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <ClipboardCheck className="pointer-events-none absolute -bottom-7 right-8 hidden h-[130px] w-[130px] rotate-6 text-[#c9a96e]/20 lg:block" />
      </article>
    </div>
  );
}

function FeedActionBoard() {
  const actions: Array<{ href: string; title: string; desc: string; icon: LucideIcon }> = [
    {
      href: "/community/post/write",
      title: "질문 글로 남기기",
      desc: "커뮤니티에 공개 질문으로 남겨요.",
      icon: PenSquare,
    },
    {
      href: "/community/cohort",
      title: "동기방에서 비교하기",
      desc: "같은 시기 예비부부의 선택 기준을 같이 봐요.",
      icon: Users,
    },
    {
      href: "/lounge",
      title: "라운지에 정리하기",
      desc: "마음에 둔 내용은 일정과 예산으로 이어가요.",
      icon: CalendarCheck,
    },
  ];

  return (
    <div className="border-t border-[#eadfc9] py-5" data-tutorial-target="community-service-link">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <span className="text-[12px] font-semibold text-[#9d6f36]">다음 행동</span>
          <h3 className="mt-1 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">
            읽은 글을 바로 준비로 이어가요.
          </h3>
        </div>
        <Link href="/lounge" className="hidden text-[13px] font-semibold text-[#9d6f36] sm:inline-flex">
          라운지 열기
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {actions.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="group min-h-[118px] rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-4 transition-colors hover:border-[#b68a3a]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#36534E]">
              <item.icon className="h-[18px] w-[18px]" />
            </span>
            <b className="mt-3 block text-[14px] font-semibold text-[#071629]">{item.title}</b>
            <span className="mt-1.5 block text-[12px] font-medium leading-[1.6] text-[#7a8290]">{item.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CommunityPostRow({ post, priority }: { post: PostWithAuthor; priority?: boolean }) {
  const categoryInfo = CATEGORY_MAP[post.category];
  const { votePost, toggleBookmark } = useCommunityStore();
  const { profile } = useAuthStore();
  const isLoggedIn = !!profile;
  const [optimisticVote, setOptimisticVote] = useState<1 | -1 | null | undefined>(undefined);
  const [optimisticUpvoteDelta, setOptimisticUpvoteDelta] = useState(0);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);
  const [voting, setVoting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const imageUrl = getPostImage(post);
  const contentPreview = stripHtml(post.content).slice(0, 160);
  const displayVote = optimisticVote === undefined ? (post.user_vote ?? null) : optimisticVote;
  const displayUpvoteCount = (post.upvote_count ?? 0) + optimisticUpvoteDelta;
  const isLiked = displayVote === 1;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }

  async function handleLike(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!isLoggedIn) {
      showToast("로그인이 필요해요");
      return;
    }
    if (voting) return;
    const prev = displayVote;
    let next: 1 | null;
    let delta = 0;
    if (prev === 1) {
      next = null;
      delta = -1;
    } else if (prev === -1) {
      next = 1;
      delta = 2;
    } else {
      next = 1;
      delta = 1;
    }
    setOptimisticVote(next);
    setOptimisticUpvoteDelta((value) => value + delta);
    setVoting(true);
    try {
      await votePost(post.id, next === null ? 0 : next);
    } catch {
      setOptimisticVote(prev);
      setOptimisticUpvoteDelta((value) => value - delta);
    } finally {
      setVoting(false);
    }
  }

  async function handleBookmark(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!isLoggedIn) {
      showToast("로그인이 필요해요");
      return;
    }
    if (bookmarking) return;
    setBookmarked((value) => !value);
    setBookmarking(true);
    try {
      await toggleBookmark(post.id);
    } finally {
      setBookmarking(false);
    }
  }

  async function handleShare(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const url = `${window.location.origin}/community/post/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("링크가 복사됐어요");
    } catch {
      showToast("공유 링크를 만들지 못했어요");
    }
  }

  return (
    <Link
      href={`/community/post/${post.id}`}
      className="relative grid grid-cols-[82px_1fr] gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[164px_1fr] sm:gap-5 xl:grid-cols-[210px_1fr] 2xl:grid-cols-[248px_1fr]"
    >
      {toast && (
        <span className="absolute right-0 top-4 z-10 rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}
      <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-[#f8f4ec] sm:aspect-[1.55]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 hover:scale-105"
            sizes="(min-width: 1536px) 248px, (min-width: 1280px) 210px, (min-width: 640px) 164px, 82px"
            priority={priority}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#fff8ec] text-[#b68a3a]">
            <HeartHandshake className="h-7 w-7 stroke-[1.5]" />
            <span className="text-[12px] font-medium">{categoryInfo?.shortLabel ?? "커뮤니티"}</span>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-md bg-[#f6ead9] px-2 py-1 text-[12px] font-medium text-[#9d6f36]">
            {categoryInfo?.shortLabel ?? "커뮤니티"}
          </span>
          {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
            <AdDisclosureBadge adDisclosure={post.ad_disclosure} size="sm" />
          )}
          {post.is_weekly_best && (
            <span className="shrink-0 rounded-md bg-[#061a34] px-2 py-1 text-[11px] font-medium text-white">
              BEST
            </span>
          )}
          {post.poll && (
            <span className="shrink-0 rounded-md border border-[#eadfc9] px-2 py-1 text-[11px] font-medium text-[#7a8290]">
              투표
            </span>
          )}
          <Sparkles className="ml-auto h-4 w-4 shrink-0 text-[#b68a3a]" />
        </div>
        <h3 className="line-clamp-2 break-words font-serif-kr text-[19px] font-medium leading-[1.35] text-[#071629] [overflow-wrap:anywhere] sm:text-[22px]">
          {post.title}
        </h3>
        {contentPreview && (
          <p className="mt-2 line-clamp-2 break-words text-[13px] font-medium leading-[1.7] text-[#5d6879] [overflow-wrap:anywhere] sm:text-[14px]">
            {contentPreview}
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2 text-[12px] font-medium text-[#7a8290] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate">{post.author?.nickname ?? "익명"}</span>
            <span className="shrink-0">{timeAgo(post.created_at)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={handleLike}
              disabled={voting}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
                isLiked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#34445a] hover:bg-[#fff8ec]"
              }`}
              aria-label="좋아요"
            >
              <Heart className={`h-4 w-4 stroke-[1.6] ${isLiked ? "fill-current" : ""}`} />
              {displayUpvoteCount}
            </button>
            <span className="inline-flex items-center gap-1 text-[#34445a]">
              <Eye className="h-4 w-4 stroke-[1.6]" />
              {post.view_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-1 text-[#34445a]">
              <MessageCircle className="h-4 w-4 stroke-[1.6]" />
              {(post.comment_count ?? 0) > 0 ? post.comment_count : "첫 댓글"}
            </span>
            <button
              type="button"
              onClick={handleBookmark}
              disabled={bookmarking}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
                bookmarked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#34445a] hover:bg-[#fff8ec]"
              }`}
              aria-label="북마크"
            >
              <Bookmark className={`h-4 w-4 stroke-[1.6] ${bookmarked ? "fill-current" : ""}`} />
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[#34445a] transition-colors hover:bg-[#fff8ec]"
              aria-label="공유"
            >
              <Share2 className="h-4 w-4 stroke-[1.6]" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

function RightPanels() {
  return (
    <div className="space-y-[18px]" data-tutorial-target="community-right">
      <CohortPreviewPanel />
      <BestPostsPanel />
      <CommunityQuickPanel />
      <MarketSnapshotPanel />
      <AmoraSidebarPanel />
    </div>
  );
}

function BestPostsPanel() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [mode, setMode] = useState<"week" | "best">("week");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void withSessionCache("community:landing:weekly-or-best-posts:5", 5 * 60 * 1000, async () => {
      const normalize = (items: TrendingPost[]) =>
        items.slice(0, 5).map((post: TrendingPost) => ({
          id: post.id,
          title: post.title,
          upvote_count: post.upvote_count,
          comment_count: post.comment_count,
        }));

      const weeklyRes = await fetch("/api/community/posts?sort=top&period=week&limit=5&page=1");
      if (weeklyRes.ok) {
        const weeklyJson = await weeklyRes.json();
        const weeklyPosts = normalize(weeklyJson.posts ?? []);
        if (weeklyPosts.length > 0) return { mode: "week", posts: weeklyPosts } satisfies BestPostPayload;
      }

      const bestRes = await fetch("/api/community/posts?sort=top&period=all&limit=5&page=1");
      if (!bestRes.ok) return { mode: "best", posts: [] } satisfies BestPostPayload;
      const bestJson = await bestRes.json();
      return { mode: "best", posts: normalize(bestJson.posts ?? []) } satisfies BestPostPayload;
    })
      .then((data) => {
        if (cancelled) return;
        setMode(data.mode);
        setPosts(data.posts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const title = mode === "week" ? "이번주 인기글" : "BEST 글";
  const moreHref =
    mode === "week"
      ? "/community?sort=top&period=week&feed=all#community-feed"
      : "/community?sort=top&period=all&feed=all#community-feed";

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
          {title} <Flame className="inline h-5 w-5 fill-[#f26a3d] text-[#f26a3d]" />
        </h2>
        <Link href={moreHref} className="text-[13px] font-medium text-[#9d6f36]">
          더보기
        </Link>
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-7 animate-pulse rounded-md bg-[#f3eadc]" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-[13px] font-medium text-[#7a8290]">인기글을 집계하고 있어요.</p>
      ) : (
        <ol className="space-y-3">
          {posts.map((post, index) => (
            <li key={post.id}>
              <Link
                href={`/community/post/${post.id}`}
                className="grid grid-cols-[24px_1fr_auto] items-center gap-3 text-[13px] font-medium"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#c9a96e] text-[12px] font-semibold text-white">
                  {index + 1}
                </span>
                <span className="truncate text-[#34445a]">{post.title}</span>
                <strong className="text-[#071629]">{formatCount(post.upvote_count)}</strong>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-5 border-t border-[#eadfc9] pt-4 text-center text-[12px] font-medium text-[#9aa2af]">
        {mode === "week" ? "최근 7일 좋아요 반응을 기준으로 보여드려요." : "누적 좋아요 반응을 기준으로 보여드려요."}
      </p>
    </article>
  );
}

function CommunityQuickPanel() {
  const quickLinks: Array<{ href: string; title: string; desc: string; icon: LucideIcon }> = [
    {
      href: "/community?category=is_normal&feed=all#community-feed",
      title: "정상인가요?",
      desc: "헷갈리는 준비 상황 먼저 확인",
      icon: ClipboardCheck,
    },
    {
      href: "/community/post/write",
      title: "질문 남기기",
      desc: "답답한 부분을 바로 물어보기",
      icon: PenSquare,
    },
    {
      href: "/community/my/bookmarks",
      title: "북마크",
      desc: "다시 볼 글만 모아보기",
      icon: Bookmark,
    },
  ];

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <h2 className="font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">바로 할 일</h2>
      <div className="mt-4 grid gap-2">
        {quickLinks.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="group flex items-center justify-between gap-3 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-3 py-3 transition-colors hover:border-[#b68a3a]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#b68a3a]">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <b className="block truncate text-[13px] font-semibold text-[#071629]">{item.title}</b>
                <span className="mt-0.5 block truncate text-[12px] font-medium text-[#7a8290]">{item.desc}</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#b68a3a] transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </article>
  );
}

function AmoraSidebarPanel() {
  return (
    <article className="overflow-hidden rounded-[18px] border border-[#d8bb86] bg-[linear-gradient(145deg,#fffdf8_0%,#ffffff_58%,#eef4eb_100%)] p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <span className="inline-flex rounded-full bg-white/78 px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
        아모라에게 묻기
      </span>
      <h2 className="mt-3 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">
        아모라에게 이 글 물어보기
      </h2>
      <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
        커뮤니티 글이 자동으로 내 견적에 반영되는 기능은 아니에요. 아모라 상담으로 이동해 상황을 설명하고 질문을 이어가는 카드입니다.
      </p>
      <Link
        href="/chat"
        className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-[#36534E] px-4 text-[13px] font-semibold text-white shadow-[0_10px_22px_rgba(54,83,78,0.16)]"
      >
        아모라에게 바로 묻기
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

function MarketSnapshotPanel() {
  const latestPeriodId = getLatestPeriodId();
  const nationalTotal = getNationalTotal(latestPeriodId);
  const periodLabel = `${latestPeriodId.slice(0, 4)}년 ${Number(latestPeriodId.slice(4))}월`;
  const featuredItems: Array<{ label: string; value: number | null; note: string; icon: LucideIcon }> = [
    {
      label: "웨딩홀",
      value: getCategoryMarketPrice("venue"),
      note: "식대+대관 기준",
      icon: Building2,
    },
    {
      label: "스드메",
      value: nationalTotal.sdm,
      note: "전국 평균",
      icon: Camera,
    },
  ];
  const detailItems: Array<{ label: string; value: number | null; note: string; icon: LucideIcon }> = [
    {
      label: "스튜디오",
      value: getCategoryMarketPrice("studio"),
      note: "기본가",
      icon: Camera,
    },
    {
      label: "드레스",
      value: getCategoryMarketPrice("dress"),
      note: "본식",
      icon: Shirt,
    },
    {
      label: "메이크업",
      value: getCategoryMarketPrice("makeup"),
      note: "촬영",
      icon: Palette,
    },
  ];

  return (
    <article className="overflow-hidden rounded-[18px] border border-[#eadfc9] bg-[linear-gradient(145deg,#fffdf8_0%,#ffffff_55%,#fbf4e8_100%)] p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex rounded-full bg-[#fbefd6] px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
            {periodLabel} 기준
          </span>
          <h2 className="mt-2 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">
            요즘 시세
          </h2>
          <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#7a8290]">
            전국 평균으로 대략 감만 먼저 잡아보세요.
          </p>
        </div>
        <Link
          href="/market-prices"
          className="inline-flex h-9 shrink-0 items-center rounded-full border border-[#eadfc9] bg-white px-3 text-[12px] font-semibold text-[#9d6f36]"
        >
          자세히
          <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {featuredItems.map((item) => (
          <MarketPriceTile key={item.label} item={item} />
        ))}
      </div>

      <div className="mt-3 divide-y divide-[#eadfc9] rounded-[14px] border border-[#eadfc9] bg-white/72">
        {detailItems.map((item) => (
          <MarketPriceRow key={item.label} item={item} />
        ))}
      </div>
    </article>
  );
}

function MarketPriceTile({
  item,
}: {
  item: { label: string; value: number | null; note: string; icon: LucideIcon };
}) {
  return (
    <Link
      href="/market-prices"
      className="group min-h-[118px] rounded-[14px] border border-[#eadfc9] bg-white/78 p-3 transition-colors hover:border-[#b68a3a]"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#fff8ec] text-[#b68a3a]">
        <item.icon className="h-4 w-4" />
      </span>
      <span className="mt-3 block text-[12px] font-semibold text-[#34445a]">{item.label}</span>
      <span className="mt-1 block font-serif-kr text-[22px] font-medium leading-none text-[#071629]">
        약 {formatMarketPrice(item.value)}
      </span>
      <span className="mt-1 block text-[11px] font-medium text-[#9aa2af]">{item.note}</span>
    </Link>
  );
}

function MarketPriceRow({
  item,
}: {
  item: { label: string; value: number | null; note: string; icon: LucideIcon };
}) {
  return (
    <Link href="/market-prices" className="group flex min-h-[54px] items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8ec] text-[#b68a3a]">
          <item.icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-[13px] font-semibold text-[#071629]">{item.label}</b>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-[#7a8290]">{item.note}</span>
        </span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold text-[#34445a] group-hover:text-[#9d6f36]">
        약 {formatMarketPrice(item.value)}
      </span>
    </Link>
  );
}

function formatMarketPrice(value: number | null): string {
  if (!value) return "-";
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()}만원`;
}

function CohortPreviewPanel() {
  return (
    <article
      className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]"
      data-tutorial-target="community-cohort"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">동기방 함께 준비해요.</h2>
          <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
            비슷한 시기에 결혼을 준비하는 분들과 질문과 후기를 나눠요.
          </p>
        </div>
        <Link href="/community/cohort" className="shrink-0 text-[13px] font-medium text-[#9d6f36]">
          더보기
        </Link>
      </div>
      <div className="divide-y divide-[#eadfc9]">
        {cohortPreviewRows.map((row) => (
          <Link
            key={row.period}
            href={row.href}
            className="flex min-h-[52px] items-center gap-3 py-2.5 text-[14px] font-medium text-[#34445a] transition-colors hover:bg-[#fff8ec]"
          >
            <span className="min-w-0 flex-1 truncate">{row.period}</span>
            <span className="hidden text-[12px] font-medium text-[#7a8290] sm:inline">{row.note}</span>
            <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#d8bb86] bg-white px-4 text-[12px] font-semibold text-[#9d6f36]">
              {row.cta}
            </span>
          </Link>
        ))}
      </div>
    </article>
  );
}

