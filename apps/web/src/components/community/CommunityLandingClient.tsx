"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Flame,
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
  Wallet,
} from "lucide-react";
import AdDisclosureBadge from "@/components/community/AdDisclosureBadge";
import Avatar from "@/components/community/Avatar";
import ContentOriginBadge from "@/components/community/ContentOriginBadge";
import EmptyFeedStarter from "@/components/community/EmptyFeedStarter";
import PostSkeleton from "@/components/community/PostSkeleton";
import CommunityAcquisitionPrototype, {
  parseCommunityPrototypeVariant,
} from "@/components/community/CommunityAcquisitionPrototype";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { PRICE_CATEGORIES, type PriceCategory } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { formatKrwManwon, type AgencySpreadSummary } from "@/lib/price/agencySpread";
import { disclosureRoundLabel } from "@/lib/price/period";
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
const sortValues: PostSort[] = [
  "new",
  "hot",
  "top",
  "unanswered",
  "resolved",
  "my_cohort",
  "my_posts",
];
const sortSelectValues: PostSort[] = ["new", "hot", "top", "my_cohort", "my_posts"];
const periodValues: TimePeriod[] = ["week", "month", "all"];

const sortLabels: Record<PostSort, string> = {
  hot: "인기순",
  new: "최신순",
  top: "도움된순",
  unanswered: "답변 기다려요",
  resolved: "해결된 고민",
  my_cohort: "내 동기글",
  my_posts: "내 글",
};

const periodLabels: Record<TimePeriod, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
};

const categoryDisplayLabels: Record<CommunityCategory, string> = {
  is_normal: "견적·계약",
  tour_review: "업체 경험",
  tips_v2: "준비 노하우",
  ama: "선배에게 묻기",
  free: "가족·관계",
};

const primaryTopicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  href?: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Sparkles, label: "처음이라 막막해요", helper: "준비 순서부터", query: "결혼 준비 순서", category: "ama" },
  { icon: ClipboardList, label: "견적·추가금", helper: "예상 밖 비용 확인", category: "is_normal" },
  { icon: AlertCircle, label: "계약·취소", helper: "위약금·환불 확인", query: "계약", category: "is_normal" },
  { icon: HeartHandshake, label: "가족·파트너", helper: "역할·부모님 고민", category: "free" },
];

const detailTopicItems: Array<{
  icon: LucideIcon;
  label: string;
  helper: string;
  query?: string;
  category?: CommunityCategory;
}> = [
  { icon: Building2, label: "결혼식장", helper: "장소·식사·견적", query: "결혼식장", category: "tour_review" },
  { icon: Camera, label: "사진 촬영", helper: "촬영 업체 상담과 계약", query: "사진", category: "tour_review" },
  { icon: Shirt, label: "드레스", helper: "입어본 경험과 계약", query: "드레스", category: "tour_review" },
  { icon: Sparkles, label: "헤어·메이크업", helper: "상담과 이용 경험", query: "메이크업", category: "tour_review" },
  { icon: ClipboardList, label: "예산", helper: "가격·견적 비교", query: "예산", category: "is_normal" },
  { icon: Megaphone, label: "박람회", helper: "혜택·일정", query: "박람회" },
  { icon: ClipboardCheck, label: "가족 선물·가전·가구", helper: "두 가족과 함께 정할 일", query: "양가 선물" },
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

function buildSearchQuestionHref(
  searchQuery: string,
  category: CommunityCategory | null,
) {
  const params = new URLSearchParams({
    prefill: "community_search",
    category: category ?? "is_normal",
    title: searchQuery.trim().slice(0, 120),
  });
  return `/community/post/write?${params.toString()}`;
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
  agencySpread,
}: {
  initialFeed?: InitialCommunityFeed;
  initialQuery?: CommunityFeedQuery;
  agencySpread?: AgencySpreadSummary;
}) {
  const previewStubMode = isPreviewStubMode();
  useCommunityRealtime();

  const router = useRouter();
  const urlSearchParams = useSearchParams();
  const prototypeVariant =
    process.env.NODE_ENV !== "production"
      ? parseCommunityPrototypeVariant(urlSearchParams.get("variant"))
      : null;
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
  const isAllFeedMode = feedQuery === "all";
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
  const showLandingIntro =
    !hasFocusedFeed &&
    feedQuery !== "all" &&
    normalizedSort === "new" &&
    normalizedPeriod === "week";
  const displayedPosts = visiblePosts;
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
      const params = new URLSearchParams({ feed: "all" });
      if (selectedCategory) params.set("category", selectedCategory);
      router.push(weddingPath(`/community?${params.toString()}#community-feed`));
      return;
    }
    captureEvent("community_search_submit", {
      query_length: trimmed.length,
      category: selectedCategory ?? "all",
    });
    const params = new URLSearchParams({ search: trimmed, feed: "all" });
    if (selectedCategory) params.set("category", selectedCategory);
    router.push(weddingPath(`/community?${params.toString()}#community-feed`));
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

  const searchHubNode = (
    <SearchHub
      searchDraft={searchDraft}
      searchQuery={searchQuery}
      onSearchDraftChange={setSearchDraft}
      onSubmit={submitSearch}
      selectedCategory={selectedCategory}
      currentTag={currentTag}
      onClearTag={() => {
        const params = new URLSearchParams({ feed: "all" });
        if (selectedCategory) params.set("category", selectedCategory);
        router.push(weddingPath(`/community?${params.toString()}#community-feed`));
      }}
      compact={showFullFeed}
    />
  );

  const communityMainNode = (
    <CommunityMain
      posts={displayedPosts}
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
      isLoading={isSearching ? searchLoading : isPreviewFeed ? isLoading && displayedPosts.length === 0 : isLoading}
      errorMessage={isSearching ? null : errorMessage}
      clearError={clearError}
      feedFirst={showFullFeed || showLandingIntro}
    />
  );

  if (prototypeVariant) {
    return (
      <CommunityAcquisitionPrototype
        variant={prototypeVariant}
        posts={displayedPosts}
        total={activeTotal}
      />
    );
  }

  return (
    <div
      className="bg-[#fffdf7] pb-16 text-[#061a34] md:pb-0"
      data-community-home-order="search-first"
    >
      {searchHubNode}
      {communityMainNode}
      {showLandingIntro && <AmoraBlock />}
      {showLandingIntro && <WhatWeDo />}
      {!isAllFeedMode && <DisclosureHero spread={agencySpread} />}
      <div ref={observerRef} className="h-1" />
    </div>
  );
}

