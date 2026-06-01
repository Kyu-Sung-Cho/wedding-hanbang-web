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
  AlertCircle,
  Users,
} from "lucide-react";
import AdDisclosureBadge from "@/components/community/AdDisclosureBadge";
import EmptyFeedStarter from "@/components/community/EmptyFeedStarter";
import EmptyState from "@/components/community/EmptyState";
import PostSkeleton from "@/components/community/PostSkeleton";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { getCategoryMarketPrice, getLatestPeriodId } from "@/constants/marketPrices";
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
import {
  FLEX_COHORT_MONTH,
  FLEX_COHORT_YEAR,
  monthToQuarter,
  quarterToMonth,
} from "@/utils/quarter";
import { withSessionCache } from "@/utils/sessionCache";

interface TrendingPost {
  id: string;
  title: string;
  upvote_count: number;
  comment_count: number;
}

interface BestPostPayload {
  posts: TrendingPost[];
}

const shell = "mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8";
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

const topicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  href?: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Heart, label: "전체", helper: "모든 글", href: "/community" },
  { icon: ClipboardList, label: "정상인가요?", helper: "계약·추가금 질문", category: "is_normal" },
  { icon: HeartHandshake, label: "웨딩홀 후기", helper: "홀·식사·견적", query: "웨딩홀", category: "tour_review" },
  { icon: CalendarCheck, label: "스드메 후기", helper: "촬영·드메", query: "스드메", category: "tour_review" },
  { icon: ClipboardList, label: "예산 정보", helper: "가격·견적 비교", query: "예산", category: "is_normal" },
  { icon: Gift, label: "스토리 & 꿀팁", helper: "준비 노하우", category: "tips_v2" },
  { icon: Users, label: "선배 Q&A", helper: "경험자에게 묻기", category: "ama" },
  { icon: MessageCircle, label: "자유", helper: "가벼운 이야기", category: "free" },
  { icon: Megaphone, label: "박람회 & 이벤트", helper: "혜택·일정", query: "박람회" },
  { icon: Award, label: "부케 & 드레스", helper: "스타일 후기", query: "드레스", category: "tour_review" },
  { icon: ClipboardCheck, label: "예단 & 혼수", helper: "양가 준비", query: "예단" },
  { icon: CalendarCheck, label: "신혼여행", helper: "지역·예산", query: "신혼여행" },
];

const cohortPreviewRows = [
  { period: "2026년 1분기 (1~3월)", note: "준비 시작", href: "/community/cohort?year=2026&quarter=1", cta: "입장" },
  { period: "2026년 2분기 (4~6월)", note: "비교 활발", href: "/community/cohort?year=2026&quarter=2", cta: "입장" },
  { period: "2026년 3분기 (7~9월)", note: "예약·후기", href: "/community/cohort?year=2026&quarter=3", cta: "입장" },
  { period: "2026년 4분기 (10~12월)", note: "체크리스트", href: "/community/cohort?year=2026&quarter=4", cta: "입장" },
  { period: "날짜 미정·1년 이후", note: "초반 준비", href: "/community/cohort?timing=later", cta: "입장" },
];

type CohortPanelStatus = "idle" | "checking" | "assigned" | "unauth" | "manual";

interface CohortPanelState {
  status: CohortPanelStatus;
  roomId?: string;
  label?: string;
  note?: string;
}

interface CohortLookupResponse {
  room?: {
    id: string;
    year?: number | null;
    month?: number | null;
    name?: string | null;
  } | null;
}

interface CohortAssignResponse {
  room_id?: string | null;
  reason?: string;
  year?: number | null;
  quarter?: 1 | 2 | 3 | 4;
  flexible?: boolean;
}

function formatCohortLabel(year?: number | null, month?: number | null) {
  if (!year || !month) return "내 동기방";
  if (year === FLEX_COHORT_YEAR && month === FLEX_COHORT_MONTH) {
    return "날짜 미정·1년 이후";
  }
  return `${year}년 ${monthToQuarter(month)}분기 (${month}~${month + 2}월)`;
}

