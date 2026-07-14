"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FilePenLine, HeartHandshake, LockKeyhole, MessageCircle, MessagesSquare, Sparkles, UsersRound } from "lucide-react";
import { COURT_EXAMPLE_CASES } from "@/lib/coupleCourt/catalog";
import { listCases, listPublicCases } from "./api";
import { captureCourtEvent } from "./analytics";
import { publicCourtNickname } from "./publicIdentity";
import type { CourtCase, PublicCourtCase } from "./types";
import {
  ContinueArrow,
  categoryLabel,
  CourtButton,
  CourtLink,
  CourtPage,
  CourtSeal,
  EmptyState,
  ErrorState,
  LoadingState,
  PageIntro,
  SafetyNotice,
  SectionHeading,
  StatusBadge,
  Surface,
} from "./CourtPrimitives";

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function CaseCard({ courtCase }: { courtCase: CourtCase }) {
  return (
    <Surface as="article" className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={courtCase.status} />
        <span className="rounded-full bg-[#F7F1E8] px-3 py-1 text-xs font-semibold text-[#705E48]">
          {courtCase.mode === "couple" ? "쌍방 중재" : "1인 임시판결"}
        </span>
      </div>
      <h3 className="mt-4 break-keep text-lg font-bold leading-7 text-[#263832]">{courtCase.title}</h3>
      <p className="mt-2 text-sm font-medium text-[#8F6662]">{categoryLabel(courtCase.category)}</p>
      {courtCase.neutralSummary && <p className="mt-3 line-clamp-3 text-base leading-7 text-[#65716C]">{courtCase.neutralSummary}</p>}
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="text-xs text-[#65716C]">{formatDate(courtCase.updatedAt ?? courtCase.createdAt) ?? "최근 사건"}</span>
        <CourtLink href={`/couple-court/cases/${courtCase.id}`} variant="text" className="px-1">
          사건 보기 <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </CourtLink>
      </div>
    </Surface>
  );
}

function PopularCaseCard({ post }: { post: PublicCourtCase }) {
  return (
    <Surface as="article" className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#EEF4F1] px-3 py-1 text-xs font-bold text-[#36534E]">{categoryLabel(post.category)}</span>
        <span className="rounded-full bg-[#F7F1E8] px-3 py-1 text-xs font-semibold text-[#705E48]">{post.mode === "solo" ? "1인 임시판결" : "쌍방 판결"}</span>
        <span className="rounded-full bg-[#FBF3F0] px-3 py-1 text-xs font-semibold text-[#875F5B]">판결 완료</span>
      </div>
      <h3 className="mt-4 break-keep text-lg font-bold leading-7 text-[#263832]">{post.title}</h3>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#5E6C66]">{post.summary}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-xs font-medium text-[#65716C]">
        <span>{publicCourtNickname(post.id)}</span>
        {formatDate(post.createdAt) && <span>{formatDate(post.createdAt)}</span>}
        <span className="inline-flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" aria-hidden="true" />의견 {post.votes?.total ?? 0}</span>
        <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />대화 {post.commentsCount ?? 0}</span>
      </div>
      <CourtLink href={`/couple-court/public/${post.id}`} variant="text" className="mt-4 self-start px-0">익명 판결 보기 <ArrowRight className="h-4 w-4" aria-hidden="true" /></CourtLink>
    </Surface>
  );
}

