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
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Flame,
  Gift,
  Heart,
  HeartHandshake,
  ImageIcon,
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

const shell = "mx-auto w-[calc(100%_-_48px)] max-w-[1210px]";
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

const cohortPreviewRows = [
  { period: "2026년 1분기 (1~3월)", note: "준비 시작" },
  { period: "2026년 2분기 (4~6월)", note: "비교 활발" },
  { period: "2026년 3분기 (7~9월)", note: "예약·후기" },
  { period: "2026년 4분기 (10~12월)", note: "체크리스트" },
  { period: "날짜 미정·하반기 이후", note: "일정 잡기" },
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

function getPostImages(post: PostWithAuthor) {
  const slideImages =
    post.slides
      ?.map((slide) => slide.thumbnail_url || (slide.type === "image" ? slide.url : null))
      .filter((url): url is string => Boolean(url)) ?? [];
  const inline = post.content.match(/<img\s+[^>]*src=["']([^"']+)["']/gi)?.map((tag) => {
    const match = tag.match(/src=["']([^"']+)["']/i);
    return match?.[1] ?? "";
  }).filter(Boolean) ?? [];
  return [...slideImages, ...(post.images ?? []), ...inline].filter((url, index, arr) => arr.indexOf(url) === index);
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(201,149,69,0.10),transparent_28%),linear-gradient(180deg,#fffdf8_0%,#fbf6ed_58%,#fffaf2_100%)] text-[#1a2926]">
      <Hero topVendor={vendorTags[0]?.vendor_name ?? null} />
      <SearchHub searchDraft={searchDraft} onSearchDraftChange={setSearchDraft} onSubmit={submitSearch} />
      <CommunityMain
        posts={visiblePosts}
        total={activeTotal}
        selectedCategory={selectedCategory}
        currentSort={currentSort}
        currentPeriod={currentPeriod}
        currentTag={currentTag}
        onSortChange={setSort}
        onPeriodChange={setPeriod}
        onClearTag={() => router.push("/community")}
        isSearching={isSearching}
        isPreviewFeed={isPreviewFeed}
        fullFeedHref={fullFeedHref}
        summaryFeedHref={summaryFeedHref}
        searchQuery={searchQuery}
        isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && posts.length === 0 : isLoading}
        errorMessage={isSearching ? null : errorMessage}
        clearError={clearError}
        vendorTags={vendorTags}
      />
      <div ref={observerRef} className="h-1" />
      <Link
        href="/community/post/write"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#36534E] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5 md:hidden"
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
    <section className={`${shell} relative mt-[18px] grid min-h-[282px] overflow-hidden rounded-[22px] border border-[#eadcc9] bg-[linear-gradient(90deg,#fffaf3_0%,#fff7ec_46%,rgba(255,255,255,0.05)_100%)] shadow-[0_10px_24px_rgba(50,36,17,0.055)] md:grid-cols-[1fr_1.25fr]`}>
      <div className="relative z-10 px-7 py-9 sm:px-12">
        <p className="mb-4 flex items-center gap-2 text-[13px] font-bold text-[#36534E] md:text-[15px]">
          예비부부가 함께 만드는 결혼 준비의 모든 것
          <Sparkles className="h-4 w-4 text-[#b47a2b]" />
        </p>

        <h1 className="font-serif-kr text-[38px] font-medium leading-[1.22] text-[#102b27] sm:text-[48px]">
          결혼 준비,
          <br />
          함께라서 든든해요
        </h1>

        <p className="mt-5 text-[15px] font-semibold leading-[1.8] text-[#36534E] md:text-[16px]">
          궁금한 것도, 설레는 순간도 서로 나누며
          <br />
          더 완벽한 결혼을 준비해요.
        </p>

        {topVendor && (
          <p className="mt-5 text-[12px] font-bold text-[#7d7166]">
            지금 많이 언급되는 업체: <span className="text-[#36534E]">{topVendor}</span>
          </p>
        )}
      </div>

      <div className="relative min-h-[238px] overflow-hidden md:min-h-full">
        <Image
          src="/images/amora-hero-bouquet-custom.png"
          alt=""
          fill
          className="object-cover object-[center_47%]"
          sizes="(min-width: 768px) 56vw, 100vw"
          priority
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,253,248,0.98)_0%,rgba(255,253,248,0.96)_2%,rgba(255,253,248,0.18)_28%,rgba(255,253,248,0)_100%)]" />
        <div className="absolute right-[12%] top-1/2 hidden -translate-y-1/2 border border-white/55 bg-[#fffaf3]/82 px-12 py-7 text-center shadow-[0_18px_44px_rgba(50,36,17,0.12)] backdrop-blur-[2px] sm:block">
          <strong className="font-serif text-[42px] font-medium italic leading-none text-[#9a6720]">Amora</strong>
          <span className="mt-2 block text-[10px] font-black tracking-[0.24em] text-[#815819]">A PRECIOUS PLANNER</span>
        </div>
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
    <section className={`${shell} mt-5 grid gap-5 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_280px]`}>
      <div className="rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/86 px-5 py-4 shadow-[0_10px_24px_rgba(50,36,17,0.045)]">
        <div className="grid grid-cols-4 gap-y-3 md:grid-cols-8">
          {searchCategories.map((item, index) => (
            <Link
              key={item.label}
              href={buildCommunityHubHref(item)}
              aria-label={`${item.label} 보기`}
              className={`flex min-h-[46px] flex-col items-center justify-center gap-1.5 text-center text-[11px] font-black text-[#102b27] transition-colors hover:text-[#b47a2b] ${
                index < searchCategories.length - 1 ? "md:border-r md:border-[#eadcc9]" : ""
              }`}
            >
              <item.icon className="h-5 w-5 stroke-[1.85] text-[#b47a2b]" />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="self-stretch">
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="커뮤니티 검색"
            className="h-[60px] w-full rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/86 px-6 pr-14 text-[15px] font-bold text-[#263832] shadow-[0_10px_24px_rgba(50,36,17,0.045)] outline-none placeholder:text-[#b7aa9a] focus:border-[#36534E]"
          />
          <button
            type="submit"
            aria-label="검색"
            className="absolute right-5 top-1/2 -translate-y-1/2 text-[#b47a2b]"
          >
            <Search className="h-6 w-6" />
          </button>
        </label>
      </form>
    </section>
  );
}

function ComposerPrompt() {
  return (
    <article className="rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/90 p-7 shadow-[0_10px_24px_rgba(50,36,17,0.045)]">
      <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#102b27]">
        어떤 고민이 있으신가요? 후기나 질문을 남겨보세요.
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { href: "/community/post/write?category=tour_review", icon: PenSquare, label: "후기 쓰기" },
          { href: "/community/post/write?category=is_normal", icon: MessageCircle, label: "질문하기" },
          { href: "/community/post/write", icon: ImageIcon, label: "사진 올리기" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="inline-flex min-h-[58px] items-center justify-center gap-3 rounded-[14px] border border-[#eadcc9] bg-white/70 px-4 text-[17px] font-black text-[#102b27] transition-all hover:-translate-y-0.5 hover:border-[#36534E] hover:bg-white"
            data-tutorial-target={item.label === "후기 쓰기" ? "community-write" : undefined}
          >
            <item.icon className="h-5 w-5 text-[#9a6720]" />
            {item.label}
          </Link>
        ))}
      </div>
    </article>
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
      className="mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-[16px] border border-[#e5d8ca] bg-white/82 p-3 shadow-[0_8px_22px_rgba(8,22,38,0.035)] md:flex-wrap md:gap-3 md:overflow-visible"
      data-tutorial-target="community-categories"
    >
      <Link
        href="/community"
        className={`min-w-[70px] shrink-0 rounded-full border px-4 py-2.5 text-center text-[13px] font-medium transition-colors md:min-w-[74px] md:px-5 md:py-3 md:text-[14px] ${
          selectedCategory
            ? "border-[#e5d8ca] bg-white/70 text-[#5f5b52] hover:border-[#36534E] hover:text-[#36534E]"
            : "border-[#36534E] bg-[#36534E] text-white"
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
              ? "border-[#36534E] bg-[#36534E] text-white"
              : "border-[#e5d8ca] bg-white/70 text-[#5f5b52] hover:border-[#36534E] hover:text-[#36534E]"
          }`}
        >
          {cat.shortLabel}
        </Link>
      ))}
      {currentTag && (
        <button
          type="button"
          onClick={onClearTag}
          className="rounded-full border border-[#e5d8ca] bg-[#EEF4F1] px-4 py-3 text-[13px] font-medium text-[#36534E]"
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
            className="h-11 appearance-none rounded-full border border-[#e5d8ca] bg-white/70 px-5 pr-10 text-[14px] font-medium text-[#5f5b52] outline-none focus:border-[#36534E]"
          >
            {sortValues.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabels[sort]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#36534E]" />
        </label>
        {currentSort === "top" && (
          <label className="relative">
          <span className="sr-only">좋아요 기간</span>
            <select
              value={currentPeriod}
              onChange={(event) => onPeriodChange(event.target.value as TimePeriod)}
              className="h-11 appearance-none rounded-full border border-[#e5d8ca] bg-white/70 px-5 pr-10 text-[14px] font-medium text-[#5f5b52] outline-none focus:border-[#36534E]"
            >
              {periodValues.map((period) => (
                <option key={period} value={period}>
                  {periodLabels[period]}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#36534E]" />
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
  currentPeriod,
  currentTag,
  onSortChange,
  onPeriodChange,
  onClearTag,
  isSearching,
  isPreviewFeed,
  fullFeedHref,
  summaryFeedHref,
  searchQuery,
  isLoading,
  errorMessage,
  clearError,
  vendorTags,
}: {
  posts: PostWithAuthor[];
  total: number;
  selectedCategory: CommunityCategory | null;
  currentSort: PostSort;
  currentPeriod: TimePeriod;
  currentTag: string | null;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
  onClearTag: () => void;
  isSearching: boolean;
  isPreviewFeed: boolean;
  fullFeedHref: string;
  summaryFeedHref: string;
  searchQuery: string;
  isLoading: boolean;
  errorMessage: string | null;
  clearError: () => void;
  vendorTags: VendorTag[];
}) {
  return (
    <section
      id="community-feed"
      className={`${shell} mt-5 grid grid-cols-1 gap-[18px] scroll-mt-24 md:grid-cols-[minmax(0,1fr)_360px]`}
    >
      <div className="min-w-0">
        <ComposerPrompt />
        <CategoryBar
          selectedCategory={selectedCategory}
          currentSort={currentSort}
          currentPeriod={currentPeriod}
          currentTag={currentTag}
          onSortChange={onSortChange}
          onPeriodChange={onPeriodChange}
          onClearTag={onClearTag}
        />
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
      </div>
      <RightPanels vendorTags={vendorTags} />
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
    <article>
      {(isSearching || !isPreviewFeed || selectedCategory) && (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#eadcc9] bg-[#fffdf9]/90 p-4 shadow-[0_10px_24px_rgba(50,36,17,0.04)]">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#263832]">
            {feedTitle}
          </h2>
          <p className="mt-1 text-[12px] font-medium text-[#7d7166]">
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
              className="inline-flex min-h-10 items-center rounded-full border border-[#e5d8ca] bg-white px-5 text-[13px] font-medium text-[#36534E]"
              aria-label="전체 글 보기"
            >
              전체 글 보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          {!isPreviewFeed && !isSearching && (
            <Link
              href={summaryFeedHref}
              className="inline-flex min-h-10 items-center rounded-full border border-[#e5d8ca] bg-white px-5 text-[13px] font-medium text-[#36534E]"
              aria-label="커뮤니티 요약 보기"
            >
              요약 보기
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          )}
          <Link
            href="/community/post/write"
            className="inline-flex min-h-10 items-center rounded-full bg-[#36534E] px-5 text-[13px] font-semibold text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)]"
            data-tutorial-target="community-write"
          >
            글쓰기
            <PenSquare className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </div>
      )}

      {errorMessage && (
        <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-[#e5d8ca] bg-[#fbf8f2] px-4 py-3 text-sm text-[#5f5b52] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#36534E]" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => useCommunityStore.getState().fetchPosts(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#36534E] px-3 py-2 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              다시 불러오기
            </button>
            <button
              type="button"
              onClick={clearError}
              className="rounded-full px-3 py-2 text-xs font-semibold text-[#7d7166] hover:bg-white"
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
        <div className="space-y-3">
          {posts.map((post, index) => (
            <Fragment key={post.id}>
              <CommunityPostRow post={post} priority={index < 2} />
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
  const imageUrls = getPostImages(post);
  const imageUrl = imageUrls[0] ?? getPostImage(post);
  const galleryImages = imageUrls.length > 0 ? imageUrls.slice(0, 3) : imageUrl ? [imageUrl] : [];
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
      className="relative grid gap-4 rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/92 p-5 shadow-[0_10px_24px_rgba(50,36,17,0.045)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(50,36,17,0.08)] lg:grid-cols-[minmax(0,1fr)_380px]"
    >
      {toast && (
        <span className="absolute right-0 top-4 z-10 rounded-full bg-[#36534E] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}
      <div className="min-w-0">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-[#f6ead9] px-2 py-1 text-[12px] font-medium text-[#36534E]">
            {categoryInfo?.shortLabel ?? "커뮤니티"}
          </span>
          <span className="min-w-0 truncate text-[12px] font-bold text-[#8d8176]">
            {post.author?.nickname ?? "익명"} · {timeAgo(post.created_at)}
          </span>
          {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
            <AdDisclosureBadge adDisclosure={post.ad_disclosure} size="sm" />
          )}
          {post.is_weekly_best && (
            <span className="shrink-0 rounded-md bg-[#36534E] px-2 py-1 text-[11px] font-medium text-white">
              BEST
            </span>
          )}
          {post.poll && (
            <span className="shrink-0 rounded-md border border-[#e5d8ca] px-2 py-1 text-[11px] font-medium text-[#7d7166]">
              투표
            </span>
          )}
        </div>
        <h3 className="font-serif-kr text-[23px] font-medium leading-[1.32] text-[#102b27] sm:text-[26px]">
          {post.title}
          {post.is_weekly_best && <Sparkles className="ml-2 inline h-5 w-5 text-[#b47a2b]" />}
        </h3>
        {contentPreview && (
          <p className="mt-3 line-clamp-2 text-[15px] font-semibold leading-[1.75] text-[#36534E]">
            {contentPreview}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4 text-[13px] font-black text-[#36534E]">
          <button
            type="button"
            onClick={handleLike}
            disabled={voting}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
              isLiked ? "bg-[#EEF4F1] text-[#36534E]" : "hover:bg-[#f6efe5]"
            }`}
            aria-label="좋아요"
          >
            <Heart className={`h-4 w-4 stroke-[1.6] ${isLiked ? "fill-current" : ""}`} />
            {displayUpvoteCount}
          </button>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-4 w-4 stroke-[1.6]" />
            {post.comment_count ?? 0}
          </span>
          <span className="inline-flex items-center gap-1">
            <Share2 className="h-4 w-4 stroke-[1.6]" />
            {Math.max(post.comment_count ?? 0, 0) + Math.max(displayUpvoteCount, 0)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-4 w-4 stroke-[1.6]" />
            {post.view_count ?? 0}
          </span>
          <button
            type="button"
            onClick={handleBookmark}
            disabled={bookmarking}
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
              bookmarked ? "bg-[#EEF4F1] text-[#36534E]" : "text-[#5f5b52] hover:bg-[#f6efe5]"
            }`}
            aria-label="북마크"
          >
            <Bookmark className={`h-4 w-4 stroke-[1.6] ${bookmarked ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[#5f5b52] transition-colors hover:bg-[#f6efe5]"
            aria-label="공유"
          >
            <Share2 className="h-4 w-4 stroke-[1.6]" />
          </button>
        </div>
      </div>

      <div className="grid min-h-[120px] grid-cols-3 gap-3 self-center lg:min-h-[88px]">
        {galleryImages.length > 0 ? (
          galleryImages.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className={`relative min-h-[120px] overflow-hidden rounded-[10px] bg-[#f8f4ec] lg:min-h-[88px] ${
                galleryImages.length === 1 ? "col-span-3" : ""
              }`}
            >
              <Image
                src={url}
                alt=""
                fill
                className="object-cover transition-transform duration-500 hover:scale-105"
                sizes="130px"
                priority={priority && index === 0}
              />
              {index === 2 && imageUrls.length > 3 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[22px] font-black text-white">
                  +{imageUrls.length - 2}
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-3 flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-[12px] bg-[#f6efe5] text-[#36534E]">
            <HeartHandshake className="h-7 w-7 stroke-[1.5]" />
            <span className="text-[12px] font-bold">{categoryInfo?.shortLabel ?? "커뮤니티"}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function RightPanels({ vendorTags }: { vendorTags: VendorTag[] }) {
  return (
    <div className="space-y-[18px]" data-tutorial-target="community-right">
      <CohortPreviewPanel />
      <BestPostsPanel />
      <PopularTagsPanel vendorTags={vendorTags} />
    </div>
  );
}

function CohortPreviewPanel() {
  return (
    <article
      className="rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/92 p-6 shadow-[0_10px_24px_rgba(50,36,17,0.045)]"
      data-tutorial-target="community-cohort"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#102b27]">동기부부 방</h2>
          <p className="mt-2 text-[13px] font-bold leading-[1.65] text-[#36534E]">
            함께 준비하는 동기부부와 실시간으로 소통해요!
          </p>
        </div>
        <Link href="/community/cohort" className="shrink-0 text-[13px] font-black text-[#9a6720]">
          더보기
        </Link>
      </div>
      <div className="space-y-2">
        {cohortPreviewRows.map((row, index) => (
          <Link
            key={row.period}
            href="/community/cohort"
            className="flex min-h-[42px] items-center gap-3 rounded-[12px] px-1 text-[14px] font-black text-[#102b27] transition-colors hover:bg-[#f6efe5]"
          >
            <span className="shrink-0">👰🤵</span>
            <span className="min-w-0 flex-1 truncate">{row.period}</span>
            <span className="hidden text-[12px] font-black text-[#6e7974] sm:inline">
              {formatCount([2314, 2981, 3427, 2765, 1876][index] ?? 1200)}명
            </span>
            <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-[#eadcc9] bg-white px-3 text-[12px] font-black text-[#36534E]">
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
    <article className="rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/92 p-6 shadow-[0_10px_24px_rgba(50,36,17,0.045)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#263832]">
          BEST 글 <Flame className="inline h-5 w-5 fill-[#d77458] text-[#d77458]" />
        </h2>
        <Link href="/community?sort=hot" className="text-[13px] font-medium text-[#36534E]">
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
        <p className="text-[13px] font-medium text-[#7d7166]">아직 인기글을 집계하고 있어요.</p>
      ) : (
        <ol className="space-y-3">
          {posts.map((post, index) => (
            <li key={post.id}>
              <Link
                href={`/community/post/${post.id}`}
                className="grid grid-cols-[24px_1fr_auto] items-center gap-3 text-[13px] font-medium"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#B89785] text-[12px] font-semibold text-white">
                  {index + 1}
                </span>
                <span className="truncate text-[#5f5b52]">{post.title}</span>
                <strong className="text-[#263832]">{formatCount(post.upvote_count)}</strong>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-5 border-t border-[#e5d8ca] pt-4 text-center text-[12px] font-medium text-[#8d8176]">
        실제 반응을 기준으로 보여드려요.
      </p>
    </article>
  );
}

function PopularTagsPanel({ vendorTags }: { vendorTags: VendorTag[] }) {
  const fallbackTags = ["스드메 견적", "본식 드레스", "예산 2500", "예단 고민", "신혼여행 추천", "식전영상", "혼수 준비", "웨딩홀 계약"];
  const tags = vendorTags.length > 0 ? vendorTags.slice(0, 8).map((tag) => tag.vendor_name) : fallbackTags;

  return (
    <article className="rounded-[22px] border border-[#eadcc9] bg-[#fffdf9]/92 p-6 shadow-[0_10px_24px_rgba(50,36,17,0.045)]">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#102b27]">이번 주 인기 태그</h2>
        <Link href="/community?sort=hot" className="text-[13px] font-black text-[#9a6720]">
          더보기
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Link
            key={tag}
            href={`/community?tag=${encodeURIComponent(tag)}#community-feed`}
            className="rounded-full border border-[#eadcc9] bg-white/72 px-3 py-2 text-[12px] font-black text-[#36534E] transition-colors hover:border-[#36534E] hover:bg-[#eaf3ef]"
          >
            # {tag}
          </Link>
        ))}
      </div>
    </article>
  );
}