/**
 * 하단 신뢰 근거에 쓰는 공시 규모. 분기마다 공시가 갱신되므로 값이 바뀐다.
 *
 * **업체 수는 DB 행 수가 아니라 "화면에 보이는 카드 수"다.**
 * `v_public_vendor_policies`의 `count(distinct vendor_id)`는 502지만, 같은 샵이
 * 대행사별로 여러 행에 들어와 있고 목록은 그것을 `vendorIdentityKey`로 한 장에
 * 묶는다. 2026-07-30 지점 오병합 2쌍을 해제한 뒤 사용자가 실제로 세는 업체는
 * 414곳이다.
 *
 * 502를 쓰면 첫 화면이 실제보다 22% 많은 수를 주장하게 된다 — 세어 보는 사람에게
 * 바로 들키는 종류의 과장이고, 하필 "판정하지 않고 사실만 보여준다"가 이 서비스의
 * 주장이라 더 나쁘다. 2026-07-26부터 이 상태였고 유통 글 게시 직전에 잡았다.
 *
 * 갱신 확인: `pnpm audit:production` (=== 1-c. 공시 규모 표기 ===)
 */
const PUBLISHED_VENDOR_COUNT = 414;
const PUBLISHED_POLICY_COUNT = 831;

/**
 * 아모라가 준비를 정리하고, 사람의 경험이 판단의 빈칸을 채운다는 하나의 약속을
 * 첫 화면에서 함께 보여준다. 커뮤니티를 별도 게시판처럼 소개하지 않고 실제 질문과
 * 바로 연결해 "도움을 받는 곳이면서 주는 곳"이라는 행동을 먼저 만든다.
 */