function formatWeddingDateNote(weddingDate?: string | null) {
  if (!weddingDate) return "예정일 미정 기준으로 먼저 배정됐어요.";
  const date = new Date(weddingDate);
  if (Number.isNaN(date.getTime())) return "예정일 기준으로 자동 배정됐어요.";
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 예식 기준`;
}

function hasPossibleAuthSession() {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("demo_mode=true") || document.cookie.includes("sb-");
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
  const selectedCategory = categoryQuery in CATEGORY_MAP
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
  const visiblePosts = isSearching ? searchResults : showFullFeed ? feedPosts : feedPosts.slice(0, 10);
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
      <SearchHub
        searchDraft={searchDraft}
        searchQuery={searchQuery}
        onSearchDraftChange={setSearchDraft}
        onSubmit={submitSearch}
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
        currentPeriod={currentPeriod}
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

function SearchHub({
  searchDraft,
  searchQuery,
  onSearchDraftChange,
  onSubmit,
  selectedCategory,
  currentSort,
  currentPeriod,
  currentTag,
  onSortChange,
  onPeriodChange,
  onClearTag,
}: {
  searchDraft: string;
  searchQuery: string;
  onSearchDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  currentTag: string | null;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
  onClearTag: () => void;
}) {
  const isTopicActive = (item: (typeof topicItems)[number]) => {
    if (item.href === "/community") return !selectedCategory && !searchQuery && !currentTag;
    if (item.query) return searchQuery.includes(item.query);
    if (item.category) return selectedCategory === item.category && !searchQuery;
    return false;
  };

  return (
    <section
      className={`${shell} mt-4 rounded-[18px] border border-[#eadfc9] bg-white/84 px-4 py-4 shadow-[0_10px_30px_rgba(8,22,38,0.04)] md:px-8 md:py-5`}
      data-tutorial-target="community-categories"
    >
      <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="궁금한 정보를 검색해 보세요 (예: 웨딩홀, 스드메, 예산)"
            className="h-[50px] w-full rounded-full border border-[#d8c7ad] bg-white/70 px-5 pr-14 text-[14px] font-medium text-[#061a34] outline-none placeholder:text-[#b49b7c] focus:border-[#36534E] md:px-8 md:text-[15px]"
          />
          <button
            type="submit"
            aria-label="검색"
            className="absolute right-5 top-1/2 -translate-y-1/2 text-[#36534E]"
          >
            <Search className="h-6 w-6" />
          </button>
        </label>
      </form>

      <div className="mt-4 grid grid-flow-col auto-cols-[112px] gap-2 overflow-x-auto pb-1 md:mt-5 md:grid-flow-row md:grid-cols-6 md:auto-cols-auto md:overflow-visible md:pb-0 xl:grid-cols-12">
        {topicItems.map((item) => {
          const active = isTopicActive(item);
          return (
            <Link
              key={item.label}
              href={item.href ?? buildCommunityHubHref(item)}
              aria-label={`${item.label} 보기`}
              className={`group flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-2 text-center transition-all ${
                active
                  ? "border-[#36534E] bg-[#36534E] text-white shadow-[0_10px_22px_rgba(54,83,78,0.14)]"
                  : "border-[#eadfc9] bg-[#fffdf7] text-[#34445a] hover:border-[#b68a3a] hover:bg-white"
              }`}
            >
              <item.icon className={`h-6 w-6 stroke-[1.55] ${active ? "text-white" : "text-[#36534E] group-hover:text-[#9d6f36]"}`} />
              <span className="text-[12px] font-semibold leading-tight">{item.label}</span>
              <span className={`line-clamp-1 text-[10px] font-medium leading-tight ${active ? "text-white/72" : "text-[#7a8290]"}`}>
                {item.helper}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-[#eadfc9] pt-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {currentTag && (
            <button
              type="button"
              onClick={onClearTag}
              className="rounded-full border border-[#eadfc9] bg-[#fbefd6] px-4 py-2 text-[13px] font-medium text-[#9d6f36]"
            >
              #{currentTag} 지우기
            </button>
          )}
          {searchQuery && (
            <Link
              href="/community"
              className="rounded-full border border-[#eadfc9] bg-white px-4 py-2 text-[13px] font-medium text-[#36534E]"
            >
              검색 초기화
            </Link>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">
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
      </div>
    </section>
  );
}

function CommunityMain({
  posts,
  total,
  selectedCategory,
  currentSort,
  currentPeriod,
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
  currentPeriod: TimePeriod;
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
      className={`${shell} mt-4 grid grid-cols-1 items-start gap-[18px] scroll-mt-24 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_360px]`}
    >
      <LatestPosts
        posts={posts}
        total={total}
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        currentPeriod={currentPeriod}
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
  currentPeriod,
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
  currentPeriod: TimePeriod;
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
          ? currentPeriod === "week"
            ? "이번 주 인기글"
            : currentPeriod === "month"
              ? "이번 달 인기글"
              : "좋아요 많은 글"
          : currentSort === "my_cohort"
            ? "내 동기글"
            : currentSort === "my_posts"
              ? "내 글"
              : "최신 글";

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-4 shadow-[0_10px_30px_rgba(8,22,38,0.045)] sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif-kr text-[21px] font-medium leading-[1.3] text-[#071629] sm:text-[22px]">
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
                    ? currentPeriod === "week"
                      ? `최근 7일 좋아요 기준 게시글 ${formatCount(total)}개`
                      : currentPeriod === "month"
                        ? `최근 30일 좋아요 기준 게시글 ${formatCount(total)}개`
                        : `좋아요 기준 게시글 ${formatCount(total)}개`
                    : `실제 게시글 ${formatCount(total)}개`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPreviewFeed && posts.length > 0 && (
            <Link
              href={fullFeedHref}
              className="inline-flex min-h-9 items-center rounded-full border border-[#eadfc9] bg-white px-4 text-[12px] font-medium text-[#9d6f36]"
              aria-label="최신 글 더보기"
            >
              더보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          <Link
            href="/community/post/write"
            className="hidden min-h-9 items-center rounded-full bg-[#061a34] px-4 text-[12px] font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] sm:inline-flex"
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
    <div className="py-2.5">
      <article className="relative overflow-hidden rounded-[14px] border border-[#d8bb86]/80 bg-[linear-gradient(135deg,#fffaf0_0%,#ffffff_62%,#eef4eb_100%)] px-3.5 py-2.5 shadow-[0_8px_18px_rgba(8,22,38,0.04)] sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-white/82 px-2 py-0.5 text-[10px] font-semibold text-[#9d6f36]">
            아모라 추천
          </span>
          <h3 className="mt-1.5 line-clamp-1 font-serif-kr text-[17px] font-medium leading-[1.35] text-[#071629] sm:text-[18px]">
            후기에서 생긴 궁금증, 아모라에게 바로 물어보세요.
          </h3>
        </div>
        <Link
          href="/chat"
          className="group mt-2 inline-flex min-h-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] px-3.5 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(54,83,78,0.14)] transition-transform hover:-translate-y-0.5 sm:mt-0"
        >
          아모라에게 물어보기
          <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </article>
    </div>
  );
}

function CommunityPostRow({ post, priority }: { post: PostWithAuthor; priority?: boolean }) {
  const categoryInfo = CATEGORY_MAP[post.category];
  const { votePost, toggleBookmark } = useCommunityStore();
  const { profile } = useAuthStore();
  const isLoggedIn = !!profile;
  const [optimisticVote, setOptimisticVote] = useState<1 | null | undefined>(undefined);
  const [optimisticUpvoteDelta, setOptimisticUpvoteDelta] = useState(0);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked ?? false);
  const [voting, setVoting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const imageUrl = getPostImage(post);
  const contentPreview = stripHtml(post.content).slice(0, 110);
  const displayVote = optimisticVote === undefined ? (post.user_vote === 1 ? 1 : null) : optimisticVote;
  const displayUpvoteCount = Math.max(0, (post.upvote_count ?? 0) + optimisticUpvoteDelta);
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
    const next: 1 | null = prev === 1 ? null : 1;
    const delta = prev === 1 ? -1 : 1;
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
      className={`relative grid gap-2.5 py-2 first:pt-0 last:pb-0 sm:gap-3 ${
        imageUrl
          ? "grid-cols-[minmax(0,1fr)_72px] sm:grid-cols-[minmax(0,1fr)_104px] xl:grid-cols-[minmax(0,1fr)_112px]"
          : "grid-cols-1"
      }`}
    >
      {toast && (
        <span className="absolute right-0 top-4 z-10 rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}

      <div className="min-w-0">
        <div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-medium text-[#7a8290]">
          <span className="shrink-0 rounded-md bg-[#f6ead9] px-1.5 py-0.5 text-[10px] font-medium text-[#9d6f36]">
            {categoryInfo?.shortLabel ?? "커뮤니티"}
          </span>
          {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
            <AdDisclosureBadge adDisclosure={post.ad_disclosure} size="sm" />
          )}
          {post.is_weekly_best && (
            <span className="shrink-0 rounded-md bg-[#061a34] px-1.5 py-0.5 text-[10px] font-medium text-white">
              BEST
            </span>
          )}
          {post.poll && (
            <span className="shrink-0 rounded-md border border-[#eadfc9] px-1.5 py-0.5 text-[10px] font-medium text-[#7a8290]">
              투표
            </span>
          )}
          <span className="min-w-0 truncate">{post.author?.nickname ?? "익명"}</span>
          <span className="shrink-0">{timeAgo(post.created_at)}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleLike}
              disabled={voting}
              className={`inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 transition-colors ${
                isLiked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#34445a] hover:bg-[#fff8ec]"
              }`}
              aria-label="좋아요"
            >
              <Heart className={`h-3.5 w-3.5 stroke-[1.6] ${isLiked ? "fill-current" : ""}`} />
              {displayUpvoteCount}
            </button>
            <span className="inline-flex items-center gap-0.5 text-[#34445a]">
              <Eye className="h-3.5 w-3.5 stroke-[1.6]" />
              {post.view_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[#34445a]">
              <MessageCircle className="h-3.5 w-3.5 stroke-[1.6]" />
              {(post.comment_count ?? 0) > 0 ? post.comment_count : "첫 댓글"}
            </span>
            <button
              type="button"
              onClick={handleBookmark}
              disabled={bookmarking}
              className={`hidden items-center gap-0.5 rounded-full px-1 py-0.5 transition-colors sm:inline-flex ${
                bookmarked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#34445a] hover:bg-[#fff8ec]"
              }`}
              aria-label="북마크"
            >
              <Bookmark className={`h-3.5 w-3.5 stroke-[1.6] ${bookmarked ? "fill-current" : ""}`} />
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="hidden items-center gap-0.5 rounded-full px-1 py-0.5 text-[#34445a] transition-colors hover:bg-[#fff8ec] sm:inline-flex"
              aria-label="공유"
            >
              <Share2 className="h-3.5 w-3.5 stroke-[1.6]" />
            </button>
          </div>
        </div>
        <h3 className="line-clamp-1 break-words font-serif-kr text-[15px] font-medium leading-[1.32] text-[#071629] [overflow-wrap:anywhere] sm:text-[16px]">
          {post.title}
        </h3>
        {contentPreview && (
          <p className="mt-0.5 line-clamp-1 break-words text-[11px] font-medium leading-[1.5] text-[#5d6879] [overflow-wrap:anywhere]">
            {contentPreview}
          </p>
        )}
      </div>
      {imageUrl && (
        <div className="relative h-[52px] w-[72px] overflow-hidden rounded-[10px] bg-[#f8f4ec] sm:h-[58px] sm:w-[104px] xl:h-[60px] xl:w-[112px]">
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 hover:scale-105"
            sizes="(min-width: 1280px) 112px, (min-width: 640px) 104px, 72px"
            priority={priority}
          />
        </div>
      )}
    </Link>
  );
}

function RightPanels() {
  return (
    <aside
      className="space-y-[18px] lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]"
      data-tutorial-target="community-right"
    >
      <CohortPreviewPanel />
      <BestPostsPanel />
      <MarketSnapshotPanel />
      <AmoraSidebarPanel />
    </aside>
  );
}

function BestPostsPanel() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void withSessionCache("community:landing:weekly-top-posts:5", 5 * 60 * 1000, async () => {
      const normalize = (items: TrendingPost[]) =>
        items.slice(0, 5).map((post: TrendingPost) => ({
          id: post.id,
          title: post.title,
          upvote_count: post.upvote_count,
          comment_count: post.comment_count,
        }));

      const weeklyRes = await fetch("/api/community/posts?sort=top&period=week&limit=5&page=1");
      if (!weeklyRes.ok) return { posts: [] } satisfies BestPostPayload;
      const weeklyJson = await weeklyRes.json();
      return { posts: normalize(weeklyJson.posts ?? []) } satisfies BestPostPayload;
    })
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const title = "이번 주 인기글";
  const moreHref = "/community?sort=top&period=week&feed=all#community-feed";

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
        <p className="text-[13px] font-medium text-[#7a8290]">이번 주 반응을 집계하고 있어요.</p>
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
        최근 7일 좋아요 반응을 기준으로 보여드려요.
      </p>
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
  const periodLabel = `${latestPeriodId.slice(0, 4)}년 ${Number(latestPeriodId.slice(4))}월`;
  const featuredItems: Array<{ label: string; value: number | null; note: string; icon: LucideIcon }> = [
    {
      label: "웨딩홀",
      value: getCategoryMarketPrice("venue"),
      note: "식대+대관 기준",
      icon: Building2,
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
  const marketItems = [...featuredItems, ...detailItems];

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

      <div className="divide-y divide-[#eadfc9] rounded-[14px] border border-[#eadfc9] bg-white/72">
        {marketItems.map((item) => (
          <MarketPriceRow key={item.label} item={item} />
        ))}
      </div>
    </article>
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
  const { profile, journey, isInitialized, isLoading: authLoading } = useAuthStore();
  const [panelState, setPanelState] = useState<CohortPanelState>({ status: "idle" });
  const weddingDate = journey?.wedding_date ?? null;
  const userId = profile?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    async function syncMyCohort() {
      await Promise.resolve();
      if (cancelled) return;

      if (!isInitialized && !authLoading && !hasPossibleAuthSession()) {
        setPanelState({ status: "unauth" });
        return;
      }

      if (!isInitialized || authLoading) {
        setPanelState({ status: "checking", note: "로그인 상태를 확인하고 있어요." });
        return;
      }

      if (!userId) {
        setPanelState({ status: "unauth" });
        return;
      }

      setPanelState({ status: "checking", note: "예정일 기준 동기방을 찾고 있어요." });

      try {
        const currentRes = await fetch("/api/community/cohort", { cache: "no-store" });
        if (currentRes.ok) {
          const currentData = (await currentRes.json()) as CohortLookupResponse;
          if (cancelled) return;

          if (currentData.room?.id) {
            setPanelState({
              status: "assigned",
              roomId: currentData.room.id,
              label: formatCohortLabel(currentData.room.year, currentData.room.month),
              note: formatWeddingDateNote(weddingDate),
            });
            return;
          }
        }

        const assignRes = await fetch("/api/community/cohort/auto-assign", {
          method: "POST",
          credentials: "include",
        });
        const assignData = (await assignRes.json().catch(() => ({}))) as CohortAssignResponse;
        if (cancelled) return;

        if (assignData?.room_id) {
          const assignedMonth = assignData.flexible
            ? FLEX_COHORT_MONTH
            : assignData.quarter
              ? quarterToMonth(assignData.quarter)
              : null;

          setPanelState({
            status: "assigned",
            roomId: assignData.room_id,
            label: formatCohortLabel(assignData.year, assignedMonth),
            note: formatWeddingDateNote(weddingDate),
          });
          return;
        }

        if (assignData?.reason === "unauthenticated") {
          setPanelState({ status: "unauth" });
          return;
        }

        setPanelState({ status: "manual" });
      } catch {
        if (!cancelled) setPanelState({ status: "manual" });
      }
    }

    void syncMyCohort();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isInitialized, userId, weddingDate]);

  return (
    <article
      className="rounded-[18px] border border-[#e5d8ca] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]"
      data-tutorial-target="community-cohort"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#263832]">동기방 함께 준비해요.</h2>
          <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#635b51]">
            비슷한 시기에 결혼을 준비하는 분들과 질문과 후기를 나눠요.
          </p>
        </div>
        <Link href="/community/cohort" className="shrink-0 text-[13px] font-medium text-[#36534E]">
          더보기
        </Link>
      </div>

      {panelState.status === "assigned" && panelState.roomId ? (
        <div className="space-y-3">
          <Link
            href={`/community/cohort/${panelState.roomId}`}
            className="group flex min-h-[82px] items-center gap-3 rounded-[16px] border border-[#36534E]/25 bg-[#EEF4F1] px-4 py-3 transition-colors hover:border-[#36534E]/55 hover:bg-[#e7f0eb]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E] shadow-sm">
              <Users className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-[#36534E]">내 동기방</span>
              <b className="mt-0.5 block truncate font-serif-kr text-[18px] font-medium text-[#263832]">
                {panelState.label}
              </b>
              <span className="mt-1 block truncate text-[12px] font-medium text-[#635b51]">
                {panelState.note}
              </span>
            </span>
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#36534E] px-4 text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(54,83,78,0.16)]">
              입장
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
          <Link
            href="/community/cohort"
            className="flex min-h-10 items-center justify-between rounded-[14px] border border-[#e5d8ca] bg-white px-4 text-[12px] font-semibold text-[#635b51] transition-colors hover:border-[#36534E]/35 hover:text-[#36534E]"
          >
            다른 분기로 바꾸거나 전체 동기방 보기
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <>
          {panelState.status === "checking" && (
            <div className="mb-3 rounded-[14px] border border-[#36534E]/15 bg-[#EEF4F1] px-4 py-3 text-[12px] font-semibold text-[#36534E]">
              {panelState.note ?? "내 동기방을 확인하고 있어요."}
            </div>
          )}
          {panelState.status === "unauth" && (
            <Link
              href={`/login?redirect=${encodeURIComponent("/community/cohort")}`}
              className="mb-3 flex min-h-11 items-center justify-between rounded-[14px] border border-[#36534E]/20 bg-[#EEF4F1] px-4 text-[12px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/45"
            >
              로그인하면 예정일 기준으로 바로 입장해요
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
          <div className="divide-y divide-[#e5d8ca]">
            {cohortPreviewRows.map((row) => (
          <Link
            key={row.period}
            href={row.href}
            className="flex min-h-[52px] items-center gap-3 py-2.5 text-[14px] font-medium text-[#263832] transition-colors hover:bg-[#EEF4F1]"
          >
            <span className="min-w-0 flex-1 truncate">{row.period}</span>
            <span className="hidden text-[12px] font-medium text-[#635b51] sm:inline">{row.note}</span>
            <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#36534E]/30 bg-white px-4 text-[12px] font-semibold text-[#36534E]">
              {row.cta}
            </span>
          </Link>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

