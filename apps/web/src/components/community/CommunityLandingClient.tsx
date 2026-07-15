"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
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
import { useAuthStore } from "@/stores/authStore";
import { useCommunityStore } from "@/stores/communityStore";
import type {
  CommunityCategory,
  CommunityFeedQuery,
  InitialCommunityFeedResult,
  PostSort,
  PostWithAuthor,
  TimePeriod,
} from "@/types/community.types";
import { timeAgo } from "@/utils/timeAgo";
import { communityPostLinkProps, communityPostUrl, isCommunityCategory } from "@/lib/community/routes";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { withSessionCache } from "@/utils/sessionCache";
import { communityHtmlToPlainText } from "@hanbang/shared";

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
const sortValues: PostSort[] = [
  "new",
  "hot",
  "top",
  "my_posts",
];
const periodValues: TimePeriod[] = ["week", "month", "all"];

const sortLabels: Record<PostSort, string> = {
  hot: "인기순",
  new: "최신순",
  top: "좋아요순",
  my_posts: "내 글",
};

const periodLabels: Record<TimePeriod, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
};

const categoryDisplayLabels: Record<CommunityCategory, string> = {
  is_normal: "계약·추가금 질문",
  tour_review: "후기",
  tips_v2: "꿀팁",
  ama: "선배 Q&A",
  free: "자유",
};

const primaryTopicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  href?: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Heart, label: "전체", helper: "모든 글", href: "/community" },
  { icon: ClipboardList, label: "계약·추가금 질문", helper: "원문 확인 질문", category: "is_normal" },
  { icon: HeartHandshake, label: "후기", helper: "투어·이용 경험", category: "tour_review" },
  { icon: Gift, label: "스토리 & 꿀팁", helper: "준비 노하우", category: "tips_v2" },
  { icon: Users, label: "선배 Q&A", helper: "경험자에게 묻기", category: "ama" },
  { icon: MessageCircle, label: "자유", helper: "가벼운 이야기", category: "free" },
];

const detailTopicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Building2, label: "웨딩홀", helper: "홀·식사·견적", query: "웨딩홀", category: "tour_review" },
  { icon: Camera, label: "스드메", helper: "촬영·드레스·메이크업", query: "스드메", category: "tour_review" },
  { icon: ClipboardList, label: "예산", helper: "계약 조건 질문", query: "예산", category: "is_normal" },
  { icon: Megaphone, label: "박람회", helper: "혜택·일정", query: "박람회" },
  { icon: Shirt, label: "드레스", helper: "스타일 후기", query: "드레스", category: "tour_review" },
  { icon: ClipboardCheck, label: "예단·혼수", helper: "양가 준비", query: "예단" },
  { icon: CalendarCheck, label: "신혼여행", helper: "지역·예산", query: "신혼여행" },
];

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

