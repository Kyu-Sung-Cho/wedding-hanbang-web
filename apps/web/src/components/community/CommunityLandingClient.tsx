"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  Bookmark,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Flame,
  Gift,
  Heart,
  HeartHandshake,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  PenSquare,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
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
import type { CommunityCategory, PostSort, PostWithAuthor, TimePeriod } from "@/types/community.types";
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

const shell = "mx-auto w-[calc(100%_-_48px)] max-w-[1300px]";
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
  { period: "2026년 1분기 (1~3월)", note: "준비 시작" },
  { period: "2026년 2분기 (4~6월)", note: "비교 활발" },
  { period: "2026년 3분기 (7~9월)", note: "예약·후기" },
  { period: "2026년 4분기 (10~12월)", note: "체크리스트" },
  { period: "날짜 미정·하반기 이후", note: "일정 잡기" },
];

const promises: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: ShieldCheck, title: "정확한 정보", desc: "검증된 경험과 출처가 있는 정보가 더 잘 보이도록 관리해요." },
  { icon: Gift, title: "사람 중심 공간", desc: "비방보다 맥락과 조언이 남는 대화를 지향해요." },
  { icon: Megaphone, title: "광고 최소화", desc: "협찬·광고 표시는 명확하게 분리해 신뢰를 지켜요." },
  { icon: Heart, title: "후기 맥락 보존", desc: "예산·지역·조건을 함께 남겨 비교가 가능하게 해요." },
  { icon: Users, title: "서로 존중해요", desc: "예비부부 관점에서 안전하게 질문하고 답해요." },
  { icon: LockKeyhole, title: "안전한 가이드", desc: "개인정보와 민감한 사연은 조심스럽게 다뤄요." },
  { icon: HeartHandshake, title: "함께 개선해요", desc: "실제 글과 행동을 바탕으로 준비 도구를 더 좋게 만들어요." },
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