function AmoraBlock() {
  return (
    <section
      className={`${shell} border-b border-[#eadfc9] py-5 md:py-9`}
      data-tutorial-target="landing-amora"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-12">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef4f1] px-3 py-1 text-[11px] font-semibold text-[#36534E]">
            찾은 답을 내 준비에 반영하기
          </span>
          <h2 className="mt-3 font-serif-kr text-[28px] font-medium leading-[1.25] text-[#071629] md:text-[30px]">
            사람의 경험을 찾았다면,
            <br />
            우리 둘의 계획으로 옮기세요
          </h2>
          <p className="mt-3 max-w-xl text-[13px] font-medium leading-[1.75] text-[#5d6879] md:text-[14px]">
            커뮤니티에서 확인한 조건과 다음 행동을 아모라에게 이어서 말해보세요.
            웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께
            정리되는 서비스예요.
          </p>

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link
              {...weddingLinkProps("/chat")}
              onClick={() => captureEvent("amora_block_click", { source: "landing_amora_block" })}
              className="group inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] sm:w-auto"
            >
              아모라로 내 상황 정리하기
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              {...weddingLinkProps("/community?feed=all#community-search")}
              onClick={() => captureEvent("community_hero_click", { action: "find_experience" })}
              className="inline-flex min-h-[50px] w-full items-center justify-center gap-1.5 rounded-full border border-[#d8c7ad] bg-white px-6 text-[14px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/45 sm:w-auto"
            >
              다른 해결 경험 더 보기
              <Search className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-3 text-[11.5px] font-medium leading-[1.6] text-[#7a8290]">
            AI의 제안과 사람의 경험은 구분해서 보여주고, 최종 결정은 사용자가 합니다.
          </p>
        </div>

        <article
          id="decision-start"
          data-tutorial-target="community-decision-start"
          className="border-y border-[#d8c7ad] bg-white/64 py-4 sm:px-5 lg:rounded-[18px] lg:border lg:p-5"
          aria-labelledby="decision-start-heading"
        >
          <div>
            <span className="text-[11px] font-semibold text-[#A77B74]">경험에서 행동으로</span>
            <h2
              id="decision-start-heading"
              className="mt-1 font-serif-kr text-[20px] font-medium leading-[1.35] text-[#071629]"
            >
              확인한 내용을 어디에 남길까요?
            </h2>
            <p className="mt-1.5 text-[12px] font-medium leading-[1.6] text-[#7a8290]">
              필요한 것 하나만 골라도 내 준비 흐름에 이어집니다.
            </p>
          </div>

          <div className="mt-4 divide-y divide-[#eadfc9] border-y border-[#eadfc9]">
            <Link
              {...weddingLinkProps("/community/quote-check")}
              onClick={() => captureEvent("community_decision_click", { intent: "quote_check" })}
              className="group grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef4f1] text-[#36534E]">
                <Wallet className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#263832]">견적 조건 다시 확인</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#7a8290]">
                    포함·별도·확인 필요 항목 정리하기
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-[#9d6f36] transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              {...weddingLinkProps("/community?search=계약&feed=all#community-feed")}
              onClick={() => captureEvent("community_decision_click", { intent: "vendor_contract" })}
              className="group grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4e8e5] text-[#8F6662]">
                <Building2 className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#263832]">계약 경험 더 찾아보기</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#7a8290]">
                    놓친 조건이 없는지 한 번 더 비교하기
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-[#9d6f36] transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
              onClick={() => captureEvent("community_decision_click", { intent: "ask_question" })}
              className="group grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3"
              data-tutorial-target="community-write"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f8f0df] text-[#9d6f36]">
                <MessageCircle className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#263832]">남은 질문 이어서 묻기</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#7a8290]">
                    검색으로 풀리지 않은 부분만 구체화하기
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-[#9d6f36] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <p className="mt-3 text-[11px] font-medium leading-[1.6] text-[#7a8290]">
            공개된 경험은 판단 근거로 참고하고, 우리 상황에 맞는 결정은 둘이 직접 정합니다.
          </p>
        </article>
      </div>
    </section>
  );
}

function WhatWeDo() {
  const tools = [
    {
      icon: ClipboardList,
      label: "체크리스트",
      body: "대화에서 정한 다음 할 일과 끝낸 일을 한곳에서 이어서 봐요.",
      href: "/schedule",
    },
    {
      icon: Wallet,
      label: "예산",
      body: "계획한 금액과 실제로 쓴 금액을 항목별로 바로 정리해요.",
      href: "/budget",
    },
    {
      icon: CalendarCheck,
      label: "일정",
      body: "날짜가 있는 할 일과 약속을 놓치지 않게 일정으로 남겨요.",
      href: "/schedule",
    },
  ];

  return (
    <section className={`${shell} py-5 md:py-7`} aria-labelledby="what-we-do-heading">
      <div className="grid gap-4 md:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)] md:items-start md:gap-8">
        <div>
          <span className="text-[11px] font-semibold text-[#9d6f36]">대화에서 끝나지 않아요</span>
          <h2
            id="what-we-do-heading"
            className="mt-1 font-serif-kr text-[21px] font-medium leading-[1.35] text-[#071629]"
          >
            말한 준비가
            <br className="hidden md:block" /> 도구로 이어져요
          </h2>
        </div>
        <ol className="grid border-y border-[#eadfc9] sm:grid-cols-3 sm:divide-x sm:divide-[#eadfc9]">
          {tools.map((tool) => (
            <li key={tool.label} className="border-b border-[#eadfc9] py-3.5 last:border-b-0 sm:border-b-0 sm:px-4 first:sm:pl-0 last:sm:pr-0">
              <Link
                {...weddingLinkProps(tool.href)}
                onClick={() =>
                  captureEvent("what_we_do_click", { href: tool.href, label: tool.label })
                }
                className="group block"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef4f1]">
                  <tool.icon className="h-4 w-4 text-[#36534E]" />
                </span>
                <strong className="mt-1 block text-[13.5px] font-bold text-[#263832]">
                  {tool.label}
                </strong>
                <span className="mt-1 block text-[12px] font-medium leading-[1.6] text-[#5d6879]">
                  {tool.body}
                </span>
                <span className="mt-2 inline-flex items-center text-[11px] font-semibold text-[#36534E]">
                  바로가기
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
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

/**
 * 공시 가격은 제품의 정체성이 아니라 하단의 신뢰 근거다. 숫자가 없으면
 * (공시 조회 실패·프리뷰 스텁) 지어내지 않고 문장 버전으로 표시한다.
 */
function DisclosureHero({ spread }: { spread?: AgencySpreadSummary }) {
  const highlights = spread?.highlights.slice(0, 3) ?? [];
  const comparable = spread?.comparableVendors ?? 0;
  const differing = spread?.differingVendors ?? 0;
  const hasEvidence = highlights.length > 0 && differing > 0 && comparable >= differing;

  return (
    <section className={`${shell} mt-4`} data-tutorial-target="landing-hero">
      {/* 진한 초록은 이 화면에서 새로 만든 색이 아니라 푸터가 이미 쓰는 계열이다
          (#183832 → #2f5f55 → #12302b). 크림색 페이지 위에서 첫 화면만 무게를
          갖게 하되 팔레트는 늘리지 않는다. */}
      <article className="overflow-hidden rounded-[22px] bg-[#12302b] px-5 py-6 shadow-[0_18px_46px_rgba(8,34,28,0.22)] md:px-9 md:py-8">
        {/* 모바일은 세로 한 줄이고, 순서가 곧 우선순위다: 문장 → **증거** → 행동.
            증거를 CTA 뒤로 두면 3초 안에 보이는 것이 다시 주장뿐이 된다.
            데스크톱에서는 증거를 오른쪽 열에 세로로 붙인다. */}
        <div
          className={
            hasEvidence
              ? "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-x-10 lg:gap-y-5"
              : "flex flex-col gap-5"
          }
        >
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8c79a]/35 bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-[#e8dcb8]">
              <ClipboardCheck className="h-3.5 w-3.5" />
              한국소비자원 참가격 · {disclosureRoundLabel()} 공시
            </span>

            <h2 className="mt-3 font-serif-kr text-[28px] font-medium leading-[1.28] text-white md:text-[36px]">
              같은 업체인데,
              <br />
              대행사마다 가격이 다릅니다
            </h2>

            {hasEvidence ? (
              // 대표성은 최대 사례가 아니라 이 비율이 말한다. 최대 사례만 띄우면
              // 그게 보통인 것처럼 읽히고, 그건 우리가 하지 않기로 한 과장이다.
              <p className="mt-3 max-w-xl text-[14px] font-medium leading-[1.7] text-[#dbe7e0] md:text-[15px]">
                대행사 2곳 이상이 공시한 업체 {comparable.toLocaleString("ko-KR")}곳 중{" "}
                <b className="font-serif-kr text-[19px] font-medium text-[#f2e8c8] md:text-[21px]">
                  {differing.toLocaleString("ko-KR")}곳
                </b>
                에서 대행사에 따라 공시 기본가가 달랐어요.
              </p>
            ) : (
              <p className="mt-3 max-w-xl text-[14px] font-medium leading-[1.7] text-[#dbe7e0] md:text-[15px]">
                업체가 공시한 기본가·추가금과 취소 위약금 규정을 원문 그대로 모았어요.
              </p>
            )}

            <p className="mt-2 max-w-xl text-[12.5px] font-medium leading-[1.65] text-[#a9c0b7]">
              업체가 쓴 문장 그대로 옮깁니다 — 요약도, 어디가 낫다는 판정도 하지 않아요.
            </p>
          </div>

          {hasEvidence && (
            <div className="min-w-0 rounded-[18px] border border-white/12 bg-white/[0.05] p-3.5 md:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
              <p className="px-1 text-[11px] font-semibold text-[#9fb8ae]">
                카테고리별로, 같은 업체를 취급한 대행사끼리 차이가 가장 컸던 사례
              </p>
              <ul className="mt-2.5 space-y-2">
                {highlights.map((row) => (
                  <li key={`${row.category}-${row.itemLabel ?? "vendor"}`}>
                    <Link
                      href={`/price/${row.category}`}
                      prefetch={false}
                      onClick={() => captureEvent("price_hero_click", { source: "landing_spread_row" })}
                      className="group block rounded-[14px] border border-white/12 bg-white/[0.06] px-3.5 py-3 transition-colors hover:border-[#d8c79a]/55 hover:bg-white/[0.11]"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                        {/* 업체명은 세우지 않는다. 묶음 공시의 item_name은 매장 이름이라
                            그대로 쓰면 첫 화면이 특정 업체를 지목하는 화면이 된다. */}
                        <span className="min-w-0 truncate text-[#e8dcb8]">
                          {PRICE_CATEGORY_LABELS[row.category]}
                          {row.itemLabel ? ` · ${row.itemLabel}` : ""}
                        </span>
                        <span className="shrink-0 text-white/45">대행사 {row.agencyCount}곳</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2.5">
                        <b className="shrink-0 font-serif-kr text-[19px] font-medium text-white">
                          {formatKrwManwon(row.lowKrw)}
                        </b>
                        <span className="h-px min-w-4 flex-1 bg-[linear-gradient(90deg,rgba(216,199,154,0.2),rgba(216,199,154,0.8))]" />
                        <b className="shrink-0 font-serif-kr text-[19px] font-medium text-white">
                          {formatKrwManwon(row.highKrw)}
                        </b>
                        <span className="shrink-0 rounded-full bg-[#d8c79a]/16 px-2 py-0.5 text-[11px] font-bold text-[#f2e8c8]">
                          +{formatKrwManwon(row.gapKrw)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* 구성까지 같다고는 말할 수 없다(공시 문구가 글자까지 같은 업체는 실측
                  16곳뿐). 첫 화면에서 미리 밝혀야 상세에서 다른 구성을 보고 배신감이
                  들지 않는다. */}
              <p className="mt-2.5 px-1 text-[11px] font-medium leading-[1.6] text-[#8fa89e]">
                같은 업체를 취급하는 대행사들의 공시 기본가예요. 앨범 페이지·의상 벌수 같은
                포함 구성도 함께 다를 수 있으니 계약 전 원문을 확인하세요.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
              {/* 강조는 하나. 로그인·견적서 없이 바로 값을 받는 경로다. */}
              <Link
                href="/price"
                data-tutorial-target="landing-price"
                onClick={() => captureEvent("price_hero_click", { source: "landing_hero" })}
                className="group inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#f2e8c8] px-7 py-3.5 text-[15px] font-bold text-[#12302b] shadow-[0_14px_30px_rgba(0,0,0,0.22)] transition-transform hover:-translate-y-0.5 sm:w-auto sm:self-start"
              >
                내 업체는 얼마나 다른지 보기
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <p className="text-[11.5px] font-semibold text-[#9fb8ae]">
                업체 {PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}곳 · 위약금 원문{" "}
                {PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건 · 로그인 없이
              </p>

              {/* 견적서 점검은 히어로에서 뺐다. 견적서를 **이미 받은 사람**만 쓸 수
                  있는 도구인데 첫 방문자 대다수는 아직 없고, 유통 글은 `/check`로
                  직접 착지시키므로 이 자리를 거치지 않는다. 아래 3블록에 남긴다. */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-3">
                <Link
                  href="/start-here"
                  data-tutorial-target="landing-start-here"
                  className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-[#e8dcb8] underline underline-offset-4 hover:text-white"
                >
                  아직 아무것도 안 알아봤다면 · 지금 뭐부터?
                </Link>
              </div>
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
  compact = false,
}: {
  searchDraft: string;
  searchQuery: string;
  onSearchDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selectedCategory: CommunityCategory | null;
  currentTag: string | null;
  onClearTag: () => void;
  compact?: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(() =>
    detailTopicItems.some((item) => item.query && searchQuery.includes(item.query))
  );
  const isTopicActive = (item: (typeof primaryTopicItems)[number] | (typeof detailTopicItems)[number]) => {
    if ("href" in item && item.href?.startsWith("/community")) {
      return !selectedCategory && !searchQuery && !currentTag;
    }
    if (item.query) return searchQuery.includes(item.query);
    if (item.category) return selectedCategory === item.category && !searchQuery;
    return false;
  };
  const activeDetailCount = detailTopicItems.filter(isTopicActive).length;

  if (compact) {
    return (
      <section
        id="community-search"
        className={`${shell} scroll-mt-24 pt-3`}
        aria-labelledby="community-search-heading"
      >
        <div
          className="border-b border-[#d8c7ad] pb-3"
          data-tutorial-target="community-categories"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10.5px] font-semibold text-[#A77B74]">
                사람들의 결혼 준비
              </span>
              <h1
                id="community-search-heading"
                className="mt-0.5 whitespace-nowrap font-serif-kr !text-[22px] font-medium leading-[1.25] text-[#071629] md:!text-[24px]"
              >
                결혼 준비 이야기
              </h1>
              <p className="mt-0.5 hidden text-[11.5px] font-medium text-[#7a8290] sm:block">
                비슷한 상황을 찾고, 없으면 물어보세요.
              </p>
            </div>
            <Link
              {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#36534E] px-4 text-[12px] font-semibold text-white"
              data-tutorial-target="community-write"
            >
              고민 올리기
              <PenSquare className="h-3.5 w-3.5" />
            </Link>
          </div>

          <form onSubmit={onSubmit} className="mt-2.5">
            <label className="relative block">
              <span className="sr-only">커뮤니티 글 검색</span>
              <input
                name="search"
                value={searchDraft}
                onChange={(event) => onSearchDraftChange(event.target.value)}
                placeholder="업체명·추가금·계약 고민 검색"
                className="h-[52px] w-full rounded-full border border-[#d8c7ad] bg-white px-4 pr-14 text-[13px] font-medium text-[#061a34] outline-none placeholder:text-[#a89278] focus:border-[#36534E] sm:pr-28"
              />
              <button
                type="submit"
                aria-label="커뮤니티 글 검색"
                className="absolute right-1 top-1/2 flex h-11 min-w-11 -translate-y-1/2 items-center justify-center gap-1 rounded-full bg-[#36534E] px-2.5 text-white sm:min-w-[92px]"
              >
                <Search className="h-4 w-4" />
                <span className="hidden text-[11px] font-semibold sm:inline">검색</span>
              </button>
            </label>
          </form>

          <nav
            className="-mx-4 mt-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0"
            aria-label="커뮤니티 주제"
          >
            <div className="flex min-w-max items-center gap-1.5">
              {primaryTopicItems.map((item) => {
                const active = isTopicActive(item);
                return (
                  <Link
                    key={item.label}
                    {...weddingLinkProps(item.href ?? buildCommunityHubHref(item))}
                    onClick={() =>
                      captureEvent("community_topic_click", {
                        topic: item.label,
                        category: item.category ?? "all",
                      })
                    }
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-colors ${
                      active
                        ? "border-[#36534E] bg-[#36534E] text-white"
                        : "border-[#eadfc9] bg-white text-[#4f5e70] hover:border-[#36534E]/40"
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5 stroke-[1.7]" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          {(currentTag || searchQuery) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {currentTag && (
                <button
                  type="button"
                  onClick={onClearTag}
                  className="inline-flex min-h-11 items-center rounded-full border border-[#eadfc9] bg-[#fbefd6] px-3 text-[11.5px] font-medium text-[#9d6f36]"
                >
                  #{currentTag} 지우기
                </button>
              )}
              {searchQuery && (
                <Link
                  {...weddingLinkProps("/community?feed=all")}
                  className="inline-flex min-h-11 items-center rounded-full border border-[#eadfc9] bg-white px-3 text-[11.5px] font-medium text-[#36534E]"
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

  return (
    <section
      id="community-search"
      className={`${shell} scroll-mt-24 pt-6 md:pt-10`}
      aria-labelledby="community-search-heading"
    >
      <div
        className="overflow-hidden rounded-[24px] border border-[#d8c7ad] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(247,241,232,0.9))] px-4 py-5 shadow-[0_18px_50px_rgba(8,22,38,0.06)] md:px-9 md:py-8"
        data-tutorial-target="community-categories"
      >
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between md:mb-7">
        <div className="max-w-[760px]">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-[#A77B74]">결혼 준비 결정 커뮤니티</span>
          <h1
            id="community-search-heading"
            className="mt-2 font-serif-kr text-[29px] font-medium leading-[1.24] tracking-[-0.025em] text-[#071629] sm:text-[34px] md:text-[40px]"
          >
            계약하기 전에,
            <br className="sm:hidden" /> 먼저 겪은 사람에게 확인하세요.
          </h1>
          <p className="mt-3 max-w-[680px] text-[13px] font-medium leading-[1.7] text-[#5d6879] md:text-[14px]">
            내 상황과 가까운 해결 경험부터 찾아보세요. 후기만 나열하지 않고 질문,
            사람의 답변, 질문자가 표시한 해결 여부를 한 흐름으로 보여드립니다.
          </p>
        </div>
        <Link
          {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#d8c7ad] bg-white px-4 text-[12px] font-semibold text-[#36534E] transition-colors hover:border-[#36534E]/45"
        >
          내 상황 질문하기
          <PenSquare className="h-3.5 w-3.5" />
        </Link>
      </div>
      <form onSubmit={onSubmit} className="mx-auto max-w-[840px]">
        <label className="relative block">
          <span className="sr-only">커뮤니티 검색</span>
          <input
            name="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
            placeholder="예: 촬영 결과물 별도 금액, 계약 취소 때 내는 금액"
            className="h-[58px] w-full rounded-full border border-[#cbb99d] bg-white px-5 pr-14 text-[14px] font-medium text-[#061a34] shadow-[0_8px_24px_rgba(8,22,38,0.05)] outline-none placeholder:text-[#a89278] focus:border-[#36534E] focus:shadow-[0_0_0_3px_rgba(54,83,78,0.1)] sm:pr-40 md:h-[62px] md:px-7 md:text-[15px]"
          />
          <button
            type="submit"
            aria-label="비슷한 해결 경험 찾기"
            className="absolute right-1.5 top-1/2 flex h-11 min-w-11 -translate-y-1/2 items-center justify-center gap-1.5 rounded-full bg-[#36534E] px-3 text-white transition-colors hover:bg-[#2d4642] sm:min-w-[132px] md:h-[50px]"
          >
            <Search className="h-5 w-5" />
            <span className="hidden text-[12px] font-semibold sm:inline">경험 찾기</span>
          </button>
        </label>
      </form>

      <div className="mt-3 grid gap-1.5 text-[11px] font-medium leading-[1.5] text-[#667268] sm:grid-cols-3 sm:gap-3">
        <span className="flex items-center gap-2"><Search className="h-3.5 w-3.5 text-[#36534E]" />비슷한 상황을 먼저 검색</span>
        <span className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-[#36534E]" />사람이 직접 남긴 답변 확인</span>
        <span className="flex items-center gap-2"><ClipboardCheck className="h-3.5 w-3.5 text-[#36534E]" />출처·광고·해결 상태 표시</span>
      </div>

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
                onClick={() =>
                  captureEvent("community_topic_click", {
                    topic: item.label,
                    category: item.category ?? "all",
                  })
                }
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
            게시판 형식보다 지금 해결하려는 문제에 가까운 주제를 골라보세요.
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
              onClick={() =>
                captureEvent("community_topic_click", {
                  topic: item.label,
                  category: item.category ?? "all",
                })
              }
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
  feedFirst,
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
  feedFirst: boolean;
}) {
  return (
    <section
      id="community-feed"
      className={`${shell} ${feedFirst ? "mt-2" : "mt-4"} grid grid-cols-1 items-start gap-[18px] scroll-mt-24 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_360px]`}
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
        feedFirst={feedFirst}
      />
      <RightPanels desktopOnly={feedFirst || isPreviewFeed} />
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
  feedFirst,
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
  feedFirst: boolean;
}) {
  const feedTitle = isSearching
    ? "내 상황과 가까운 경험"
    : selectedCategory
      ? `${categoryDisplayLabels[selectedCategory]} 경험`
      : currentSort === "hot"
        ? "인기 글"
        : currentSort === "unanswered"
          ? "답변을 기다리는 고민"
          : currentSort === "resolved"
            ? "해결된 고민"
            : currentSort === "top"
          ? currentPeriod === "week"
            ? "이번 주 도움된 글"
            : currentPeriod === "month"
              ? "이번 달 도움된 글"
              : "도움된 글"
          : currentSort === "my_cohort"
            ? "내 동기글"
            : currentSort === "my_posts"
              ? "내 글"
              : isPreviewFeed
                ? "지금 예비부부들이 나누는 이야기"
                : "지금 올라온 글";
  const feedMoreLabel = `${feedTitle} 더보기`;
  const previewDescription = isSearching
    ? `"${searchQuery}"와 가까운 공개 경험 ${formatCount(total)}건`
    : selectedCategory
      ? `${categoryDisplayLabels[selectedCategory]} 게시글 ${formatCount(total)}개`
      : currentSort === "hot"
        ? `반응이 높은 게시글 ${formatCount(total)}개`
        : currentSort === "unanswered"
          ? `아직 첫 답변을 기다리는 고민 ${formatCount(total)}개`
          : currentSort === "resolved"
            ? `질문자가 해결 표시한 고민 ${formatCount(total)}개`
            : currentSort === "top"
          ? currentPeriod === "week"
            ? `최근 7일 도움돼요 기준 게시글 ${formatCount(total)}개`
            : currentPeriod === "month"
              ? `최근 30일 도움돼요 기준 게시글 ${formatCount(total)}개`
              : `도움돼요 기준 게시글 ${formatCount(total)}개`
          : currentSort === "my_cohort"
            ? `내 동기방 게시글 ${formatCount(total)}개`
              : currentSort === "my_posts"
                ? `내가 쓴 게시글 ${formatCount(total)}개`
                : isPreviewFeed
                  ? `최근 글 ${formatCount(posts.length)}개를 먼저 보여드려요`
                  : `공개 글 ${formatCount(total)}개`;

  return (
    <article
      className={`border border-[#eadfc9] bg-white/88 ${
        feedFirst
          ? "rounded-[14px] p-3 shadow-none sm:rounded-[18px] sm:p-5 sm:shadow-[0_10px_30px_rgba(8,22,38,0.045)]"
          : "rounded-[18px] p-4 shadow-[0_10px_30px_rgba(8,22,38,0.045)] sm:p-5"
      }`}
    >
      <div
        className={
          feedFirst
            ? "mb-1 flex flex-wrap items-center justify-between gap-2"
            : "mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        }
      >
        <div>
          <h2
            className={`font-serif-kr font-medium leading-[1.3] text-[#071629] ${
              feedFirst ? "text-[19px] sm:text-[22px]" : "text-[21px] sm:text-[22px]"
            }`}
          >
            {feedTitle}
          </h2>
          <p
            className={`mt-1 text-[12px] font-medium text-[#7a8290] ${
              feedFirst ? "hidden sm:block" : ""
            }`}
          >
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
                  className={`appearance-none rounded-full border border-[#eadfc9] bg-white px-4 pr-8 font-sans text-[13px] font-semibold leading-none text-[#34445a] outline-none focus:border-[#b68a3a] ${
                    feedFirst ? "h-11 w-[94px]" : "h-11 w-[100px]"
                  }`}
                >
                  {sortSelectValues.map((sort) => (
                    <option key={sort} value={sort}>
                      {sortLabels[sort]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b68a3a]" />
              </label>
              {currentSort === "top" && (
                <label className="relative">
                  <span className="sr-only">도움된 기간</span>
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
          {!feedFirst && (
            <Link
              {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
              className="hidden h-11 min-w-[112px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#061a34] px-4 font-sans text-[13px] font-semibold leading-none text-white shadow-[0_12px_24px_rgba(6,26,52,0.16)] sm:inline-flex"
              data-tutorial-target="community-write"
            >
              질문하기
              <PenSquare className="h-4 w-4 shrink-0" />
            </Link>
          )}
        </div>
      </div>

      {feedFirst && !isSearching && (
        <nav
          aria-label="고민 상태별 보기"
          className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Link
            {...weddingLinkProps("/community?feed=all&sort=unanswered#community-feed")}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[12px] font-semibold ${
              currentSort === "unanswered"
                ? "border-[#36534E] bg-[#36534E] text-white"
                : "border-[#eadfc9] bg-[#fffdf8] text-[#36534E]"
            }`}
          >
            답변 기다려요
          </Link>
          <Link
            {...weddingLinkProps("/community?feed=all&sort=resolved#community-feed")}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[12px] font-semibold ${
              currentSort === "resolved"
                ? "border-[#36534E] bg-[#36534E] text-white"
                : "border-[#eadfc9] bg-[#fffdf8] text-[#36534E]"
            }`}
          >
            해결된 고민
          </Link>
          <Link
            {...weddingLinkProps("/community/my/posts")}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-[#eadfc9] bg-[#fffdf8] px-3.5 text-[12px] font-semibold text-[#36534E]"
          >
            내 글
          </Link>
        </nav>
      )}

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
          <div className="rounded-[16px] border border-[#d8c7ad] bg-[#fffdf7] px-5 py-8 text-center sm:px-8">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4f1] text-[#36534E]">
              <Search className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-serif-kr text-[19px] font-medium text-[#071629]">
              아직 같은 상황의 공개 경험을 찾지 못했어요
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-[13px] font-medium leading-[1.7] text-[#6f7886]">
              방금 입력한 내용으로 질문 초안을 만들 수 있어요. 게시 전에 공개될 내용을
              확인하고 고칠 수 있습니다.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Link
                {...weddingLinkProps(buildSearchQuestionHref(searchQuery, selectedCategory))}
                onClick={() =>
                  captureEvent("community_search_empty_click", { action: "create_question" })
                }
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#36534E] px-5 text-[13px] font-semibold text-white sm:w-auto"
              >
                이 내용으로 질문 만들기
                <PenSquare className="h-4 w-4" />
              </Link>
              <Link
                {...weddingLinkProps("/chat")}
                onClick={() =>
                  captureEvent("community_search_empty_click", { action: "organize_with_amora" })
                }
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#d8c7ad] bg-white px-5 text-[13px] font-semibold text-[#36534E] sm:w-auto"
              >
                아모라와 먼저 정리하기
              </Link>
            </div>
          </div>
        ) : currentSort === "unanswered" ||
          currentSort === "resolved" ||
          currentSort === "top" ? (
          <StatusFeedEmptyState status={currentSort} />
        ) : (
          <EmptyFeedStarter />
        )
      ) : (
        <div className="divide-y divide-[#eadfc9]">
          {posts.map((post, index) => (
            <Fragment key={post.id}>
              <CommunityPostRow post={post} priority={index < 2} />
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

function StatusFeedEmptyState({
  status,
}: {
  status: "unanswered" | "resolved" | "top";
}) {
  const content =
    status === "resolved"
      ? {
          eyebrow: "해결 기록 0개",
          title: "아직 해결 표시된 고민이 없어요",
          description:
            "답변을 기다리는 고민에 경험을 보태주세요. 작성자가 해결됐다고 표시한 질문부터 이곳에 차곡차곡 쌓입니다.",
          primaryLabel: "답변 기다리는 고민 보기",
          primaryHref: "/community?feed=all&sort=unanswered#community-feed",
          secondaryLabel: "내 고민 올리기",
          secondaryHref:
            "/community/post/write?prefill=community_question&category=is_normal",
        }
      : status === "unanswered"
        ? {
            eyebrow: "답변 대기 0개",
            title: "지금은 답변을 기다리는 고민이 없어요",
            description:
              "막힌 일을 남기면 비슷한 준비를 해본 사람에게 답을 받을 수 있어요. 로그인은 게시할 때만 필요합니다.",
            primaryLabel: "내 고민 올리기",
            primaryHref:
              "/community/post/write?prefill=community_question&category=is_normal",
            secondaryLabel: "모든 글 보기",
            secondaryHref: "/community?feed=all&sort=new#community-feed",
          }
        : {
            eyebrow: "도움 반응 0개",
            title: "아직 이 기간에 도움 반응을 받은 글이 없어요",
            description:
              "도움돼요가 한 번이라도 눌린 글만 이곳에 보여요. 최근 글을 읽고 실제로 도움이 된 경험을 표시해주세요.",
            primaryLabel: "최신 글 보기",
            primaryHref: "/community?feed=all&sort=new#community-feed",
            secondaryLabel: "내 고민 올리기",
            secondaryHref:
              "/community/post/write?prefill=community_question&category=is_normal",
          };

  return (
    <section className="rounded-[16px] border border-[#d8c7ad] bg-[#fffdf7] px-5 py-7 sm:px-8 sm:py-9">
      <span className="inline-flex rounded-full bg-[#eef4f1] px-3 py-1 text-[11px] font-semibold text-[#36534E]">
        {content.eyebrow}
      </span>
      <h3 className="mt-3 font-serif-kr text-[20px] font-medium text-[#071629] sm:text-[22px]">
        {content.title}
      </h3>
      <p className="mt-2 max-w-xl text-[13px] font-medium leading-[1.7] text-[#6f7886]">
        {content.description}
      </p>
      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        <Link
          {...weddingLinkProps(content.primaryHref)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-[#36534E] px-5 text-[13px] font-semibold text-white"
        >
          {content.primaryLabel}
          <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          {...weddingLinkProps(content.secondaryHref)}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#d8c7ad] bg-white px-5 text-[13px] font-semibold text-[#36534E]"
        >
          {content.secondaryLabel}
        </Link>
      </div>
    </section>
  );
}

// 피드 사이 아모라 인라인 프로모는 제거했다 — 히어로 바로 다음에 아모라 블록이
// 크게 서므로, 두 게시글 뒤에서 같은 곳을 다시 권하면 반복이 된다. 글 안에서의
// 맥락 있는 진입은 우측 AmoraSidebarPanel과 플로팅 런처가 계속 맡는다.

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
  const commentCount = post.comment_count ?? 0;
  const isQuestionPost = ["is_normal", "ama"].includes(post.category);
  const isWaitingForAnswer = isQuestionPost && !post.is_resolved && commentCount === 0;

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
      captureEvent("community_post_helpful", {
        action: next === 1 ? "add" : "remove",
        category: post.category,
      });
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
      captureEvent("community_post_bookmark", {
        action: bookmarked ? "remove" : "add",
        category: post.category,
      });
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
        captureEvent("community_post_share", { method: "native", category: post.category });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("링크가 복사됐어요");
      captureEvent("community_post_share", { method: "clipboard", category: post.category });
    } catch {
      showToast("공유 링크를 만들지 못했어요");
    }
  }

  return (
    <article
      className={`relative grid gap-3 py-4 first:pt-1 last:pb-1 ${
        imageUrl
          ? "grid-cols-[minmax(0,1fr)_64px] sm:grid-cols-[minmax(0,1fr)_104px] xl:grid-cols-[minmax(0,1fr)_112px]"
          : "grid-cols-1"
      }`}
    >
      <Link
        {...communityPostLinkProps(post.id)}
        onClick={() =>
          captureEvent("community_post_open", {
            source: "landing_feed",
            category: post.category,
            answer_state: post.is_resolved
              ? "resolved"
              : isWaitingForAnswer
                ? "waiting"
                : "answered",
          })
        }
        aria-label={`${post.title} 게시글 보기`}
        className="absolute inset-0 z-0 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-[#36534E]/40"
      />
      {toast && (
        <span className="pointer-events-none absolute right-0 top-4 z-20 rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {toast}
        </span>
      )}

      <div className="pointer-events-none relative z-10 min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2 text-[10.5px] font-medium text-[#7a8290]">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="shrink-0 rounded-md bg-[#f6ead9] px-1.5 py-0.5 text-[10px] font-medium text-[#9d6f36]">
              {categoryInfo?.shortLabel ?? "커뮤니티"}
            </span>
            {isQuestionPost && post.is_resolved ? (
              <span className="shrink-0 rounded-full bg-[#e8f1ed] px-2 py-0.5 text-[10px] font-semibold text-[#36534E]">
                해결됨
              </span>
            ) : isQuestionPost && isWaitingForAnswer ? (
              <span className="shrink-0 rounded-full bg-[#f4e8e5] px-2 py-0.5 text-[10px] font-semibold text-[#8F6662]">
                답변 기다려요
              </span>
            ) : isQuestionPost ? (
              <span className="shrink-0 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10px] font-semibold text-[#36534E]">
                답변 {commentCount}개
              </span>
            ) : null}
            {(post.ad_disclosure === "sponsored" || post.ad_disclosure === "ad") && (
              <AdDisclosureBadge
                adDisclosure={post.ad_disclosure}
                sponsorshipDetail={post.sponsorship_detail}
                size="sm"
              />
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
          </div>
          <span className="shrink-0 pt-0.5">{timeAgo(post.created_at)}</span>
        </div>
        <h3 className="mt-2 line-clamp-2 break-words font-serif-kr text-[16.5px] font-medium leading-[1.38] text-[#071629] [overflow-wrap:anywhere] sm:text-[17px]">
          {post.title}
        </h3>
        {contentPreview && (
          <p className="ugc-text mt-1.5 line-clamp-2 break-words text-[12.5px] font-medium leading-[1.55] text-[#5d6879] [overflow-wrap:anywhere] sm:text-[13px]">
            {contentPreview}
          </p>
        )}

        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-[#66717d]">
          <Avatar
            nickname={post.author?.nickname ?? "익명"}
            avatarUrl={post.author?.avatar_url ?? null}
            role={post.author?.role ?? null}
            size={20}
            className="shrink-0"
          />
          <span className="min-w-0 truncate">{post.author?.nickname ?? "익명"}</span>
          <ContentOriginBadge origin={post.content_origin} />
          {post.author?.region && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{post.author.region}</span>
            </>
          )}
        </div>

        <div className="pointer-events-auto mt-2 flex min-w-0 items-center gap-1.5">
          <Link
            {...communityPostLinkProps(post.id, "comments")}
            onClick={() =>
              captureEvent("community_answer_intent", {
                category: post.category,
                answer_state: post.is_resolved
                  ? "resolved"
                  : isWaitingForAnswer
                    ? "waiting"
                    : "answered",
              })
            }
            className={`inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-3.5 text-[11.5px] font-semibold transition-colors ${
              isWaitingForAnswer
                ? "bg-[#A77B74] text-white hover:bg-[#8F6662]"
                : isQuestionPost && post.is_resolved
                  ? "border border-[#36534E]/25 bg-[#eef4f1] text-[#36534E]"
                  : "border border-[#d8c7ad] bg-white text-[#36534E] hover:border-[#36534E]/40"
            }`}
            aria-label={
              isWaitingForAnswer
                ? "첫 답변 남기기"
                : isQuestionPost && post.is_resolved
                  ? "해결 과정 보기"
                  : isQuestionPost
                    ? `답변 ${commentCount}개 보기`
                    : "경험 나누기"
            }
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 stroke-[1.8]" />
            <span className="truncate">
              {isWaitingForAnswer
                ? "첫 답변 남기기"
                : isQuestionPost && post.is_resolved
                  ? "해결 과정 보기"
                  : isQuestionPost
                    ? `답변 ${commentCount}개 보기`
                    : "경험 나누기"}
            </span>
          </Link>
          <button
            type="button"
            onClick={handleLike}
            disabled={voting}
            className={`ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 transition-colors ${
              isLiked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#5d6879] hover:bg-[#fff8ec]"
            }`}
            aria-label={`도움돼요 ${displayUpvoteCount}개`}
          >
            <Heart className={`h-3.5 w-3.5 stroke-[1.7] ${isLiked ? "fill-current" : ""}`} />
            <span className="text-[10.5px] font-semibold">{displayUpvoteCount}</span>
          </button>
          <button
            type="button"
            onClick={handleBookmark}
            disabled={bookmarking}
            className={`hidden min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-colors sm:inline-flex ${
              bookmarked ? "bg-[#fbefd6] text-[#9d6f36]" : "text-[#5d6879] hover:bg-[#fff8ec]"
            }`}
            aria-label="북마크"
          >
            <Bookmark className={`h-3.5 w-3.5 stroke-[1.7] ${bookmarked ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="hidden min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-[#5d6879] transition-colors hover:bg-[#fff8ec] sm:inline-flex"
            aria-label="공유"
          >
            <Share2 className="h-3.5 w-3.5 stroke-[1.7]" />
          </button>
        </div>
      </div>
      {imageUrl && (
        <div className="pointer-events-none relative z-10 mt-1 h-16 w-16 overflow-hidden rounded-[10px] bg-[#f8f4ec] sm:h-[86px] sm:w-[104px] xl:h-[90px] xl:w-[112px]">
          <Image
            src={imageUrl}
            alt=""
            fill
            className="object-cover transition-transform duration-500 hover:scale-105"
            sizes="(min-width: 1280px) 112px, (min-width: 640px) 104px, 64px"
            priority={priority}
          />
        </div>
      )}
    </article>
  );
}

function RightPanels({ desktopOnly = false }: { desktopOnly?: boolean }) {
  return (
    <aside
      className={`${desktopOnly ? "hidden lg:block" : ""} space-y-[18px] lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]`}
      data-tutorial-target="community-right"
    >
      <BestPostsPanel />
      <CohortPreviewPanel />
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
        items
          .filter((post) => post.upvote_count > 0)
          .slice(0, 5)
          .map((post: TrendingPost) => ({
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

  const title = "이번 주 도움된 글";
  const moreHref = "/community?sort=top&period=week&feed=all#community-feed";

  if (!loading && posts.length === 0) return null;

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
        최근 7일 도움돼요 반응을 기준으로 보여드려요.
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
        찾은 답을 준비에 반영하기
      </h2>
      <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
        커뮤니티에서 확인한 내용을 아모라와 다시 정리해 예산·할 일·일정으로 이어가세요.
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
        onClick={() => captureEvent("price_hero_click", { source: "landing_market_snapshot" })}
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

        // 랜딩 진입만으로 사용자를 방에 가입시키지 않는다. 방이 없다면 직접 시기를
        // 보고 선택하게 해야 가입의 의미와 알림 범위를 사용자가 이해할 수 있다.
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
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-[13px] font-medium text-[#36534E]"
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
