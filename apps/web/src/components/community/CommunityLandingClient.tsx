"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
import { PRICE_CATEGORIES, type PriceCategory } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
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
import { communityPostLinkProps, communityPostUrl, isCommunityCategory } from "@/lib/community/routes";
import { COMMUNITY_TOUR_EVENT } from "@/components/community/CommunityFirstVisitTour";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { captureEvent } from "@/lib/analytics";
import { isPreviewStubMode } from "@/lib/previewStub";
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
const PREVIEW_STUB_FEED: InitialCommunityFeed = {
  posts: [],
  total: 0,
  hasMore: false,
  fetchedAt: "1970-01-01T00:00:00.000Z",
};
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

const primaryTopicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  href?: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Heart, label: "전체", helper: "모든 글", href: "/community" },
  { icon: ClipboardList, label: "정상인가요?", helper: "계약·추가금 질문", category: "is_normal" },
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
  { icon: ClipboardList, label: "예산", helper: "가격·견적 비교", query: "예산", category: "is_normal" },
  { icon: Megaphone, label: "박람회", helper: "혜택·일정", query: "박람회" },
  { icon: Shirt, label: "드레스", helper: "스타일 후기", query: "드레스", category: "tour_review" },
  { icon: ClipboardCheck, label: "예단·혼수", helper: "양가 준비", query: "예단" },
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
  const previewStubMode = isPreviewStubMode();
  useCommunityRealtime();

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
    if (previewStubMode) {
      useCommunityStore.getState().hydrateInitialFeed(PREVIEW_STUB_FEED);
      return;
    }
    if (!canUseInitialFeed || !initialFeed) return;
    useCommunityStore.getState().hydrateInitialFeed(initialFeed);
  }, [canUseInitialFeed, initialFeed, previewStubMode]);

  useEffect(() => {
    if (previewStubMode || isSearching) return;
    const store = useCommunityStore.getState();
    store.setCategory(selectedCategory);
    store.setTag(tagQuery || null);
    store.setAuthorId(authorQuery || null);
    store.fetchPosts(true);
  }, [authorQuery, currentPeriod, currentSort, isSearching, previewStubMode, selectedCategory, tagQuery]);

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
      <QuoteCheckHero />
      <WhatWeDo />
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
        isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && visiblePosts.length === 0 : isLoading}
        errorMessage={isSearching ? null : errorMessage}
        clearError={clearError}
      />
      <div ref={observerRef} className="h-1" />
      <Link
        {...weddingLinkProps("/community/post/write")}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#061a34] text-white shadow-[0_14px_34px_rgba(6,26,52,0.2)] transition-transform hover:-translate-y-0.5 md:hidden"
        aria-label="글쓰기"
        data-tutorial-target="community-write"
      >
        <PenSquare className="h-5 w-5" />
      </Link>
    </div>
  );
}

// 첫 방문자에게 커뮤니티(피드)보다 먼저 보여줄 "쐐기" — 견적 체크.
// 콜드스타트 단계에서 빈 피드가 첫인상이 되지 않도록, 로그인 없이 바로 쓰는
// 도구를 랜딩 최상단에 세운다. 문구는 판정 금지 원칙 준수(좋다/나쁘다 없음).
/**
 * 첫 화면에 세우는 공시 규모. 분기마다 공시가 갱신되므로 값이 바뀐다.
 * 2026-07-26 운영 v_public_vendor_policies 실조회: 831행 / 502업체.
 */
const PUBLISHED_VENDOR_COUNT = 502;
const PUBLISHED_POLICY_COUNT = 831;

/**
 * "그래서 여기서 뭘 할 수 있는데?"에 대한 답.
 *
 * 그동안 이 답을 첫방문 투어(CommunityFirstVisitTour)가 대신하고 있었다. 하지만
 * 투어는 5단계를 따라와야 값을 주고, 그전에 화면을 가린다 — 볼까 말까 하는 사람에게
 * 설명을 먼저 요구하는 셈이다. 페이지가 스스로 말하게 한다.
 *
 * 각 줄은 동사와 숫자로 쓴다. "결혼 준비를 같이 정리해요" 같은 문장은 아무것도
 * 약속하지 않는다. 로그인이 필요한지도 그 자리에서 밝힌다 — 눌러보고 나서
 * 가입을 요구받으면 그게 배신이다.
 */