export default function CommunityLandingClient({
  initialFeed,
  initialQuery = {},
}: {
  initialFeed?: InitialCommunityFeedResult;
  initialQuery?: CommunityFeedQuery;
}) {

  const router = useRouter();
  const searchQuery = initialQuery.search ?? "";
  const categoryQuery = initialQuery.category ?? "";
  const tagQuery = initialQuery.tag ?? "";
  const authorQuery = initialQuery.author_id ?? "";
  const sortQuery = initialQuery.sort ?? "";
  const periodQuery = initialQuery.period ?? "";
  const feedQuery = initialQuery.feed ?? "";
  const selectedCategory = isCommunityCategory(categoryQuery) ? categoryQuery : null;

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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchErrorKind, setSearchErrorKind] = useState<"initial" | "more" | null>(null);
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [initialFeedAvailable, setInitialFeedAvailable] = useState(true);
  const [initialFeedError, setInitialFeedError] = useState<string | null>(
    initialFeed?.status === "unavailable" ? initialFeed.message : null,
  );
  const observerRef = useRef<HTMLDivElement>(null);
  const searchRequestSequenceRef = useRef(0);
  const searchResultKeyRef = useRef("");
  const searchMoreControllerRef = useRef<AbortController | null>(null);

  const isSearching = searchQuery.trim().length > 0;
  const normalizedSort = sortValues.includes(sortQuery as PostSort) ? (sortQuery as PostSort) : "new";
  const normalizedPeriod = periodValues.includes(periodQuery as TimePeriod) ? (periodQuery as TimePeriod) : "week";
  const hasFocusedFeed = Boolean(selectedCategory || tagQuery || authorQuery || isSearching);
  const showFullFeed = feedQuery === "all" || hasFocusedFeed;
  const readyInitialFeed = initialFeed?.status === "ready" ? initialFeed.feed : undefined;
  const canUseInitialFeed =
    initialFeedAvailable &&
    !isSearching &&
    !selectedCategory &&
    !tagQuery &&
    !authorQuery &&
    normalizedSort === "new" &&
    normalizedPeriod === "week" &&
    posts.length === 0 &&
    readyInitialFeed !== undefined;
  const feedPosts = canUseInitialFeed ? (readyInitialFeed?.posts ?? []) : posts;
  const visiblePosts = isSearching ? searchResults : showFullFeed ? feedPosts : feedPosts.slice(0, 10);
  const activeTotal = isSearching ? searchTotal : canUseInitialFeed ? (readyInitialFeed?.total ?? 0) : total;
  const isPreviewFeed = !isSearching && !showFullFeed;
  const fullFeedHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (authorQuery) params.set("author_id", authorQuery);
    params.set("sort", normalizedSort);
    if (normalizedSort === "top") params.set("period", normalizedPeriod);
    params.set("feed", "all");
    return weddingPath(`/community?${params.toString()}#community-feed`);
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
    const requestSequence = ++searchRequestSequenceRef.current;
    searchMoreControllerRef.current?.abort();
    searchMoreControllerRef.current = null;
    if (!isSearching) {
      searchResultKeyRef.current = "";
      setSearchResults([]);
      setSearchPage(1);
      setSearchTotal(0);
      setSearchHasMore(false);
      setSearchError(null);
      setSearchErrorKind(null);
      setSearchLoading(false);
      return;
    }

    const requestKey = `${searchQuery}\u0000${selectedCategory ?? ""}`;
    if (searchResultKeyRef.current !== requestKey) {
      searchResultKeyRef.current = requestKey;
      setSearchResults([]);
      setSearchTotal(0);
      setSearchHasMore(false);
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchPage(1);
    setSearchError(null);
    setSearchErrorKind(null);

    const params = new URLSearchParams({
      q: searchQuery,
      page: "1",
      limit: "20",
    });
    if (selectedCategory) params.set("category", selectedCategory);

    void fetch(`/api/community/search?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) return res.json();
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "검색 결과를 불러오지 못했어요.");
      })
      .then((data) => {
        if (requestSequence !== searchRequestSequenceRef.current) return;
        if (!Array.isArray(data?.posts)) throw new Error("검색 결과를 불러오지 못했어요.");
        setSearchResults(data.posts);
        setSearchHasMore(data.hasMore ?? false);
        setSearchTotal(data.total ?? 0);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (requestSequence !== searchRequestSequenceRef.current) return;
        setSearchError(err instanceof Error && err.message ? err.message : "검색 결과를 불러오지 못했어요.");
        setSearchErrorKind("initial");
      })
      .finally(() => {
        if (requestSequence === searchRequestSequenceRef.current) setSearchLoading(false);
      });

    return () => {
      controller.abort();
      searchMoreControllerRef.current?.abort();
    };
  }, [isSearching, searchQuery, searchRetryKey, selectedCategory]);

  const fetchMoreSearchResults = useCallback(() => {
    if (!isSearching || searchLoading || !searchHasMore) return;
    const requestKey = `${searchQuery}\u0000${selectedCategory ?? ""}`;
    const nextPage = searchPage + 1;
    const params = new URLSearchParams({
      q: searchQuery,
      page: String(nextPage),
      limit: "20",
    });
    if (selectedCategory) params.set("category", selectedCategory);
    const controller = new AbortController();
    searchMoreControllerRef.current?.abort();
    searchMoreControllerRef.current = controller;
    setSearchLoading(true);
    setSearchError(null);
    setSearchErrorKind(null);
    void fetch(`/api/community/search?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.ok) return res.json();
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "추가 검색 결과를 불러오지 못했어요.");
      })
      .then((data) => {
        if (searchResultKeyRef.current !== requestKey) return;
        if (!Array.isArray(data?.posts)) throw new Error("추가 검색 결과를 불러오지 못했어요.");
        setSearchResults((previous) => {
          const seen = new Set(previous.map((post) => post.id));
          return [...previous, ...data.posts.filter((post: PostWithAuthor) => !seen.has(post.id))];
        });
        setSearchHasMore(data.hasMore ?? false);
        setSearchPage(nextPage);
      })
      .catch((error) => {
        if (error?.name === "AbortError" || searchResultKeyRef.current !== requestKey) return;
        setSearchError(
          error instanceof Error && error.message
            ? error.message
            : "추가 검색 결과를 불러오지 못했어요."
        );
        setSearchErrorKind("more");
      })
      .finally(() => {
        if (searchResultKeyRef.current === requestKey && searchMoreControllerRef.current === controller) {
          searchMoreControllerRef.current = null;
          setSearchLoading(false);
        }
      });
  }, [isSearching, searchHasMore, searchLoading, searchPage, searchQuery, selectedCategory]);

  const retrySearchError = useCallback(() => {
    if (searchErrorKind === "more") {
      fetchMoreSearchResults();
      return;
    }
    setSearchRetryKey((key) => key + 1);
  }, [fetchMoreSearchResults, searchErrorKind]);

  useEffect(() => {
    if (!initialFeedAvailable) return;
    // SSR data is a one-time mount seed. Consuming it again after an auth
    // reset would overwrite the new identity's vote/bookmark projections and
    // invalidate the authenticated refresh request.
    setInitialFeedAvailable(false);
    if (!canUseInitialFeed || !readyInitialFeed) return;
    useCommunityStore.getState().hydrateInitialFeed(readyInitialFeed);
  }, [canUseInitialFeed, initialFeedAvailable, readyInitialFeed]);

  useEffect(() => {
    if (isSearching) return;
    const store = useCommunityStore.getState();
    store.setCategory(selectedCategory);
    store.setTag(tagQuery || null);
    store.setAuthorId(authorQuery || null);
    void store.fetchPosts(true).then(() => {
      if (!useCommunityStore.getState().errorMessage) setInitialFeedError(null);
    });
  }, [authorQuery, currentPeriod, currentSort, isSearching, selectedCategory, tagQuery]);

  const retryFeedError = useCallback(() => {
    void useCommunityStore.getState().fetchPosts(true).then(() => {
      if (!useCommunityStore.getState().errorMessage) setInitialFeedError(null);
    });
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
      router.push(weddingPath());
      return;
    }
    router.push(weddingPath(`/community?search=${encodeURIComponent(trimmed)}#community-feed`));
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
    router.push(weddingPath(`/community?${params.toString()}`), { scroll: false });
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
    router.push(weddingPath(`/community?${params.toString()}`), { scroll: false });
  }

  return (
    <div className="bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_50%,#fbf8ee_100%)] text-[#061a34]">
      <PreparationFlowHero />
      <SearchHub
        searchDraft={searchDraft}
        searchQuery={searchQuery}
        onSearchDraftChange={setSearchDraft}
        onSubmit={submitSearch}
        selectedCategory={selectedCategory}
        currentTag={currentTag}
        onClearTag={() => router.push(weddingPath())}
      />
      <CommunityMain
        posts={visiblePosts}
        total={activeTotal}
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        currentPeriod={currentPeriod}
        onSortChange={setSort}
        onPeriodChange={setPeriod}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        searchQuery={searchQuery}
        isLoading={
          isSearching
            ? searchLoading
            : isPreviewFeed
              ? isLoading && visiblePosts.length === 0 && !canUseInitialFeed
              : isLoading
        }
        errorMessage={isSearching ? searchError : errorMessage ?? initialFeedError}
        retryError={
          isSearching
            ? retrySearchError
            : retryFeedError
        }
        retryLabel={
          isSearching
            ? searchErrorKind === "more"
              ? "추가 결과 다시 불러오기"
              : "검색 다시 시도"
            : "다시 불러오기"
        }
        clearError={
          isSearching
            ? () => {
                setSearchError(null);
                setSearchErrorKind(null);
              }
            : initialFeedError
              ? undefined
              : clearError
        }
      />
      <div ref={observerRef} className="h-1" />
      <Link
        {...weddingLinkProps("/community/post/write")}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#061a34] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5 md:hidden"
        aria-label="글쓰기"
        data-tutorial-target="community-write"
      >
        <PenSquare className="h-5 w-5" />
      </Link>
    </div>
  );
}

