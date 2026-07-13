"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, ChevronRight, MessageCircle, Scale, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";
import { listPublicCases } from "./api";
import type { PublicCourtCase } from "./types";
import { COURT_CATEGORIES, categoryLabel, CourtLink, CourtPage, EmptyState, ErrorState, LoadingState, SafetyNotice, Surface } from "./CourtPrimitives";
import { publicCourtNickname } from "./publicIdentity";

type ModeFilter = "all" | "solo" | "couple";
type SortOrder = "latest" | "popular";

interface PublicCourtQueryState {
  category: string;
  mode: ModeFilter;
  sort: SortOrder;
  page: number;
}

const PUBLIC_CASES_PER_PAGE = 6;
const PUBLIC_COURT_QUERY_KEYS = ["category", "mode", "sort", "page"] as const;

function isAllowedCategory(value: string | null): value is string {
  return value !== null && COURT_CATEGORIES.some((category) => category.value === value);
}

function parsePositivePage(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

export function parsePublicCourtQuery(params: URLSearchParams): PublicCourtQueryState {
  const categoryValue = params.get("category");
  const modeValue = params.get("mode");
  const sortValue = params.get("sort");

  return {
    category: isAllowedCategory(categoryValue) ? categoryValue : "all",
    mode: modeValue === "solo" || modeValue === "couple" ? modeValue : "all",
    sort: sortValue === "popular" ? "popular" : "latest",
    page: parsePositivePage(params.get("page")),
  };
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function publishedTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function PublicCard({ post }: { post: PublicCourtCase }) {
  return (
    <Surface as="article" className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#EEF4F1] px-3 py-1 text-xs font-bold text-[#36534E]">{categoryLabel(post.category)}</span>
        <span className="rounded-full bg-[#F7F1E8] px-3 py-1 text-xs font-semibold text-[#705E48]">{post.mode === "solo" ? "1인 임시판결" : "쌍방 판결"}</span>
      </div>
      <h2 className="mt-4 break-keep text-xl font-bold leading-8 text-[#263832]">{post.title}</h2>
      <p className="mt-3 line-clamp-3 text-base leading-7 text-[#5E6C66]">{post.summary}</p>
      {post.verdictOneLine && <p className="mt-4 rounded-[14px] bg-[#FBF3F0] px-4 py-3 text-sm font-bold leading-6 text-[#8F6662]">{post.verdictOneLine}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-4 pt-5 text-xs font-medium text-[#65716C]">
        <span>{publicCourtNickname(post.id)}</span>
        {formatDate(post.createdAt) && <span>{formatDate(post.createdAt)}</span>}
        {post.votes && post.votes.total > 0 && <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" aria-hidden="true" />의견 {post.votes.total}</span>}
        {typeof post.commentsCount === "number" && post.commentsCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />대화 {post.commentsCount}</span>}
      </div>
      <CourtLink href={`/couple-court/public/${post.id}`} variant="text" className="mt-4 self-start px-0">익명 판결 보기 <ArrowRight className="h-4 w-4" aria-hidden="true" /></CourtLink>
    </Surface>
  );
}

export default function PublicCourtList() {
  const router = useRouter();
  const [posts, setPosts] = useState<PublicCourtCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [sort, setSort] = useState<SortOrder>("latest");
  const [page, setPage] = useState(1);
  const [urlReady, setUrlReady] = useState(false);
  const [urlSyncRevision, setUrlSyncRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPosts(await listPublicCases());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "공개재판을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const restoreFromUrl = () => {
      const restored = parsePublicCourtQuery(new URLSearchParams(window.location.search));
      setCategory(restored.category);
      setMode(restored.mode);
      setSort(restored.sort);
      setPage(restored.page);
      setUrlReady(true);
      setUrlSyncRevision((revision) => revision + 1);
    };

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, []);

  const availableCategories = useMemo(() => new Set(posts.map((post) => post.category)), [posts]);
  const categoryOptions = useMemo(
    () => COURT_CATEGORIES.filter((option) => availableCategories.has(option.value) || option.value === category),
    [availableCategories, category],
  );
  const filtered = useMemo(() => {
    const rows = posts.filter((post) => (
      (category === "all" || post.category === category)
      && (mode === "all" || post.mode === mode)
    ));
    return [...rows].sort((left, right) => {
      if (sort === "popular") {
        const voteDifference = (right.votes?.total ?? 0) - (left.votes?.total ?? 0);
        if (voteDifference !== 0) return voteDifference;
      }
      return publishedTime(right.createdAt) - publishedTime(left.createdAt);
    });
  }, [category, mode, posts, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PUBLIC_CASES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const visiblePosts = useMemo(
    () => filtered.slice((currentPage - 1) * PUBLIC_CASES_PER_PAGE, currentPage * PUBLIC_CASES_PER_PAGE),
    [currentPage, filtered],
  );

  useEffect(() => {
    if (!urlReady || loading || page === currentPage) return;
    setPage(currentPage);
  }, [currentPage, loading, page, urlReady]);

  useEffect(() => {
    if (!urlReady || urlSyncRevision < 1) return;

    const params = new URLSearchParams(window.location.search);
    PUBLIC_COURT_QUERY_KEYS.forEach((key) => params.delete(key));
    if (category !== "all") params.set("category", category);
    if (mode !== "all") params.set("mode", mode);
    if (sort !== "latest") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));

    const query = params.toString();
    const nextPath = `${weddingPath("/couple-court/public")}${query ? `?${query}` : ""}${window.location.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath !== currentPath) router.replace(nextPath, { scroll: false });
  }, [category, mode, page, router, sort, urlReady, urlSyncRevision]);

  const changeCategory = (value: string) => {
    setCategory(isAllowedCategory(value) ? value : "all");
    setPage(1);
  };

  const changeSort = (value: string) => {
    setSort(value === "popular" ? "popular" : "latest");
    setPage(1);
  };

  const changeMode = (value: ModeFilter) => {
    setMode(value);
    setPage(1);
  };

  return (
    <CourtPage>
      <section className="overflow-hidden rounded-[28px] border border-[#DFD3C7] bg-[linear-gradient(135deg,#FFFDF8_0%,#F7EFEA_55%,#EEF4F1_100%)] px-5 py-9 sm:px-9 sm:py-11">
        <div className="inline-flex min-h-8 items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold text-[#8F6662]"><Scale className="h-4 w-4" aria-hidden="true" />웨딩한방 공개재판</div>
        <h1 className="mt-5 max-w-[760px] break-keep text-[32px] font-bold leading-[1.25] tracking-[-0.025em] text-[#263832] sm:text-[43px]">우리만 그런 게 아니었구나,<br className="hidden sm:block" /> 익명 판결로 가볍게 확인해요</h1>
        <p className="mt-4 max-w-[690px] text-base leading-7 text-[#5E6C66] sm:text-[17px]">원문이 아닌 별도 익명 요약만 공개됩니다. 누군가를 망신주기보다 다른 커플이 실제로 어떤 합의를 만들었는지 살펴보세요.</p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row"><CourtLink href="/couple-court/new" className="w-full sm:w-auto"><Sparkles className="h-4 w-4" aria-hidden="true" />내 사건 정리하기</CourtLink><CourtLink href="/couple-court" variant="secondary" className="w-full sm:w-auto">둘만의 중재실</CourtLink></div>
      </section>

      <div className="mt-7"><SafetyNotice /></div>

      <section className="pt-10" aria-labelledby="public-cases-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-bold tracking-[0.14em] text-[#8F6662]">ANONYMOUS CASES</p><h2 id="public-cases-title" className="mt-2 text-2xl font-bold text-[#263832]">공개된 익명 판결</h2></div>
          {availableCategories.size > 0 && <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="text-sm font-semibold text-[#5E6C66]">주제<select name="category" value={category} onChange={(event) => changeCategory(event.target.value)} className="mt-1 block min-h-11 w-full rounded-full border border-[#D8CDC1] bg-white px-4 text-sm text-[#263832] outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15"><option value="all">전체 주제</option>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="text-sm font-semibold text-[#5E6C66]">정렬<select name="sort" value={sort} onChange={(event) => changeSort(event.target.value)} className="mt-1 block min-h-11 w-full rounded-full border border-[#D8CDC1] bg-white px-4 text-sm text-[#263832] outline-none focus:border-[#36534E] focus:ring-2 focus:ring-[#36534E]/15"><option value="latest">최신순</option><option value="popular">의견 많은 순</option></select></label>
          </div>}
        </div>

        {posts.length > 0 && <fieldset className="mt-5"><legend className="sr-only">판결 방식</legend><div className="inline-flex w-full rounded-full border border-[#D8CDC1] bg-white p-1 sm:w-auto">{([{ value: "all", label: "전체" }, { value: "solo", label: "1인 임시판결" }, { value: "couple", label: "쌍방 판결" }] as const).map((option) => <button key={option.value} type="button" onClick={() => changeMode(option.value)} aria-pressed={mode === option.value} className={`min-h-11 flex-1 rounded-full px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] sm:flex-none ${mode === option.value ? "bg-[#36534E] text-white" : "text-[#65716C] hover:bg-[#F2F7F4]"}`}>{option.label}</button>)}</div></fieldset>}

        <div className="mt-5">{loading ? <LoadingState label="익명 판결을 불러오는 중이에요." /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : posts.length === 0 ? <EmptyState title="아직 공개 심사를 마친 사건이 없어요" description="공개 데이터가 준비되기 전에는 예시 통계나 가짜 사건을 보여드리지 않아요. 둘만의 중재실은 바로 이용할 수 있어요." action={<CourtLink href="/couple-court/new">비공개 사건 시작</CourtLink>} /> : filtered.length === 0 ? <EmptyState title="선택한 조건의 공개 사건은 아직 없어요" description="다른 주제나 판결 방식을 선택해 보세요." /> : <div className="grid gap-4 md:grid-cols-2">{visiblePosts.map((post) => <PublicCard key={post.id} post={post} />)}</div>}</div>

        {!loading && !error && filtered.length > 0 && totalPages > 1 && <nav className="mt-7 flex items-center justify-center gap-3" aria-label="공개 재판 페이지">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-[#D8CDC1] bg-white px-4 text-sm font-bold text-[#36534E] outline-none hover:bg-[#F8FAF9] focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45" aria-label="이전 페이지"><ChevronLeft className="h-4 w-4" aria-hidden="true" />이전</button>
          <p className="min-w-16 text-center text-sm font-semibold text-[#65716C]" aria-live="polite"><span className="sr-only">현재 페이지 </span>{currentPage} / {totalPages}</p>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-[#D8CDC1] bg-white px-4 text-sm font-bold text-[#36534E] outline-none hover:bg-[#F8FAF9] focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45" aria-label="다음 페이지">다음<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </nav>}
      </section>

      <div className="mt-8 flex gap-3 rounded-[18px] border border-[#D9CFC3] bg-[#FCFAF6] p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" aria-hidden="true" /><p className="text-sm leading-6 text-[#65716C]">전화번호, 실명, 업체명 등은 공개 전 별도 미리보기에서 확인하고 가립니다. 불편하거나 위험한 내용은 게시물 안에서 바로 신고할 수 있어요.</p></div>
    </CourtPage>
  );
}