export default function CoupleCourtHome({ publicEnabled }: { publicEnabled: boolean }) {
  const [cases, setCases] = useState<CourtCase[]>([]);
  const [nextCasesCursor, setNextCasesCursor] = useState<string | null>(null);
  const [loadingMoreCases, setLoadingMoreCases] = useState(false);
  const [moreCasesError, setMoreCasesError] = useState<string | null>(null);
  const [popularCases, setPopularCases] = useState<PublicCourtCase[]>([]);
  const [popularLoading, setPopularLoading] = useState(publicEnabled);
  const [popularError, setPopularError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const homeViewTracked = useRef(false);
  const popularRequestId = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMoreCasesError(null);
    try {
      const page = await listCases();
      setCases(page.cases);
      setNextCasesCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "내 사건을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreCases = useCallback(async () => {
    if (!nextCasesCursor || loadingMoreCases) return;
    setLoadingMoreCases(true);
    setMoreCasesError(null);
    try {
      const page = await listCases(nextCasesCursor);
      setCases((current) => {
        const byId = new Map(current.map((courtCase) => [courtCase.id, courtCase]));
        for (const courtCase of page.cases) byId.set(courtCase.id, courtCase);
        return Array.from(byId.values());
      });
      setNextCasesCursor(page.nextCursor);
    } catch (loadError) {
      setMoreCasesError(loadError instanceof Error ? loadError.message : "이전 사건을 불러오지 못했어요.");
    } finally {
      setLoadingMoreCases(false);
    }
  }, [loadingMoreCases, nextCasesCursor]);

  useEffect(() => {
    if (!homeViewTracked.current) {
      homeViewTracked.current = true;
      captureCourtEvent("couple_court_home_view");
    }
    void load();
  }, [load]);

  const loadPopularCases = useCallback(async () => {
    if (!publicEnabled) return;
    const requestId = ++popularRequestId.current;
    setPopularLoading(true);
    setPopularError(null);
    try {
      const { posts } = await listPublicCases({ category: "all", mode: "all", sort: "popular", page: 1, limit: 3 });
      if (popularRequestId.current !== requestId) return;
      setPopularCases(posts);
    } catch (loadError) {
      if (popularRequestId.current !== requestId) return;
      setPopularError(loadError instanceof Error ? loadError.message : "인기 공개재판을 불러오지 못했어요.");
    } finally {
      if (popularRequestId.current === requestId) setPopularLoading(false);
    }
  }, [publicEnabled]);

  useEffect(() => {
    void loadPopularCases();
    return () => {
      popularRequestId.current += 1;
    };
  }, [loadPopularCases]);

  const myCasesSection = (
    <section id="my-cases" className="scroll-mt-24 pt-12" aria-labelledby="my-cases-title">
      <SectionHeading titleId="my-cases-title" title="내 사건" description="작성 중인 내용과 상대방 답변, 판결 상태를 여기서 이어갈 수 있어요." action={<CourtLink href="/couple-court/new" variant="secondary">새 사건 접수</CourtLink>} />
      {loading ? <LoadingState label="내 사건을 확인하는 중이에요." /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : cases.length === 0 ? (
        <EmptyState title="아직 접수한 사건이 없어요" description="가벼운 서운함도 괜찮아요. 내 마음과 원하는 결정을 차근차근 적어보세요." action={<CourtLink href="/couple-court/new">첫 사건 접수하기</CourtLink>} />
      ) : <div>
        <div className="grid gap-4 md:grid-cols-2">{cases.map((courtCase) => <CaseCard key={courtCase.id} courtCase={courtCase} />)}</div>
        {moreCasesError && <p className="mt-4 text-sm font-semibold text-[#9B3F3F]" role="alert">{moreCasesError}</p>}
        {nextCasesCursor && <div className="mt-5 flex justify-center"><CourtButton type="button" variant="secondary" disabled={loadingMoreCases} onClick={() => void loadMoreCases()}>{loadingMoreCases ? "이전 사건을 불러오는 중…" : "이전 사건 더 보기"}</CourtButton></div>}
      </div>}
    </section>
  );

  return (
    <CourtPage>
      <section className="relative overflow-hidden rounded-[28px] border border-[#DED1C4] bg-[linear-gradient(135deg,#FFFDF8_0%,#F3ECE8_52%,#EDF4F0_100%)] px-5 py-8 shadow-[0_20px_56px_rgba(38,56,50,0.08)] sm:px-9 sm:py-11 lg:grid lg:grid-cols-[1fr_260px] lg:items-center lg:gap-10">
        <div className="relative z-10">
          <div className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[#A77B74]/20 bg-white/75 px-3 py-1.5 text-xs font-bold text-[#8F6662]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            한방 판사 아모라
          </div>
          <h1 className="mt-5 break-keep text-[32px] font-bold leading-[1.22] tracking-[-0.03em] text-[#263832] sm:text-[44px]">
            또 ‘아무거나’라고 했다가<br className="hidden sm:block" /> 싸웠나요?
          </h1>
          <p className="mt-4 max-w-[650px] text-base leading-7 text-[#586761] sm:text-[17px]">
            결혼 준비 중 생긴 서운함을 사실과 기대, 오늘 할 일로 나눠 정리해 드려요. 누가 이겼는지보다 둘이 다시 앞으로 가는 판결입니다.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <CourtLink href="/couple-court/new?mode=couple" className="w-full sm:w-auto">
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />둘이 중재받기
            </CourtLink>
            <CourtLink href="/couple-court/new?mode=solo" variant="secondary" className="w-full sm:w-auto">
              <FilePenLine className="h-4 w-4" aria-hidden="true" />혼자 먼저 정리
            </CourtLink>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            {publicEnabled && <CourtLink href="/couple-court/public" variant="text" className="min-h-11 px-0">공개재판 구경하기 <ContinueArrow /></CourtLink>}
            <a href="#my-cases" className="inline-flex min-h-11 items-center rounded-md text-[#36534E] underline decoration-[#A9BDB5] underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2">내 사건 보기</a>
          </div>
        </div>
        <div className="relative mx-auto mt-8 hidden h-[220px] w-[220px] items-center justify-center rounded-full border border-white/70 bg-white/55 shadow-[0_20px_60px_rgba(143,102,98,0.13)] lg:flex" aria-hidden="true">
          <div className="absolute inset-5 rounded-full border border-dashed border-[#A77B74]/35" />
          <CourtSeal />
          <span className="absolute bottom-7 text-xs font-bold tracking-[0.14em] text-[#8F6662]">AMORA COURT</span>
        </div>
      </section>

      {myCasesSection}

      {publicEnabled && <section className="pt-12" aria-labelledby="popular-cases-title">
        <SectionHeading titleId="popular-cases-title" title="오늘의 인기 사건" description="공개 심사를 통과한 익명 판결 중 의견과 대화가 많이 모인 사건이에요." action={<CourtLink href="/couple-court/public" variant="text" className="px-0">전체 공개재판 <ContinueArrow /></CourtLink>} />
        {popularLoading
          ? <LoadingState label="인기 공개재판을 확인하는 중이에요." />
          : popularError
            ? <ErrorState message={popularError} onRetry={() => void loadPopularCases()} />
            : popularCases.length > 0
          ? <div className="grid gap-4 md:grid-cols-3">{popularCases.map((post) => <PopularCaseCard key={post.id} post={post} />)}</div>
          : <Surface className="border-dashed"><p className="font-bold text-[#263832]">아직 공개 심사를 마친 인기 사건이 없어요</p><p className="mt-2 text-sm leading-6 text-[#65716C]">가짜 투표나 예시 사건을 인기 순위처럼 보여주지 않습니다. 공개된 판결이 생기면 이곳에 표시돼요.</p></Surface>}
      </section>}

      <section className="pt-12" aria-labelledby="frequent-cases-title">
        <SectionHeading titleId="frequent-cases-title" title="자주 접수되는 사건" description="비슷한 고민을 골라 카테고리부터 빠르게 시작할 수 있어요. 아래 내용은 실제 공개 사건이 아닌 작성 예시입니다." />
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="list" aria-label="자주 접수되는 사건 예시">
          {COURT_EXAMPLE_CASES.slice(0, 5).map((example) => (
            <article key={example.id} role="listitem" className="w-[82vw] max-w-[310px] shrink-0 snap-start rounded-[20px] border border-[#DDD2C6] bg-white p-5 shadow-[0_10px_30px_rgba(38,56,50,0.05)]">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#F7F1E8] px-3 py-1 text-xs font-bold text-[#705E48]">예시</span><span className="text-xs font-semibold text-[#65716C]">{categoryLabel(example.category)}</span></div>
              <h3 className="mt-4 break-keep text-lg font-bold leading-7 text-[#263832]">{example.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#65716C]">{example.summary}</p>
              <CourtLink href={`/couple-court/new?category=${encodeURIComponent(example.category)}`} variant="text" className="mt-4 px-0">이 주제로 시작 <ArrowRight className="h-4 w-4" aria-hidden="true" /></CourtLink>
            </article>
          ))}
        </div>
      </section>

      <section className="pt-12" aria-labelledby="court-process-title">
        <PageIntro titleId="court-process-title" headingLevel="h2" eyebrow="HOW IT WORKS" title="판결은 짧게, 합의는 구체적으로" description="진술 원문을 공개하지 않고, 두 사람이 오늘 실행할 수 있는 결론까지 연결합니다." />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: LockKeyhole, step: "01", title: "각자 따로 적어요", text: "상대방의 진술을 먼저 보지 않고 내 기억과 바라는 해결을 작성해요." },
            { icon: Sparkles, step: "02", title: "쟁점을 나눠 봐요", text: "아모라가 일치한 사실과 서로 다르게 기억하는 부분을 분리해요." },
            { icon: HeartHandshake, step: "03", title: "오늘 할 일을 정해요", text: "화해 처방을 일정이나 체크리스트로 저장해 준비를 다시 시작해요." },
          ].map((item) => <Surface key={item.step} className="relative"><span className="text-xs font-bold tracking-[0.16em] text-[#8F6662]">STEP {item.step}</span><item.icon className="mt-5 h-6 w-6 text-[#36534E]" aria-hidden="true" /><h3 className="mt-3 text-lg font-bold text-[#263832]">{item.title}</h3><p className="mt-2 text-base leading-7 text-[#65716C]">{item.text}</p></Surface>)}
        </div>
      </section>

      <div className="mt-8"><SafetyNotice /></div>
      <p className="mt-5 flex items-start gap-2 text-sm leading-6 text-[#65716C]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" aria-hidden="true" />공개재판은 원문과 분리된 익명 요약만 사용하며, 쌍방 사건은 두 사람 모두 동의해야 게시할 수 있어요.</p>
    </CourtPage>
  );
}
