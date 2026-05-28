"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  Bookmark,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Gift,
  Heart,
  HeartHandshake,
  Megaphone,
  MessageCircle,
  PenSquare,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import AdDisclosureBadge from "@/components/community/AdDisclosureBadge";
import EmptyFeedStarter from "@/components/community/EmptyFeedStarter";
import EmptyState from "@/components/community/EmptyState";
import FeedComposer from "@/components/community/FeedComposer";
import PostSkeleton from "@/components/community/PostSkeleton";
import { COMMUNITY_CATEGORIES, CATEGORY_MAP } from "@/constants/communityCategories";
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

const shell = "mx-auto w-[calc(100%_-_32px)] max-w-[1480px] md:w-[calc(100%_-_56px)]";
const sortValues: PostSort[] = ["hot", "new", "top", "my_cohort", "my_posts"];
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

const journeyActions: Array<{ icon: LucideIcon; title: string; desc: string; href: string; primary?: boolean }> = [
  {
    icon: Search,
    title: "후기 찾기",
    desc: "지역·업체 경험 먼저 확인",
    href: "/community?feed=all#community-feed",
    primary: true,
  },
  {
    icon: MessageCircle,
    title: "아모라에게 묻기",
    desc: "상황을 정리하고 다음 행동 받기",
    href: "/chat",
  },
  {
    icon: CalendarCheck,
    title: "준비실 열기",
    desc: "일정·예산·예약을 한곳에 정리",
    href: "/dashboard",
  },
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
  const showFullFeed = feedQuery === "all";
  const canUseInitialFeed =
    !isSearching &&
    !showFullFeed &&
    !selectedCategory &&
    !tagQuery &&
    (!sortQuery || sortQuery === "new") &&
    !periodQuery &&
    currentSort === "new" &&
    currentPeriod === "week" &&
    posts.length === 0 &&
    Boolean(initialFeed?.posts.length);
  const previewPosts = canUseInitialFeed ? (initialFeed?.posts ?? []) : posts;
  const visiblePosts = isSearching ? searchResults : showFullFeed ? posts : previewPosts.slice(0, 3);
  const activeTotal = isSearching ? searchTotal : canUseInitialFeed ? (initialFeed?.total ?? 0) : total;
  const isPreviewFeed = !isSearching && !showFullFeed;
  const fullFeedHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (sortQuery && sortValues.includes(sortQuery as PostSort)) params.set("sort", sortQuery);
    if (periodQuery && periodValues.includes(periodQuery as TimePeriod)) params.set("period", periodQuery);
    params.set("feed", "all");
    return `/community?${params.toString()}#community-feed`;
  }, [periodQuery, selectedCategory, sortQuery, tagQuery]);
  const summaryFeedHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory) params.set("category", selectedCategory);
    if (tagQuery) params.set("tag", tagQuery);
    if (sortQuery && sortValues.includes(sortQuery as PostSort)) params.set("sort", sortQuery);
    if (periodQuery && periodValues.includes(periodQuery as TimePeriod)) params.set("period", periodQuery);
    const query = params.toString();
    return query ? `/community?${query}#community-feed` : "/community#community-feed";
  }, [periodQuery, selectedCategory, sortQuery, tagQuery]);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (sortQuery && sortValues.includes(sortQuery as PostSort)) {
      useCommunityStore.getState().setSort(sortQuery as PostSort);
    }
    if (periodQuery && periodValues.includes(periodQuery as TimePeriod)) {
      useCommunityStore.getState().setPeriod(periodQuery as TimePeriod);
    }
  }, [periodQuery, sortQuery]);

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
    store.fetchPosts(true);
  }, [currentPeriod, currentSort, isSearching, selectedCategory, tagQuery]);

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
  }

  function setPeriod(nextPeriod: TimePeriod) {
    useCommunityStore.getState().setPeriod(nextPeriod);
  }

  return (
    <div className="bg-[linear-gradient(180deg,#f8f3ed_0%,#ffffff_42%,#f7f1eb_100%)] text-[#2f2a26]">
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
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        summaryFeedHref={summaryFeedHref}
        searchQuery={searchQuery}
        isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && visiblePosts.length === 0 : isLoading}
        errorMessage={isSearching ? null : errorMessage}
        clearError={clearError}
      />
      <JourneyBridge />
      <div ref={observerRef} className="h-1" />
      <Link
        href="/community/post/write"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#2f2a26] text-white shadow-[0_14px_34px_rgba(47,42,38,0.22)] transition-transform hover:-translate-y-0.5 md:hidden"
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
    <section className={`${shell} pt-6 md:pt-8`}>
      <div className="grid gap-4 rounded-[22px] border border-[#eadfc9] bg-white p-4 shadow-[0_16px_44px_rgba(47,42,38,0.07)] md:grid-cols-[minmax(0,1.04fr)_minmax(360px,0.96fr)] md:p-5">
        <div className="flex min-h-[300px] flex-col justify-between rounded-[18px] bg-[linear-gradient(135deg,#fffdf7_0%,#f7efe4_100%)] p-5 md:min-h-[340px] md:p-7">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-[#8a6a3f]">
              <Sparkles className="h-4 w-4" />
              커뮤니티에서 확인하고, 준비실에서 정리해요
            </p>
            <h1 className="max-w-[680px] font-serif-kr text-[31px] font-medium leading-[1.26] text-[#2f2925] sm:text-[40px] xl:text-[48px]">
              결혼 준비,
              <br />
              지금 필요한 것만 먼저 보이게.
            </h1>
            <p className="mt-4 max-w-[600px] text-[14px] font-medium leading-[1.8] text-[#5f554d] md:text-[16px]">
              후기와 질문으로 판단하고, 아모라와 준비실에서 일정·예산·예약을 바로 이어서 정리하세요.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2 text-[12px] font-semibold text-[#5f554d] sm:max-w-[520px]">
            {[
              { label: "후기", value: "실제 경험" },
              { label: "질문", value: "상황 정리" },
              { label: "준비실", value: "내 일정 정리" },
            ].map((item) => (
              <div key={item.label} className="rounded-[14px] border border-white/70 bg-white/65 px-3 py-3">
                <span className="block text-[#9d6f36]">{item.label}</span>
                <span className="mt-1 block text-[13px] text-[#2f2925]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-h-[360px] overflow-hidden rounded-[18px] border border-[#eadfc9] bg-[#f6ead9]">
          <Image
            src="/images/amora-hero-bouquet-custom.png"
            alt=""
            fill
            className="object-cover"
            priority
            sizes="(min-width: 768px) 48vw, calc(100vw - 48px)"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(47,41,37,0.02)_0%,rgba(47,41,37,0.18)_52%,rgba(47,41,37,0.34)_100%)]" />
          <div className="absolute inset-x-4 bottom-4 grid gap-2 sm:inset-x-5 sm:bottom-5">
            {journeyActions.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className={`group flex min-h-[70px] items-center gap-3 rounded-[16px] border p-3.5 backdrop-blur-md transition-transform hover:-translate-y-0.5 ${
                  item.primary
                    ? "border-[#2f2925] bg-[#2f2925]/94 text-white shadow-[0_14px_34px_rgba(47,41,37,0.20)]"
                    : "border-white/70 bg-white/88 text-[#2f2925] hover:bg-white"
                }`}
              >
                <span
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    item.primary ? "bg-white/12 text-white" : "bg-[#fff8ec] text-[#9d6f36]"
                  }`}
                >
                  <item.icon className="h-5 w-5 stroke-[1.7]" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[15px] font-semibold">{item.title}</strong>
                  <span className={`mt-1 block text-[12px] font-medium ${item.primary ? "text-white/72" : "text-[#6c6158]"}`}>
                    {item.desc}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 opacity-55 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {topVendor && (
        <p className="mt-3 text-[12px] font-semibold text-[#766d66]">
          지금 많이 언급되는 업체: <span className="text-[#8a6a3f]">{topVendor}</span>
        </p>
      )}
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
    <section className={`${shell} mt-4 rounded-[20px] border border-[#e7dad1] bg-white/86 p-4 shadow-[0_10px_30px_rgba(47,42,38,0.045)] md:p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#2f2a26]">무엇부터 확인할까요?</h2>
          <p className="mt-1 text-[12px] font-medium text-[#766d66]">검색이 가장 빠르고, 자주 보는 주제는 아래에서 바로 들어가세요.</p>
        </div>
        <Link href="/dashboard" className="inline-flex h-10 items-center rounded-full border border-[#e7dad1] px-4 text-[12px] font-semibold text-[#7a4e43] hover:bg-[#f4ebe4]">
          준비실로 정리
          <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
      </div>

      <form onSubmit={onSubmit}>
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="궁금한 정보를 검색해 보세요 (예: 웨딩홀, 스드메, 예산)"
            className="h-12 w-full rounded-[16px] border border-[#d9cbc1] bg-[#fbf7f2] px-4 pr-12 text-[14px] font-medium text-[#2f2a26] outline-none placeholder:text-[#9b8f86] focus:border-[#a96856] md:h-[54px] md:px-5 md:pr-14 md:text-[15px]"
          />
          <button
            type="submit"
            aria-label="검색"
            className="absolute right-4 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-[#2f2a26] text-white"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        </label>
      </form>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {searchCategories.map((item) => (
          <Link
            key={item.label}
            href={buildCommunityHubHref(item)}
            aria-label={`${item.label} 보기`}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-[#eee4dd] bg-[#fffdfb] px-2 text-center text-[11px] font-semibold text-[#574e49] transition-colors hover:border-[#cfaea2] hover:bg-[#f4ebe4] hover:text-[#7a4e43]"
          >
            <item.icon className="h-5 w-5 stroke-[1.65] text-[#a96856]" />
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
      className={`${shell} mt-4 flex flex-wrap items-center gap-2 overflow-visible rounded-[18px] border border-[#e7dad1] bg-white/90 p-2.5 shadow-[0_8px_22px_rgba(47,42,38,0.035)] md:gap-2.5`}
      data-tutorial-target="community-categories"
    >
      <Link
        href="/community"
        className={`min-w-[70px] shrink-0 rounded-[14px] border px-4 py-2.5 text-center text-[13px] font-semibold transition-colors md:min-w-[74px] md:text-[14px] ${
          selectedCategory
            ? "border-transparent bg-[#fbf7f2] text-[#574e49] hover:border-[#cfaea2] hover:text-[#7a4e43]"
            : "border-[#2f2a26] bg-[#2f2a26] text-white"
        }`}
      >
        전체
      </Link>
      {COMMUNITY_CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={buildCommunityCategoryHref(cat.key)}
          className={`min-w-[76px] shrink-0 rounded-[14px] border px-4 py-2.5 text-center text-[13px] font-semibold transition-colors md:min-w-[84px] md:text-[14px] ${
            selectedCategory === cat.key
              ? "border-[#2f2a26] bg-[#2f2a26] text-white"
              : "border-transparent bg-[#fbf7f2] text-[#574e49] hover:border-[#cfaea2] hover:text-[#7a4e43]"
          }`}
        >
          {cat.shortLabel}
        </Link>
      ))}
      {currentTag && (
        <button
          type="button"
          onClick={onClearTag}
          className="rounded-[14px] border border-[#e7dad1] bg-[#f4ebe4] px-4 py-2.5 text-[13px] font-semibold text-[#7a4e43]"
        >
          #{currentTag} 지우기
        </button>
      )}

      <div className="ml-0 flex w-full shrink-0 flex-wrap items-center justify-end gap-2 md:ml-auto md:w-auto">
        <label className="relative">
          <span className="sr-only">정렬</span>
          <select
            value={currentSort}
            onChange={(event) => onSortChange(event.target.value as PostSort)}
            className="h-11 appearance-none rounded-[14px] border border-[#e7dad1] bg-white px-4 pr-10 text-[14px] font-semibold text-[#574e49] outline-none focus:border-[#a96856]"
          >
            {sortValues.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabels[sort]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a96856]" />
        </label>
        {currentSort === "top" && (
          <label className="relative">
          <span className="sr-only">좋아요 기간</span>
            <select
              value={currentPeriod}
              onChange={(event) => onPeriodChange(event.target.value as TimePeriod)}
              className="h-11 appearance-none rounded-[14px] border border-[#e7dad1] bg-white px-4 pr-10 text-[14px] font-semibold text-[#574e49] outline-none focus:border-[#a96856]"
            >
              {periodValues.map((period) => (
                <option key={period} value={period}>
                  {periodLabels[period]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a96856]" />
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
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  summaryFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  summaryFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
}) {
  return (
    <section
      id="community-feed"
      className={`${shell} mt-4 grid grid-cols-1 items-start gap-[18px] scroll-mt-24 md:grid-cols-[1.48fr_0.92fr]`}
    >
      <LatestPosts
        posts={posts}
        total={total}
        selectedCategory={selectedCategory}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        summaryFeedHref={summaryFeedHref}
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
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  summaryFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  clearError,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  summaryFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
}) {
  const feedTitle = isSearching
    ? "검색 결과"
    : selectedCategory
      ? `${categoryDisplayLabels[selectedCategory]} 글`
      : "최신 글";

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
            {feedTitle}
          </h2>
          <p className="mt-1 text-[12px] font-medium text-[#7a8290]">
            {isSearching
              ? `"${searchQuery}" ${formatCount(total)}건`
              : isPreviewFeed
                ? `최근 글 ${formatCount(posts.length)}개만 먼저 보여드려요`
                : `실제 게시글 ${formatCount(total)}개`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPreviewFeed && posts.length > 0 && (
            <Link
              href={fullFeedHref}
              className="inline-flex min-h-10 items-center rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-medium text-[#9d6f36]"
              aria-label="전체 글 보기"
            >
              전체 글 보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          {!isPreviewFeed && !isSearching && (
            <Link
              href={summaryFeedHref}
              className="inline-flex min-h-10 items-center rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-medium text-[#9d6f36]"
              aria-label="커뮤니티 요약 보기"
            >
              요약 보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          <Link
            href="/community/post/write"
            className="inline-flex min-h-10 items-center rounded-full bg-[#061a34] px-5 text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)]"
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
              {!isSearching && index === 0 && (
                <div className="py-4" data-tutorial-target="community-composer">
                  <FeedComposer />
                </div>
              )}
            </Fragment>
          ))}
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
  const contentPreview = stripHtml(post.content).slice(0, 130);
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
      className="relative grid grid-cols-[104px_1fr] gap-4 py-4 first:pt-0 last:pb-0 sm:grid-cols-[150px_1fr] sm:gap-5"
    >
      {toast && (
        <span className="absolute right-0 top-4 z-10 rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}
      <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-[#f8f4ec] sm:aspect-[1.92]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 hover:scale-105"
            sizes="180px"
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
        <div className="mb-2 flex min-w-0 items-center gap-2">
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
          <h3 className="min-w-0 flex-1 truncate font-serif-kr text-[18px] font-medium text-[#071629]">
            {post.title}
          </h3>
          <Sparkles className="h-4 w-4 shrink-0 text-[#b68a3a]" />
        </div>
        {contentPreview && (
          <p className="line-clamp-2 text-[13px] font-medium leading-[1.7] text-[#5d6879]">
            {contentPreview}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] font-medium text-[#7a8290]">
          <span>{post.author?.nickname ?? "익명"}</span>
          <span>{timeAgo(post.created_at)}</span>
          <button
            type="button"
            onClick={handleLike}
            disabled={voting}
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
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
    </Link>
  );
}

function RightPanels() {
  return (
    <div className="space-y-[18px]" data-tutorial-target="community-right">
      <NextStepPanel />
      <CohortPreviewPanel />
    </div>
  );
}

function NextStepPanel() {
  return (
    <article className="rounded-[18px] border border-[#e7dad1] bg-[#2f2a26] p-5 text-white shadow-[0_14px_34px_rgba(47,42,38,0.13)]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#e8cfc5]">Next step</p>
      <h2 className="mt-2 font-serif-kr text-[23px] font-medium leading-[1.35]">커뮤니티에서 본 내용을 바로 정리하세요.</h2>
      <p className="mt-2 text-[13px] font-medium leading-[1.65] text-white/68">
        후기만 보고 끝나지 않게, 일정·예산·예약으로 이어지는 길을 항상 열어둡니다.
      </p>
      <div className="mt-5 grid gap-2">
        {journeyActions.slice(1).map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="flex min-h-12 items-center gap-3 rounded-[14px] bg-white/[0.08] px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-white/[0.13]"
          >
            <item.icon className="h-4 w-4 text-[#e8cfc5]" />
            <span className="min-w-0 flex-1">{item.title}</span>
            <ChevronRight className="h-4 w-4 opacity-55" />
          </Link>
        ))}
      </div>
    </article>
  );
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

function JourneyBridge() {
  return (
    <section className={`${shell} mt-[18px] pb-8`}>
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[20px] border border-[#e7dad1] bg-white p-6 shadow-[0_12px_34px_rgba(47,42,38,0.045)] md:p-7">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a96856]">Simple flow</p>
          <h2 className="mt-2 font-serif-kr text-[26px] font-medium leading-[1.35] text-[#2f2a26]">
            읽고, 물어보고, 내 준비실에 남기기.
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { step: "1", title: "후기 확인", desc: "비슷한 예산·지역·시기 글부터 봅니다." },
              { step: "2", title: "아모라 정리", desc: "내 상황에 맞는 다음 질문과 체크를 받습니다." },
              { step: "3", title: "준비실 반영", desc: "결정한 일정을 예산과 체크리스트에 연결합니다." },
            ].map((item) => (
              <div key={item.step} className="rounded-[16px] border border-[#eee4dd] bg-[#fbf7f2] p-4">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#a96856] text-[12px] font-semibold text-white">
                  {item.step}
                </span>
                <h3 className="mt-3 text-[14px] font-semibold text-[#2f2a26]">{item.title}</h3>
                <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#766d66]">{item.desc}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[20px] border border-[#eadfc9] bg-[#fff8ec] p-6 shadow-[0_12px_34px_rgba(47,42,38,0.04)] md:p-7">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8a6a3f]">Trust</p>
          <h2 className="mt-2 font-serif-kr text-[26px] font-medium leading-[1.35] text-[#2f2a26]">
            광고보다 맥락이 먼저 보이게.
          </h2>
          <p className="mt-3 text-[13px] font-medium leading-[1.75] text-[#6f655f]">
            협찬 표시는 분리하고, 후기에는 예산·지역·조건이 함께 남도록 설계했습니다. 앞으로 쌓이는 데이터는 준비실 추천과 아모라 답변의 기준이 됩니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["광고 표시", "가격 맥락", "동기방 사례", "아모라 질문"].map((item) => (
              <span key={item} className="rounded-full bg-white/70 px-3 py-2 text-[12px] font-semibold text-[#6f655f]">
                {item}
              </span>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