function WhatWeDo() {
  const items = [
    {
      href: "/price",
      label: "업체 가격·위약금 보기",
      // 502는 **위약금을 공시한** 업체 수다(가격을 공개한 업체는 더 많다).
      // 한 숫자에 기본가·추가금·위약금 셋을 다 붙이면 틀린 주장이 된다.
      body: `공시한 스튜디오·드레스·메이크업·예식장의 기본가·추가금, 그리고 위약금 원문 ${PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건(업체 ${PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}곳)을 한 화면에서.`,
      note: "로그인 없이",
      external: true,
    },
    {
      href: "/community/quote-check",
      label: "받은 견적서 점검하기",
      body: "견적서에서 확인 안 된 항목과, 계약 전 업체에 보낼 질문을 3분 만에 정리해 드려요.",
      note: "로그인 없이 · 3분",
      external: false,
    },
    {
      href: "/chat",
      label: "아모라와 순서 잡기",
      body: "예식일만 알려주면 지금 뭐부터 해야 하는지, 예산을 어떻게 나눌지 같이 정리해요.",
      note: "가입 필요 · 무료",
      external: false,
    },
  ];

  return (
    <section className={`${shell} mt-4`} aria-labelledby="what-we-do-heading">
      <h2 id="what-we-do-heading" className="sr-only">웨딩한방에서 할 수 있는 것</h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              {...(item.external ? { href: item.href } : weddingLinkProps(item.href))}
              className="flex h-full flex-col rounded-[18px] border border-[#061a34]/10 bg-white px-5 py-4 transition-colors hover:border-[#36534E]/40"
            >
              <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-[#071629]">
                {item.label}
                <ChevronRight className="h-4 w-4 text-[#36534E]" />
              </span>
              <span className="mt-1.5 text-[13px] leading-[1.6] text-[#5d6879]">{item.body}</span>
              <span className="mt-2 text-[11px] font-semibold text-[#9d6f36]">{item.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* 투어는 이제 자동으로 뜨지 않는다 — 원하는 사람만 연다. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(COMMUNITY_TOUR_EVENT))}
        className="mt-3 inline-flex min-h-9 items-center text-[12px] font-semibold text-[#5d6879] underline underline-offset-4 hover:text-[#36534E]"
      >
        처음이신가요? 화면 따라 한 바퀴 보기
      </button>
    </section>
  );
}