// 커뮤니티 경험과 사용자가 직접 확정한 준비 기록의 역할을 분리해 보여준다.
function PreparationFlowHero() {
  return (
    <section className={`${shell} mt-4`}>
      <article className="overflow-hidden rounded-[18px] border border-[#d8bb86] bg-[linear-gradient(135deg,#fffdf8_0%,#ffffff_52%,#eef4f1_100%)] px-5 py-5 shadow-[0_10px_30px_rgba(8,22,38,0.05)] md:px-8 md:py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
              <ClipboardCheck className="h-3.5 w-3.5" />
              경험은 참고 · 확정 사실은 내 기록으로
            </span>
            <h1 className="mt-2.5 font-serif-kr text-[26px] font-medium leading-[1.3] text-[#071629] md:text-[30px]">
              후기는 커뮤니티에서 찾고, 확정한 내용은 내 준비표에 기록하세요
            </h1>
            <p className="mt-2 max-w-xl text-[13px] font-medium leading-[1.65] text-[#5d6879] md:text-[14px]">
              다른 이용자의 글과 공개 시세는 비교 질문을 찾는 참고 자료예요. 실제 일정과
              금액은 업체 원문으로 확인한 뒤 일정·예산에 직접 기록하세요.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
            <Link
              {...weddingLinkProps("/schedule")}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642]"
            >
              내 일정 기록하기
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              {...weddingLinkProps("/budget")}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#36534E]/30 bg-white px-6 text-[13px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/60"
            >
              내 예산 기록하기
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}