export default function CommunityLandingClient() {
  useCommunityRealtime();

  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") ?? "";
  const categoryQuery = searchParams.get("category");
  const tagQuery = searchParams.get("tag") ?? "";
  const sortQuery = searchParams.get("sort");
  const periodQuery = searchParams.get("period");
  const feedQuery = searchParams.get("feed");
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
  const visiblePosts = isSearching ? searchResults : showFullFeed ? posts : posts.slice(0, 3);
  const activeTotal = isSearching ? searchTotal : total;
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
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        summaryFeedHref={summaryFeedHref}
        searchQuery={searchQuery}
        isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && posts.length === 0 : isLoading}
        errorMessage={isSearching ? null : errorMessage}
        clearError={clearError}
      />
      <BottomCards />
      <TrustPromises />
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
    <section className={`${shell} relative grid grid-cols-1 items-center gap-5 pt-3 md:min-h-[340px] md:grid-cols-2 md:gap-8 md:pt-4`}>
      <div className="relative z-10 py-5 md:py-6">
        <p className="mb-4 flex items-center gap-2 text-[13px] font-medium text-[#26364a] md:mb-6 md:text-[15px]">
          예비부부가 함께 만드는 결혼 준비의 모든 것
          <Sparkles className="h-4 w-4 text-[#b68a3a]" />
        </p>

        <h1 className="font-serif-kr text-[31px] font-medium leading-[1.3] text-[#061a34] sm:text-[36px] xl:text-[46px]">
          경험을 나누고,
          <br />
          더 완벽한 <span className="text-[#b68a3a]">결혼을 준비해요.</span>
        </h1>

        <p className="mt-5 text-[14px] font-medium leading-[1.75] text-[#38475c] md:mt-7 md:text-[16px] md:leading-[1.9]">
          실제 후기와 정보로 현명하게 준비하고,
          <br />
          서로 돕고 나누며 행복한 결혼을 만들어 가요.
        </p>

        <div className="mt-6 grid max-w-[590px] grid-cols-4 gap-1 md:mt-6">
          {heroSignals.map((item, index) => (
            <div
              key={item.label}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-2 px-1 text-center text-[11px] font-medium leading-snug text-[#34445a] md:min-h-[76px] md:gap-[9px] md:px-3 md:text-[12px] ${
                index < heroSignals.length - 1 ? "sm:border-r sm:border-[#eadfc9]" : ""
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

      <div className="relative hidden min-h-[300px] self-stretch overflow-hidden rounded-bl-[56px] bg-[url('/images/amora-hero-bouquet-custom.png')] bg-cover bg-[position:center_48%] shadow-[inset_36px_0_56px_rgba(255,253,247,0.88)] md:block">
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
    <section className={`${shell} rounded-[16px] border border-[#eadfc9] bg-white/80 px-4 py-4 shadow-[0_10px_30px_rgba(8,22,38,0.04)] md:rounded-[18px] md:px-6 md:py-4`}>
      <form onSubmit={onSubmit} className="mx-auto max-w-[760px]">
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="궁금한 정보를 검색해 보세요 (예: 웨딩홀, 스드메, 예산)"
            className="h-11 w-full rounded-full border border-[#d8c7ad] bg-white/70 px-5 pr-12 text-[14px] font-medium text-[#061a34] outline-none placeholder:text-[#b49b7c] focus:border-[#b68a3a] md:h-[50px] md:px-8 md:pr-14 md:text-[15px]"
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

      <div className="mt-4 hidden grid-cols-2 gap-y-3 sm:grid-cols-4 md:grid md:grid-cols-8">
        {searchCategories.map((item, index) => (
          <Link
            key={item.label}
            href={buildCommunityHubHref(item)}
            aria-label={`${item.label} 보기`}
            className={`flex flex-col items-center gap-1.5 text-center text-[11px] font-medium text-[#34445a] transition-colors hover:text-[#b68a3a] ${
              index < searchCategories.length - 1 ? "md:border-r md:border-[#eadfc9]" : ""
            }`}
          >
            <item.icon className="h-6 w-6 stroke-[1.55] text-[#b68a3a]" />
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
      className={`${shell} mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-[16px] border border-[#eadfc9] bg-white/82 p-3 shadow-[0_8px_22px_rgba(8,22,38,0.035)] md:flex-wrap md:gap-3 md:overflow-visible`}
      data-tutorial-target="community-categories"
    >
      <Link
        href="/community"
        className={`min-w-[70px] shrink-0 rounded-full border px-4 py-2.5 text-center text-[13px] font-medium transition-colors md:min-w-[74px] md:px-5 md:py-3 md:text-[14px] ${
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
          className={`min-w-[76px] shrink-0 rounded-full border px-4 py-2.5 text-center text-[13px] font-medium transition-colors md:min-w-[84px] md:px-5 md:py-3 md:text-[14px] ${
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

      <div className="ml-0 flex shrink-0 flex-nowrap items-center gap-2 md:ml-auto md:flex-wrap">
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
      className={`${shell} mt-4 grid grid-cols-1 gap-[18px] scroll-mt-24 md:grid-cols-[1.48fr_0.92fr]`}
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
      <CohortPreviewPanel />
      <BestPostsPanel />
    </div>
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
            href="/community/cohort"
            className="flex min-h-[52px] items-center gap-3 py-2.5 text-[14px] font-medium text-[#34445a] transition-colors hover:bg-[#fff8ec]"
          >
            <span className="min-w-0 flex-1 truncate">{row.period}</span>
            <span className="hidden text-[12px] font-medium text-[#7a8290] sm:inline">{row.note}</span>
            <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#d8bb86] bg-white px-4 text-[12px] font-semibold text-[#9d6f36]">
              입장
            </span>
          </Link>
        ))}
      </div>
    </article>
  );
}

function BestPostsPanel() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void withSessionCache("community:landing:best-posts:5", 5 * 60 * 1000, async () => {
      const res = await fetch("/api/community/posts?sort=hot&limit=5&page=1");
      if (!res.ok) return [] as TrendingPost[];
      const json = await res.json();
      return (json.posts ?? []).slice(0, 5).map((post: TrendingPost) => ({
        id: post.id,
        title: post.title,
        upvote_count: post.upvote_count,
        comment_count: post.comment_count,
      })) as TrendingPost[];
    })
      .then((data) => {
        if (!cancelled) setPosts(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
          BEST 글 <Flame className="inline h-5 w-5 fill-[#f26a3d] text-[#f26a3d]" />
        </h2>
        <Link href="/community?sort=hot" className="text-[13px] font-medium text-[#9d6f36]">
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
        <p className="text-[13px] font-medium text-[#7a8290]">아직 인기글을 집계하고 있어요.</p>
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
        실제 반응을 기준으로 보여드려요.
      </p>
    </article>
  );
}

function BottomCards() {
  return (
    <section className={`${shell} mt-[18px] grid grid-cols-1 gap-[18px] md:grid-cols-[1fr_0.8fr_1fr]`}>
      <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">가격 · 후기 한눈에 비교해보세요.</h2>
        <p className="mt-3 text-[13px] font-medium leading-[1.7] text-[#5d6879]">
          후기와 견적 정보를 함께 보며
          <br />
          나에게 맞는 선택지를 좁혀갈 수 있어요.
        </p>
        <Link
          href="/community/quote-check"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#061a34] px-5 text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)]"
        >
          정보 비교 바로가기
          <ChevronRight className="ml-2 h-4 w-4" />
        </Link>
      </article>

      <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 text-center shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
        <h3 className="mb-4 text-[15px] font-semibold text-[#9d6f36]">카테고리 바로가기</h3>
        <div className="grid grid-cols-3 gap-3 text-[13px] font-medium">
          {COMMUNITY_CATEGORIES.slice(0, 3).map((cat) => (
            <Link key={cat.key} href={buildCommunityCategoryHref(cat.key)} className="rounded-[12px] bg-[#fff8ec] px-2 py-3">
              <b className="block text-[#071629]">{cat.shortLabel}</b>
              <span className="mt-2 block text-[12px] text-[#7a8290]">글 보기</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-[11px] font-medium text-[#9aa2af]">실제 게시글 기준으로 이어집니다.</p>
      </article>

      <article className="relative overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
        <span className="rounded-full bg-[#fbefd6] px-3 py-1 text-[12px] font-medium text-[#9d6f36]">
          AI 진단 무료
        </span>
        <h2 className="mt-3 font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">아모라 견적진단</h2>
        <p className="mt-2 max-w-[265px] text-[13px] font-medium leading-[1.65] text-[#5d6879]">
          받은 견적서에서 빠진 항목과 추가금 가능성을 먼저 확인해요.
        </p>
        <ul className="mt-3 space-y-1 text-[12px] font-medium text-[#34445a]">
          {["평균 대비 참고 진단", "항목별 과소/과다 여부 분석", "계약 전 질문 리스트"].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#b68a3a]" />
              {item}
            </li>
          ))}
        </ul>
        <Link
          href="/community/quote-check"
          className="mt-4 inline-flex min-h-10 items-center rounded-full bg-[#061a34] px-5 text-[12px] font-semibold text-white"
          data-tutorial-target="community-service-link"
        >
          아모라 진단부터 시작하기
          <ChevronRight className="ml-2 h-4 w-4" />
        </Link>
        <ClipboardCheck className="absolute bottom-4 right-6 h-[110px] w-[110px] rotate-6 text-[#c9a96e]/35" />
      </article>
    </section>
  );
}

function TrustPromises() {
  return (
    <section className={`${shell} mt-[18px] pb-8`}>
      <div className="rounded-[18px] border border-[#eadfc9] bg-white/82 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
        <div className="mb-5 text-center">
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">우리가 지키는 약속</h2>
          <p className="mt-2 text-[13px] font-medium text-[#5d6879]">
            올바른 정보를 공유하고, 모두가 믿고 쓸 수 있는 공간을 만들어요.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {promises.slice(0, 3).map((promise) => (
            <PromiseCard key={promise.title} {...promise} large />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          {promises.slice(3).map((promise) => (
            <PromiseCard key={promise.title} {...promise} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PromiseCard({
  icon: Icon,
  title,
  desc,
  large = false,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  large?: boolean;
}) {
  return (
    <article
      className={`flex items-center gap-4 rounded-[14px] border border-[#f2eadc] bg-[#fffdf7] p-5 ${
        large ? "min-h-[105px]" : "min-h-[82px]"
      }`}
    >
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#eadfc9] bg-white text-[#b68a3a]">
        <Icon className="h-6 w-6 stroke-[1.55]" />
      </span>
      <div>
        <h3 className="text-[14px] font-semibold text-[#9d6f36]">{title}</h3>
        <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#5d6879]">{desc}</p>
      </div>
    </article>
  );
}