function QuoteCheckHero() {
  return (
    <section className={`${shell} mt-4`} data-tutorial-target="landing-quote-check">
      <article className="overflow-hidden rounded-[18px] border border-[#d8bb86] bg-[linear-gradient(135deg,#fffdf8_0%,#ffffff_52%,#eef4f1_100%)] px-5 py-5 shadow-[0_10px_30px_rgba(8,22,38,0.05)] md:px-8 md:py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
              <ClipboardCheck className="h-3.5 w-3.5" />
              업체 {PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}곳 · 위약금 원문 {PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건 · 로그인 없이
            </span>
            {/* 첫 화면에는 우리만 가진 사실을 세운다.
                이전 문구("견적서 빠진 항목 확인")는 견적서를 이미 받은 사람만 대상으로
                삼아, 아직 알아보는 중인 대다수에게는 걸릴 것이 없었다. 아래 문장은
                공시 원문 대조에서 실제로 확인한 것이고(2026-07-26), 다른 어디서도
                볼 수 없다. 단정하지 않으려고 "경우가 있어요"까지 붙인다. */}
            <h1 className="mt-2.5 font-serif-kr text-[26px] font-medium leading-[1.3] text-[#071629] md:text-[30px]">
              같은 업체인데, 어느 대행사로 계약하냐에 따라 위약금이 달라요
            </h1>
            <p className="mt-2 max-w-xl text-[13px] font-medium leading-[1.65] text-[#5d6879] md:text-[14px]">
              촬영 60일 전 취소 기준으로 한쪽은 상품가의 20%인데 다른 쪽은 100%인
              경우가 있었어요. 업체가 공시한 위약금·환불 규정 원문을 그대로 모았습니다 —
              요약도, 어디가 낫다는 판정도 하지 않아요.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
            {/* 가장 강한 것을 첫 버튼으로. 로그인·견적서 없이 바로 값을 받는 경로다. */}
            <Link
              href="/price"
              onClick={() => captureEvent("price_hero_click", { source: "landing_hero" })}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642]"
            >
              업체별 위약금 보기
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              {...weddingLinkProps("/community/quote-check")}
              onClick={() => captureEvent("quote_check_hero_click", { source: "landing_hero" })}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#36534E]/30 bg-white px-6 text-[13px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/60"
            >
              내 견적서도 확인하기
            </Link>
            {/* 견적서가 없는 사람에게도 첫 행동을 준다(페르소나: 정보 과부하 신부·바쁜 신랑) */}
            <Link
              href="/start-here"
              data-tutorial-target="landing-start-here"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#36534E]/30 bg-white px-6 text-[13px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/60"
            >
              아직 견적 전이라면 · 지금 뭐부터?
            </Link>
            <Link
              href="/price"
              data-tutorial-target="landing-price"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#36534E]/30 bg-white px-6 text-[13px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/60"
            >
              업체별 공시가 먼저 보기
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
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#36534E] transition-colors hover:bg-[#eef4f1]"
          >
            <Search className="h-6 w-6" />
          </button>
        </label>
      </form>

      <div className="mt-4 flex flex-col gap-3 md:mt-5">
        {/* 375px에서 가로 스크롤이던 시절 6개 중 3개("스토리 & 꿀팁"·"선배 Q&A"·
            "자유")가 화면 밖에 놓여 스크롤 힌트도 없었다 — 커뮤니티 절반이 안 보였다.
            모바일은 3열로 접어 전부 노출한다. */}
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {primaryTopicItems.map((item) => {
            const active = isTopicActive(item);
            return (
              <Link
                key={item.label}
                {...weddingLinkProps(item.href ?? buildCommunityHubHref(item))}
                aria-label={`${item.label} 보기`}
                className={`group flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 rounded-[14px] border px-2 text-center transition-all sm:px-3 ${
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
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
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
        onSortChange={onSortChange}
        onPeriodChange={onPeriodChange}
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
  onSortChange,
  onPeriodChange,
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
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
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
  const feedMoreLabel = `${feedTitle} 더보기`;
  const previewDescription = isSearching
    ? `"${searchQuery}" ${formatCount(total)}건`
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
          : currentSort === "my_cohort"
            ? `내 동기방 게시글 ${formatCount(total)}개`
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
                  className="h-11 w-[100px] appearance-none rounded-full border border-[#eadfc9] bg-white px-4 pr-8 font-sans text-[13px] font-semibold leading-none text-[#34445a] outline-none focus:border-[#b68a3a]"
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
                    className="h-11 w-[100px] appearance-none rounded-full border border-[#eadfc9] bg-white px-4 pr-8 font-sans text-[13px] font-semibold leading-none text-[#34445a] outline-none focus:border-[#b68a3a]"
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
            className="hidden h-11 w-[100px] items-center justify-center gap-1.5 rounded-full bg-[#061a34] px-4 font-sans text-[13px] font-semibold leading-none text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] sm:inline-flex"
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
            아모라 추천
          </span>
          <h3 className="mt-1.5 line-clamp-1 font-serif-kr text-[17px] font-medium leading-[1.35] text-[#071629] sm:text-[18px]">
            후기에서 생긴 궁금증, 아모라에게 바로 물어보세요.
          </h3>
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
    <article
      className={`relative grid gap-2.5 py-2 first:pt-0 last:pb-0 sm:gap-3 ${
        imageUrl
          ? "grid-cols-[minmax(0,1fr)_72px] sm:grid-cols-[minmax(0,1fr)_104px] xl:grid-cols-[minmax(0,1fr)_112px]"
          : "grid-cols-1"
      }`}
    >
      <Link
        {...communityPostLinkProps(post.id)}
        aria-label={`${post.title} 게시글 보기`}
        className="absolute inset-0 z-0 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-[#36534E]/40"
      />
      {toast && (
        <span className="pointer-events-none absolute right-0 top-4 z-20 rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}

      <div className="pointer-events-none relative z-10 min-w-0">
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
          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleLike}
              disabled={voting}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded-full px-1 py-0.5 transition-colors ${
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
            {/* pointer-events-auto 행 안이라 span이면 카드 링크를 가로채고도
                아무 데도 가지 않는다 — 글로 직접 보내는 링크로 만든다. */}
            <Link
              {...communityPostLinkProps(post.id)}
              className="inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[#34445a] transition-colors hover:bg-[#fff8ec]"
              aria-label={(post.comment_count ?? 0) > 0 ? `댓글 ${post.comment_count}개 보기` : "첫 댓글 남기기"}
            >
              <MessageCircle className="h-3.5 w-3.5 stroke-[1.6]" />
              {(post.comment_count ?? 0) > 0 ? post.comment_count : "첫 댓글"}
            </Link>
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
      {imageUrl && (
        <div className="pointer-events-none relative z-10 h-[52px] w-[72px] overflow-hidden rounded-[10px] bg-[#f8f4ec] sm:h-[58px] sm:w-[104px] xl:h-[60px] xl:w-[112px]">
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
    </article>
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
  const previewStubMode = isPreviewStubMode();
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [loading, setLoading] = useState(!previewStubMode);

  useEffect(() => {
    if (previewStubMode) return;

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
  }, [previewStubMode]);

  const title = "이번 주 인기글";
  const moreHref = "/community?sort=top&period=week&feed=all#community-feed";

  return (
    <article className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-kr text-[24px] font-medium leading-[1.35] text-[#071629]">
          {title} <Flame className="inline h-5 w-5 fill-[#f26a3d] text-[#f26a3d]" />
        </h2>
        <Link {...weddingLinkProps(moreHref)} className="text-[13px] font-medium text-[#9d6f36]">
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
        이 글에서 궁금한 점을 아모라에게 이어서 물어보세요.
      </p>
      <Link
        {...weddingLinkProps("/chat")}
        className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-[#36534E] px-4 text-[13px] font-semibold text-white shadow-[0_10px_22px_rgba(54,83,78,0.16)]"
      >
        아모라에게 바로 묻기
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

// 슬러그·라벨의 유일한 출처는 공시가 카탈로그다. 손으로 적으면 라우트에 없는 값
// (DB 카테고리명 venue 등)이 섞여 404가 된다 — /price/[category]는 dynamicParams=false다.
const MARKET_SNAPSHOT_ICONS: Record<PriceCategory, LucideIcon> = {
  hall: Building2,
  studio: Camera,
  dress: Shirt,
  makeup: Palette,
};

// 비용 비중이 가장 큰 웨딩홀만 맨 앞으로 올리고 나머지는 카탈로그 순서를 그대로 따른다.
const MARKET_SNAPSHOT_CATEGORIES: readonly PriceCategory[] = [
  "hall",
  ...PRICE_CATEGORIES.filter((category) => category !== "hall"),
];

function MarketSnapshotPanel() {
  return (
    <article className="overflow-hidden rounded-[18px] border border-[#eadfc9] bg-[linear-gradient(145deg,#fffdf8_0%,#ffffff_55%,#fbf4e8_100%)] p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <span className="inline-flex rounded-full bg-[#fbefd6] px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
        출처·기준 시점 공개
      </span>
      <h2 className="mt-2 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629]">
        업체별 공시가 비교
      </h2>
      <p className="mt-1 text-[12px] font-medium leading-[1.55] text-[#7a8290]">
        코드에 고정된 평균가 대신, 검수·발행된 업체별 기본금과 선택품목을 확인하세요.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {MARKET_SNAPSHOT_CATEGORIES.map((category) => {
          const Icon = MARKET_SNAPSHOT_ICONS[category];
          return (
            <Link
              key={category}
              href={`/price/${category}`}
              className="group flex min-h-12 items-center justify-between rounded-[12px] border border-[#eadfc9] bg-white/80 px-3 text-[13px] font-semibold text-[#071629] transition-colors hover:bg-[#fff8ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[#b68a3a]" />
                {PRICE_CATEGORY_LABELS[category]}
              </span>
              <ChevronRight className="h-4 w-4 text-[#9d6f36] transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </div>

      <Link
        href="/price"
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#36534E] px-4 text-[13px] font-semibold text-white shadow-[0_10px_22px_rgba(54,83,78,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
      >
        전체 공시가 보기
      </Link>
    </article>
  );
}

function CohortPreviewPanel() {
  const previewStubMode = isPreviewStubMode();
  const { profile, journey, isInitialized, isLoading: authLoading } = useAuthStore();
  const [panelState, setPanelState] = useState<CohortPanelState>({ status: "idle" });
  const weddingDate = journey?.wedding_date ?? null;
  const userId = profile?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    async function syncMyCohort() {
      await Promise.resolve();
      if (cancelled) return;

      if (previewStubMode) {
        setPanelState({ status: "manual" });
        return;
      }

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
  }, [authLoading, isInitialized, previewStubMode, userId, weddingDate]);

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
        <Link
          {...weddingLinkProps("/community/cohort")}
          className="shrink-0 text-[13px] font-medium text-[#36534E]"
        >
          더보기
        </Link>
      </div>

      {panelState.status === "assigned" && panelState.roomId ? (
        <div className="space-y-3">
          <Link
            {...weddingLinkProps(`/community/cohort/${panelState.roomId}`)}
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
            {...weddingLinkProps("/community/cohort")}
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
              href={`/login?redirect=${encodeURIComponent(weddingPath("/community/cohort"))}`}
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
            {...weddingLinkProps(row.href)}
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