function SearchHub({
  searchDraft,
  searchQuery,
  onSearchDraftChange,
  onSubmit,
  selectedCategory,
  currentTag,
  onClearTag,
}: {
  searchDraft: string;
  searchQuery: string;
  onSearchDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selectedCategory: CommunityCategory | null;
  currentTag: string | null;
  onClearTag: () => void;
}) {
  const [detailOpen, setDetailOpen] = useState(() =>
    detailTopicItems.some((item) => item.query && searchQuery.includes(item.query))
  );
  const isTopicActive = (item: (typeof primaryTopicItems)[number] | (typeof detailTopicItems)[number]) => {
    if ("href" in item && item.href === "/community") return !selectedCategory && !searchQuery && !currentTag;
    if (item.query) return searchQuery.includes(item.query);
    if (item.category) return selectedCategory === item.category && !searchQuery;
    return false;
  };
  const activeDetailCount = detailTopicItems.filter(isTopicActive).length;

  return (
    <section className={`${shell} mt-4`}>
      <div
        className="rounded-[18px] border border-[#eadfc9] bg-white/84 px-4 py-4 shadow-[0_10px_30px_rgba(8,22,38,0.04)] md:px-8 md:py-5"
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
            className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#36534E] transition-colors hover:bg-[#EEF4F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534E]"
          >
            <Search className="h-6 w-6" />
          </button>
        </label>
      </form>

      <div className="mt-4 flex flex-col gap-3 md:mt-5">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {primaryTopicItems.map((item) => {
            const active = isTopicActive(item);
            return (
              <Link
                key={item.label}
                {...weddingLinkProps(item.href ?? buildCommunityHubHref(item))}
                aria-label={`${item.label} 보기`}
                className={`group flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[14px] border px-2 text-center transition-all sm:px-3 ${
                  active
                    ? "border-[#36534E] bg-[#36534E] text-white shadow-[0_10px_22px_rgba(54,83,78,0.14)]"
                    : "border-[#eadfc9] bg-[#fffdf7] text-[#34445a] hover:border-[#b68a3a] hover:bg-white"
                }`}
              >
                <item.icon className={`h-5 w-5 stroke-[1.65] ${active ? "text-white" : "text-[#36534E] group-hover:text-[#9d6f36]"}`} />
                <span className="text-[12px] font-semibold leading-tight">{item.label}</span>
                <span className={`hidden text-[10px] font-medium leading-tight sm:block ${active ? "text-white/72" : "text-[#7a8290]"}`}>
                  {item.helper}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="flex items-center justify-center border-t border-[#eadfc9] pt-3 md:justify-between">
          <p className="hidden text-[12px] font-medium text-[#7a8290] md:block">
            먼저 큰 분류로 보고, 필요할 때만 세부 주제로 좁혀보세요.
          </p>
          <button
            type="button"
            onClick={() => setDetailOpen((open) => !open)}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
              detailOpen || activeDetailCount > 0
                ? "border-[#36534E] bg-[#eef4f1] text-[#36534E]"
                : "border-[#eadfc9] bg-white text-[#36534E] hover:border-[#36534E]/40"
            }`}
            aria-expanded={detailOpen}
          >
            세부 주제
            {activeDetailCount > 0 && (
              <span className="rounded-full bg-[#36534E] px-1.5 py-0.5 text-[10px] text-white">
                {activeDetailCount}
              </span>
            )}
            <ChevronDown className={`h-4 w-4 transition-transform ${detailOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {detailOpen && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#eadfc9] pt-3 sm:grid-cols-3 lg:grid-cols-7">
          {detailTopicItems.map((item) => {
          const active = isTopicActive(item);
          return (
            <Link
              key={item.label}
              {...weddingLinkProps(buildCommunityHubHref(item))}
              aria-label={`${item.label} 보기`}
              className={`group flex min-h-[58px] items-center gap-2 rounded-[14px] border px-3 text-left transition-all ${
                active
                  ? "border-[#36534E] bg-[#36534E] text-white shadow-[0_10px_22px_rgba(54,83,78,0.14)]"
                  : "border-[#eadfc9] bg-[#fffdf7] text-[#34445a] hover:border-[#36534E]/35 hover:bg-white"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? "bg-white/16" : "bg-[#eef4f1]"}`}>
                <item.icon className={`h-4 w-4 stroke-[1.65] ${active ? "text-white" : "text-[#36534E]"}`} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold leading-tight">{item.label}</span>
                <span className={`mt-0.5 block truncate text-[10px] font-medium leading-tight ${active ? "text-white/72" : "text-[#7a8290]"}`}>
                  {item.helper}
                </span>
              </span>
            </Link>
          );
        })}
        </div>
      )}

      {(currentTag || searchQuery) && (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-[#eadfc9] pt-3">
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
              {...weddingLinkProps()}
              className="rounded-full border border-[#eadfc9] bg-white px-4 py-2 text-[13px] font-medium text-[#36534E]"
            >
              검색 초기화
            </Link>
          )}
        </div>
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
  currentPeriod,
  onSortChange,
  onPeriodChange,
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  retryError,
  retryLabel,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  retryError: () => void;
  retryLabel: string;
  clearError?: () => void;
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
        onSortChange={onSortChange}
        onPeriodChange={onPeriodChange}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        searchQuery={searchQuery}
        isLoading={isLoading}
        errorMessage={errorMessage}
        retryError={retryError}
        retryLabel={retryLabel}
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
  onSortChange,
  onPeriodChange,
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  retryError,
  retryLabel,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  retryError: () => void;
  retryLabel: string;
  clearError?: () => void;
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
          : currentSort === "my_posts"
              ? "내 글"
              : "최신 글";
  const feedMoreLabel = `${feedTitle} 더보기`;
  const previewDescription = isSearching
    ? isLoading && posts.length === 0
      ? `"${searchQuery}" 검색 중`
      : errorMessage && posts.length === 0
        ? `"${searchQuery}" 검색 결과를 불러오지 못했어요`
        : `"${searchQuery}" ${formatCount(total)}건`
    : selectedCategory
      ? `${categoryDisplayLabels[selectedCategory]} 게시글 ${formatCount(total)}개`
      : currentSort === "hot"
        ? `반응이 높은 게시글 ${formatCount(total)}개`
        : currentSort === "top"
          ? currentPeriod === "week"
            ? `최근 7일 좋아요 기준 게시글 ${formatCount(total)}개`
            : currentPeriod === "month"
              ? `최근 30일 좋아요 기준 게시글 ${formatCount(total)}개`
              : `좋아요 기준 게시글 ${formatCount(total)}개`
          : currentSort === "my_posts"
              ? `내가 쓴 게시글 ${formatCount(total)}개`
              : isPreviewFeed
                ? `최근 글 ${formatCount(posts.length)}개를 먼저 보여드려요`
                : `실제 게시글 ${formatCount(total)}개`;

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-4 shadow-[0_10px_30px_rgba(8,22,38,0.045)] sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif-kr text-[21px] font-medium leading-[1.3] text-[#071629] sm:text-[22px]">
            {feedTitle}
          </h2>
          <p className="mt-1 text-[12px] font-medium text-[#7a8290]">
            {previewDescription}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isSearching && (
            <>
              <label className="relative">
                <span className="sr-only">정렬</span>
                <select
                  value={currentSort}
                  onChange={(event) => onSortChange(event.target.value as PostSort)}
                  className="h-10 w-[100px] appearance-none rounded-full border border-[#eadfc9] bg-white px-4 pr-8 font-sans text-[13px] font-semibold leading-none text-[#34445a] outline-none focus:border-[#b68a3a]"
                >
                  {sortValues.map((sort) => (
                    <option key={sort} value={sort}>
                      {sortLabels[sort]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b68a3a]" />
              </label>
              {currentSort === "top" && (
                <label className="relative">
                  <span className="sr-only">좋아요 기간</span>
                  <select
                    value={currentPeriod}
                    onChange={(event) => onPeriodChange(event.target.value as TimePeriod)}
                    className="h-10 w-[100px] appearance-none rounded-full border border-[#eadfc9] bg-white px-4 pr-8 font-sans text-[13px] font-semibold leading-none text-[#34445a] outline-none focus:border-[#b68a3a]"
                  >
                    {periodValues.map((period) => (
                      <option key={period} value={period}>
                        {periodLabels[period]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b68a3a]" />
                </label>
              )}
            </>
          )}
          {isPreviewFeed && posts.length > 0 && (
            <Link
              {...weddingLinkProps(fullFeedHref)}
            className="inline-flex h-11 w-[100px] items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-4 font-sans text-[13px] font-semibold leading-none text-[#9d6f36]"
              aria-label={feedMoreLabel}
            >
              더보기
              <ChevronRight className="h-4 w-4 shrink-0" />
            </Link>
          )}
          <Link
            {...weddingLinkProps("/community/post/write")}
            className="hidden h-10 w-[100px] items-center justify-center gap-1.5 rounded-full bg-[#061a34] px-4 font-sans text-[13px] font-semibold leading-none text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] sm:inline-flex"
            data-tutorial-target="community-write"
          >
            글쓰기
            <PenSquare className="h-4 w-4 shrink-0" />
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
              onClick={retryError}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#061a34] px-3 py-2 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {retryLabel}
            </button>
            {clearError && posts.length > 0 && (
              <button
                type="button"
                onClick={clearError}
                className="min-h-11 rounded-full px-3 py-2 text-xs font-semibold text-[#7a8290] hover:bg-white"
              >
                닫기
              </button>
            )}
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
        errorMessage ? null : isSearching ? (
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
              <CommunityPostRow post={post} />
              {!isSearching && index === 1 && <AmoraInlinePromo />}
            </Fragment>
          ))}
          {isPreviewFeed && posts.length > 0 && (
            <div className="flex justify-center py-5">
              <Link
                {...weddingLinkProps(fullFeedHref)}
                className="inline-flex min-h-11 items-center rounded-full border border-[#eadfc9] bg-white px-6 text-[13px] font-semibold text-[#9d6f36] transition-colors hover:border-[#b68a3a] hover:text-[#7f562a]"
                aria-label={`${feedTitle} 전체 보기`}
              >
                {feedMoreLabel}
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
            아모라 상담
          </span>
          <h3 className="mt-1.5 line-clamp-1 font-serif-kr text-[17px] font-medium leading-[1.35] text-[#071629] sm:text-[18px]">
            후기에서 필요한 문장을 붙여 넣어 아모라에게 물어보세요.
          </h3>
          <p className="mt-1 text-[11px] font-medium text-[#7a8290]">
            아모라는 현재 글을 자동으로 읽지 않아요.
          </p>
        </div>
        <Link
          {...weddingLinkProps("/chat")}
          className="group mt-2 inline-flex min-h-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] px-3.5 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(54,83,78,0.14)] transition-transform hover:-translate-y-0.5 sm:mt-0"
        >
          아모라에게 물어보기
          <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </article>
    </div>
  );
}

function CommunityPostRow({ post }: { post: PostWithAuthor }) {
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
  const contentPreview = communityHtmlToPlainText(post.content).slice(0, 110);
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
    const previous = bookmarked;
    setBookmarked(!previous);
    setBookmarking(true);
    try {
      const ok = await toggleBookmark(post.id, !previous);
      if (!ok) {
        setBookmarked(previous);
        showToast("북마크를 저장하지 못했어요. 다시 시도해주세요.");
      }
    } finally {
      setBookmarking(false);
    }
  }

  async function handleShare(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const url = communityPostUrl(window.location.origin, post.id);
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
      {...communityPostLinkProps(post.id)}
      className="relative grid grid-cols-1 gap-2.5 py-2 first:pt-0 last:pb-0 sm:gap-3"
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
              주간 인기
            </span>
          )}
          {post.poll && (
            <span className="shrink-0 rounded-md border border-[#eadfc9] px-1.5 py-0.5 text-[10px] font-medium text-[#7a8290]">
              투표
            </span>
          )}
          <span className="min-w-0 truncate">{post.author.nickname}</span>
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
              {post.comment_count ?? 0}
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
          <p className="ugc-text mt-0.5 line-clamp-1 break-words text-[11px] font-medium leading-[1.5] text-[#5d6879] [overflow-wrap:anywhere]">
            {contentPreview}
          </p>
        )}
      </div>
    </Link>
  );
}

function RightPanels() {
  return (
    <aside
      className="space-y-[18px] lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]"
      data-tutorial-target="community-right"
    >
      <BestPostsPanel />
      <MarketSnapshotPanel />
      <AmoraSidebarPanel />
    </aside>
  );
}

function BestPostsPanel() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5_000);
    void withSessionCache("community:landing:weekly-top-posts:5", 5 * 60 * 1000, async () => {
      const normalize = (items: TrendingPost[]) =>
        items.slice(0, 5).map((post: TrendingPost) => ({
          id: post.id,
          title: post.title,
          upvote_count: post.upvote_count,
          comment_count: post.comment_count,
        }));

      const weeklyRes = await fetch(
        "/api/community/posts?sort=top&period=week&limit=5&page=1",
        { signal: controller.signal },
      );
      if (!weeklyRes.ok) throw new Error(`weekly posts ${weeklyRes.status}`);
      const weeklyJson = await weeklyRes.json();
      return { posts: normalize(weeklyJson.posts ?? []) } satisfies BestPostPayload;
    })
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPosts([]);
        setStatus("error");
      })
      .finally(() => window.clearTimeout(timeoutId));
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [reloadKey]);

  const title = "이번 주 인기글";
  const moreHref = weddingPath("/community?sort=top&period=week&feed=all#community-feed");

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
          {title} <Flame className="inline h-5 w-5 fill-[#f26a3d] text-[#f26a3d]" />
        </h2>
        <Link {...weddingLinkProps(moreHref)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-[#9d6f36]">
          더보기
        </Link>
      </div>
      <div className="min-h-[168px]" aria-live="polite">
        {status === "loading" ? (
          <p className="text-[13px] font-medium text-[#7a8290]">인기글을 불러오고 있어요.</p>
        ) : status === "error" ? (
          <div role="alert">
            <p className="text-[13px] font-medium text-[#7a8290]">인기글을 불러오지 못했어요.</p>
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setReloadKey((key) => key + 1);
              }}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#eadfc9] px-3 text-[12px] font-semibold text-[#36534E]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              인기글 다시 불러오기
            </button>
          </div>
        ) : posts.length === 0 ? (
          <p className="text-[13px] font-medium text-[#7a8290]">최근 7일 좋아요 반응이 있는 글이 아직 없어요.</p>
        ) : (
          <ol className="space-y-3">
            {posts.map((post, index) => (
              <li key={post.id}>
                <Link
                  {...communityPostLinkProps(post.id)}
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
      </div>
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
        아모라에게 필요한 부분 묻기
      </h2>
      <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
        아모라는 현재 글을 자동으로 읽지 않아요. 필요한 문장을 직접 붙여 넣어 주세요.
      </p>
      <Link
        {...weddingLinkProps("/chat")}
        className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-[#36534E] px-4 text-[13px] font-semibold text-white shadow-[0_10px_22px_rgba(54,83,78,0.16)]"
      >
        아모라 상담 열기
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

function MarketSnapshotPanel() {
  return (
    <article className="overflow-hidden rounded-[18px] border border-[#eadfc9] bg-[linear-gradient(145deg,#fffdf8_0%,#ffffff_55%,#fbf4e8_100%)] p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <span className="inline-flex rounded-full bg-[#fbefd6] px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
        공식 조사 자료
      </span>
      <h2 className="mt-3 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">
        가격 숫자는 한 화면에서만 확인하세요
      </h2>
      <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
        커뮤니티 경험담과 공식 조사값을 섞지 않습니다. 조사월·지역·포함 항목·통계 단위를 함께 확인해 주세요.
      </p>
      <Link
        {...weddingLinkProps("/market-prices")}
        className="mt-4 flex min-h-11 items-center justify-between rounded-full border border-[#eadfc9] bg-white px-4 text-[13px] font-semibold text-[#9d6f36]"
      >
        공식 가격 조사 보기
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

