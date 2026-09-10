"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowRight,
  Bookmark,
  CalendarCheck,
  Clock3,
  HeartHandshake,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";
import DailyAmoraFocusBridge from "@/components/app/DailyAmoraFocusBridge";
import FirstRunLoungeTutorial from "@/components/app/FirstRunLoungeTutorial";
import LoungeFirstArrival, {
  buildLoungeFirstArrival,
  LoungeFirstArrivalEmptyNote,
} from "@/components/app/LoungeFirstArrival";
import AmoraMissions from "@/components/app/amora-missions/AmoraMissions";
import {
  getDashboardCompanionCopy,
  getJoinedDashboardMarkerSnapshot,
  JOINED_PLAN_REVIEW_PROMPT,
  notifyJoinedDashboardMarkerChanged,
  removeJoinedDashboardMarker,
  subscribeJoinedDashboardMarker,
} from "@/lib/amora/dashboardCompanion";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { buildAmoraMissionModel } from "@/lib/amora/missions";
import { formatLoungeBudgetRatio, formatLoungeWon, getLoungeSetupGuidance } from "@/lib/amora/loungeSummary";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { getProgressSummary } from "@/app/(app)/lounge/progressSummary";
import { getEvents, getScheduleEventStatus, isValidScheduleTime } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import type { CohortRoom, CohortThreadTopic, PostWithAuthor } from "@/types/community.types";
import { daysUntilWedding } from "@/lib/utils/weddingDate";
import { buildLoungePriorityItems, daysUntilLoungeEvent, getLoungeBudgetTotals } from "./hubModel";
import { LoungePriorityFeed, LoungeReferencePanels, PreparationRecordPanel, PreparationStageRail } from "./LoungeHubSections";

interface CohortDigest {
  period: "today" | "week";
  generatedAt: string;
  messageCount: number;
  imageCount: number;
  lead: string;
  topicBreakdown: Array<{ topic: CohortThreadTopic; label: string; count: number }>;
  highlights: string[];
  questions: Array<{ topic: CohortThreadTopic; label: string; text: string }>;
  nextActions: string[];
  empty: boolean;
}

interface CohortState {
  room: CohortRoom | null;
  lastMessage: string | null;
  loading: boolean;
  digest: CohortDigest | null;
  error: "room" | "digest" | null;
}

const DEMO_COHORT_ROOM: CohortRoom = {
  id: "demo-cohort",
  year: 2026,
  month: 10,
  room_number: 1,
  name: "2026년 4분기 동기방",
  member_count: 24,
  message_count: 86,
  is_active: true,
  created_at: new Date().toISOString(),
};

const DEMO_DIGEST: CohortDigest = {
  period: "week",
  generatedAt: new Date().toISOString(),
  messageCount: 18,
  imageCount: 2,
  lead: "이번 주는 드레스 매장 방문과 결혼식 날 사진 촬영 예약 이야기가 가장 많았어요.",
  topicBreakdown: [
    { topic: "price", label: "가격", count: 7 },
    { topic: "review", label: "후기", count: 6 },
    { topic: "concern", label: "고민", count: 5 },
  ],
  highlights: [
    "드레스 매장 방문 전에는 입어보는 비용과 촬영 날 드레스를 돕는 직원 비용을 따로 확인했다는 이야기가 많았어요.",
    "결혼식 날 사진 촬영은 받는 사진 파일 수와 보정해 주는 사진 수를 먼저 비교하는 흐름이 있었어요.",
  ],
  questions: [
    { topic: "price", label: "가격", text: "촬영한 사진 파일을 받으려면 별도 금액을 내야 하나요?" },
    { topic: "concern", label: "고민", text: "드레스 매장은 몇 곳까지 방문해 보는 게 좋을까요?" },
  ],
  nextActions: ["내 견적서의 포함 항목을 한 줄씩 나눠서 확인해보세요."],
  empty: false,
};

function formatDate(value: string | null | undefined) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미정";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function formatFullDate(value: string | null | undefined) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미정";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDdayLabel(dday: number | null) {
  if (dday === null) return "D-day 미정";
  if (dday > 0) return `D-${dday}`;
  if (dday === 0) return "D-day";
  return `D+${Math.abs(dday)}`;
}

export function getUpcomingEvents(progress: Record<string, ProgressItem>): ScheduleEvent[] {
  return getEvents(progress as Record<string, unknown>)
    .filter((event) => {
      const days = daysUntilLoungeEvent(event.date);
      return getScheduleEventStatus(event) === "planned"
        && days !== null && days >= 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildDemoSavedPosts(): PostWithAuthor[] {
  const now = new Date().toISOString();
  return [
    {
      id: "demo-bookmark-1",
      author_id: "demo",
      content_origin: "operator",
      category: "tips_v2",
      title: "계약 전 확인하면 좋은 체크포인트 정리",
      content: "기본 금액, 필수 추가금, 선택 옵션을 한 줄씩 분리해서 확인하면 나중에 비교하기 쉽습니다.",
      images: [],
      slides: null,
      visibility: "public",
      ad_disclosure: "general",
      sponsorship_detail: null,
      ai_comment: null,
      is_resolved: false,
      is_verified_review: false,
      verification_doc_url: null,
      price_data: null,
      is_quick_review: false,
      rating: null,
      cohort_room_id: null,
      under_review: false,
      upvote_count: 4,
      downvote_count: 0,
      comment_count: 2,
      view_count: 81,
      bookmark_count: 7,
      is_pinned: false,
      is_weekly_best: false,
      vendor_tags: [],
      tags: ["계약", "체크리스트"],
      created_at: now,
      updated_at: now,
      author: {
        user_id: "demo",
        nickname: "웨딩한방 체크",
        avatar_url: null,
        rank: "master",
        wedding_year: null,
        wedding_month: null,
        wedding_completed: false,
        progress_percent: 0,
        region: null,
        post_count: 1,
        comment_count: 0,
        total_upvotes_received: 0,
        warning_count: 0,
        is_suspended: false,
        created_at: now,
      },
      user_bookmarked: true,
    },
  ];
}

export default function LoungePage() {
  const { user, partner: storedPartner, profile, journey: storedJourney, isDemo } = useAuthStore();
  const scopeReady = Boolean(user && profile?.id === user.id && profile.couple_id);
  const journey = scopeReady && storedJourney?.couple_id === profile?.couple_id ? storedJourney : null;
  const partner = scopeReady && storedPartner?.couple_id === profile?.couple_id && storedPartner?.id !== profile?.id ? storedPartner : null;
  const userId = user?.id ?? null;
  const [savedPosts, setSavedPosts] = useState<PostWithAuthor[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState(false);
  const [savedRetry, setSavedRetry] = useState(0);
  const [cohortRetry, setCohortRetry] = useState(0);
  const joinedHandoffVisible = useSyncExternalStore(
    subscribeJoinedDashboardMarker,
    getJoinedDashboardMarkerSnapshot,
    () => false,
  );
  const [cohortState, setCohortState] = useState<CohortState>({
    room: null,
    lastMessage: null,
    loading: true,
    digest: null,
    error: null,
  });

  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const budgetTotals = useMemo(() => getLoungeBudgetTotals(progress), [progress]);
  const spentBudget = budgetTotals.spent;
  const summary = useMemo(() => getProgressSummary(progress), [progress]);
  const plan = useMemo(
    () =>
      buildAmoraLifecyclePlan({
        weddingDate: journey?.wedding_date,
        totalBudget,
        venue: journey?.venue,
        progress,
      }),
    [journey?.wedding_date, journey?.venue, progress, totalBudget]
  );
  const upcomingEvents = useMemo(() => getUpcomingEvents(progress), [progress]);
  const missionModel = useMemo(() => buildAmoraMissionModel(journey ? progress : null, []), [journey, progress]);
  const priorityItems = useMemo(() => journey ? buildLoungePriorityItems(progress, journey.wedding_date, upcomingEvents) : [], [progress, journey, upcomingEvents]);
  const nextEvent = upcomingEvents[0] ?? null;
  const weddingDday = daysUntilWedding(journey?.wedding_date);
  const allocatedRatioLabel = formatLoungeBudgetRatio(budgetTotals.allocated, totalBudget);
  const budgetPercent = totalBudget > 0 ? spentBudget / totalBudget * 100 : 0;
  const budgetRatioLabel = formatLoungeBudgetRatio(spentBudget, totalBudget);
  const setupGuidance = getLoungeSetupGuidance(journey?.wedding_date, totalBudget);
  const budgetWidth = Math.min(100, Math.max(0, budgetPercent));
  const progressPercent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  // 첫 도착 카드 — 온보딩만 끝나고 아직 아무것도 쌓이지 않은 라운지에서만 뜬다.
  // 판정은 아래 값들(체크·카테고리 상태·예산·일정)에서 매번 다시 계산하므로
  // 커플이 무언가 남기는 순간 저절로 사라진다. 따로 플래그를 두지 않는 이유다.
  const firstArrival = useMemo(
    () =>
      buildLoungeFirstArrival({
        onboardingCompleted: profile?.onboarding_completed === true,
        weddingDate: journey?.wedding_date,
        progress,
        totalBudget,
        spentBudget,
        checkedItemCount: summary.done,
        partnerLinked: Boolean(partner),
        now: Date.now(),
      }),
    [
      journey?.wedding_date,
      partner,
      profile?.onboarding_completed,
      progress,
      spentBudget,
      summary.done,
      totalBudget,
    ],
  );
  const companionCopy = getDashboardCompanionCopy(Boolean(partner));
  const partnerLabel = partner?.name
    ? `${partner.name}님과 같은 계획을 보고 있어요`
    : "원할 때 파트너를 초대할 수 있어요";
  const joinedReviewLink = weddingLinkProps(
    `/chat?${new URLSearchParams({ prefill: JOINED_PLAN_REVIEW_PROMPT })}`,
  );
  const showJoinedHandoff = joinedHandoffVisible && Boolean(partner);

  // 모멘트 루프 시동 — 로그인 후 첫 화면이 라운지이므로 여기서 한 번 깨운다.
  // (예전엔 dashboard에만 있었는데 그 라우트가 라운지로 리다이렉트되면서
  //  "먼저 챙기는 언니"가 채팅 탭을 직접 누른 사람에게만 작동하고 있었다.)
  useEffect(() => {
    if (isDemo || !userId) return;
    void requestProactiveCare();
  }, [isDemo, userId]);

  useEffect(() => {
    let cancelled = false;
    setSavedError(false);
    if (isDemo) {
      setSavedPosts(buildDemoSavedPosts());
      setSavedLoading(false);
      return;
    }
    if (!userId) {
      setSavedLoading(false);
      return;
    }

    setSavedLoading(true);
    fetch("/api/community/posts?bookmarked=true&limit=3", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { posts?: PostWithAuthor[] }) => {
        if (!cancelled) setSavedPosts((data.posts ?? []).slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) { setSavedPosts([]); setSavedError(true); }
      })
      .finally(() => {
        if (!cancelled) setSavedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemo, userId, savedRetry]);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) {
      setCohortState({
        room: DEMO_COHORT_ROOM,
        lastMessage: "결혼식 날 받는 사진 파일 수는 계약서에 적어두자는 이야기가 나왔어요.",
        loading: false,
        digest: DEMO_DIGEST,
        error: null,
      });
      return;
    }
    if (!userId) {
      setCohortState({ room: null, lastMessage: null, loading: false, digest: null, error: null });
      return;
    }

    setCohortState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const cohortRes = await fetch("/api/community/cohort", { cache: "no-store" });
        if (!cohortRes.ok) throw new Error("cohort");
        const cohortData = (await cohortRes.json()) as { room?: CohortRoom | null; lastMessage?: string | null };
        if (cancelled) return;

        let digest: CohortDigest | null = null;
        let error: CohortState["error"] = null;
        if (cohortData.room?.id) {
          try {
            const digestRes = await fetch(
              `/api/community/cohort/${encodeURIComponent(cohortData.room.id)}/digest?period=week`,
              { cache: "no-store" }
            );
            if (!digestRes.ok) throw new Error("digest");
            digest = (await digestRes.json()) as CohortDigest;
          } catch { error = "digest"; }
        }

        if (!cancelled) {
          setCohortState({
            room: cohortData.room ?? null,
            lastMessage: cohortData.lastMessage ?? null,
            loading: false,
            digest,
            error,
          });
        }
      } catch {
        if (!cancelled) setCohortState({ room: null, lastMessage: null, loading: false, digest: null, error: "room" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemo, userId, cohortRetry]);

  const dismissJoinedHandoff = () => {
    const nextUrl = removeJoinedDashboardMarker(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    window.history.replaceState(window.history.state, "", nextUrl);
    notifyJoinedDashboardMarkerChanged();
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 px-[18px] pb-10 pt-4 text-[var(--amora-ink)] md:space-y-6 md:px-9 md:pb-[60px] md:pt-[30px]">
      {/* 첫 도착 안내는 라운지에서만 뜬다 — 앵커가 여기 있고, 여기가 착지 화면이다. */}
      <FirstRunLoungeTutorial />
      {/* 파트너 합류 안내가 떠 있을 때는 첫 도착 카드를 접는다 — 환영 카드 두 장이
          겹치면 어느 쪽이 지금 할 일인지 흐려진다. 합류 안내를 닫으면 다시 나온다. */}
      {firstArrival && !showJoinedHandoff && <LoungeFirstArrival view={firstArrival} />}
      {showJoinedHandoff && (
        <section
          data-testid="joined-plan-handoff"
          className="rounded-2xl border border-[var(--amora-sage)] bg-[var(--amora-sage-pale)] p-5 md:p-6"
          aria-labelledby="joined-plan-title"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[var(--amora-ink)]">
              <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--amora-soft)]">
                함께 준비 시작
              </p>
              <h2
                id="joined-plan-title"
                className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]"
              >
                이제 이 계획을 함께 봐요
              </h2>
              <p className="mt-2 text-[13px] font-medium leading-6 text-[var(--amora-soft)]">
                이제 두 분이 함께 보는 현재 계획이에요. 이 화면을 열면서 새로 저장하거나 변경한 내용은 없어요.
              </p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HandoffMetric
              label="결혼식 날짜"
              value={formatFullDate(journey?.wedding_date)}
            />
            <HandoffMetric label="장소" value={journey?.venue || "장소 미정"} />
            <HandoffMetric
              label="총 예산"
              value={totalBudget > 0 ? formatLoungeWon(totalBudget) : "미입력"}
            />
            <HandoffMetric
              label="준비 진행"
              value={`${progressPercent}%`}
              note={`${summary.done}/${summary.total}개 체크`}
            />
          </dl>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              {...joinedReviewLink}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--amora-ink)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--amora-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 sm:w-auto"
            >
              함께 확인할 내용 찾기
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={dismissJoinedHandoff}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-5 text-[13px] font-semibold text-[var(--amora-soft)] transition-colors hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 sm:w-auto"
            >
              이 내용 확인했어요
            </button>
          </div>
        </section>
      )}
      <section aria-label="현재 준비 현황" className="rounded-[16px] border border-[var(--amora-line)] bg-white p-[18px] lg:rounded-[20px] lg:px-7 lg:py-[26px]">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[var(--amora-rose-pale)] px-2.5 py-1 text-[10px] text-[var(--amora-rose-deep)] lg:text-[11px]"><Sparkles size={12} aria-hidden="true" />{companionCopy.loungeLabel}</p>
            <h2 className="amora-display mt-3 text-[21px] leading-[1.35] lg:text-[27px]">{partner ? "함께 준비하는 우리의 결혼" : "차근차근 준비하는 나의 결혼"}</h2>
            <p className="mt-2 text-[11px] leading-[1.7] text-[var(--amora-soft)] lg:text-[12px]">{companionCopy.statusHeading} · {partnerLabel}</p>
          </div>
          <Link {...weddingLinkProps(`/chat?${new URLSearchParams({ prefill: companionCopy.amoraPrompt })}`)} data-tutorial-target="amora-fab" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--amora-ink)] px-4 text-[11px] font-medium text-white hover:bg-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] sm:shrink-0 lg:px-[18px] lg:text-[12px]"><Sparkles size={14} aria-hidden="true" />아모라에게 물어보기<ArrowRight size={13} aria-hidden="true" /></Link>
        </div>
        <div className="mt-[18px] grid grid-cols-2 gap-2.5 lg:mt-6 lg:grid-cols-4 lg:gap-3.5">
          <Link {...weddingLinkProps("/settings" )} className="min-w-0 rounded-[12px] bg-[var(--amora-ink)] p-3.5 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] lg:rounded-[14px] lg:px-[19px] lg:py-[17px]">
            <p className="text-[10px] text-white/60 lg:text-[11px]">우리의 결혼식</p><p className="amora-display mt-2 break-words text-[23px] leading-none lg:text-[30px]">{getDdayLabel(weddingDday)}</p><p className="mt-2 text-[10px] leading-5 text-white/70 lg:text-[11px]">{formatFullDate(journey?.wedding_date)}</p><p className="mt-1 text-[10px] text-white/50">{journey?.venue || "날짜·장소 설정"}</p>
          </Link>
          <Link {...weddingLinkProps("/checklist")} className="min-w-0 rounded-[12px] bg-[var(--amora-warm)] p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] lg:rounded-[14px] lg:px-[19px] lg:py-[17px]">
            <p className="text-[10px] text-[var(--amora-muted)] lg:text-[11px]">체크리스트 진행</p><p className="amora-display mt-2 text-[23px] leading-none lg:text-[30px]">{progressPercent}<span className="ml-0.5 text-[13px] text-[var(--amora-muted)]">%</span></p><p className="mt-2 text-[10px] leading-5 text-[var(--amora-soft)] lg:text-[11px]">{summary.done}/{summary.total}개 직접 체크</p><progress aria-label="전체 체크리스트 진행" value={progressPercent} max={100} className="mt-2 block h-1 w-full overflow-hidden rounded-full border-0 bg-[var(--amora-low)] [&::-moz-progress-bar]:bg-[var(--amora-sage)] [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:bg-[var(--amora-sage)]" />
          </Link>
          <Link {...weddingLinkProps("/budget")} className="min-w-0 rounded-[12px] bg-[var(--amora-warm)] p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] lg:rounded-[14px] lg:px-[19px] lg:py-[17px]">
            <p className="text-[10px] text-[var(--amora-muted)] lg:text-[11px]">총 예산 대비 배정</p><p className="amora-display mt-2 break-words text-[21px] leading-none lg:text-[28px]">{totalBudget > 0 ? allocatedRatioLabel : "예산 미정"}</p><p className="mt-2 break-words text-[10px] leading-5 text-[var(--amora-soft)] lg:text-[11px]">{formatLoungeWon(budgetTotals.allocated)} 배정</p><progress aria-label="총 예산 대비 배정액" value={totalBudget > 0 ? Math.min(100, budgetTotals.allocated / totalBudget * 100) : 0} max={100} className="mt-2 block h-1 w-full overflow-hidden rounded-full border-0 bg-[var(--amora-low)] [&::-moz-progress-bar]:bg-[var(--amora-rose)] [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:bg-[var(--amora-rose)]" />
          </Link>
          <Link {...weddingLinkProps("/schedule")} className="min-w-0 rounded-[12px] bg-[var(--amora-warm)] p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] lg:rounded-[14px] lg:px-[19px] lg:py-[17px]">
            <p className="text-[10px] text-[var(--amora-muted)] lg:text-[11px]">다음 일정</p><p className="amora-display mt-2 text-[23px] leading-none lg:text-[30px]">{nextEvent ? getDdayLabel(daysUntilLoungeEvent(nextEvent.date)) : "일정 미정"}</p><p className="mt-2 break-words text-[10px] leading-5 text-[var(--amora-soft)] lg:text-[11px]">{nextEvent?.title ?? "예정된 일정을 추가해요"}</p>{nextEvent && <p className="mt-1 text-[10px] text-[var(--amora-muted)]">{formatDate(nextEvent.date)} · {isValidScheduleTime(nextEvent.time) ? nextEvent.time : "시간 미정"}</p>}
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--amora-line)] pt-3 text-[10.5px] leading-[1.7] text-[var(--amora-muted)] lg:text-[11px]">
          <p>기록 지출 {formatLoungeWon(spentBudget)}{totalBudget > 0 ? ` · 총 예산의 ${budgetRatioLabel}` : " · 총 예산 입력 전"} · 결제 확인과 별도</p>
          {!partner && <Link {...weddingLinkProps("/settings")} data-tutorial-target="lounge-invite" className="inline-flex min-h-11 items-center gap-1 font-medium text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]"><Users size={12} aria-hidden="true" />파트너 초대<ArrowRight size={11} aria-hidden="true" /></Link>}
        </div>
        <p className="hidden text-[11px] leading-[1.7] text-[var(--amora-muted)] lg:block">{companionCopy.description}</p>
        <p className={`${setupGuidance ? "" : "hidden lg:block"} mt-1 text-[10.5px] leading-[1.7] text-[var(--amora-muted)] lg:text-[11px]`}>{setupGuidance ? setupGuidance.text : `${plan.stageLabel} · ${plan.stageSummary}`}</p>
        {setupGuidance?.needsBudget && <Link {...weddingLinkProps("/budget")} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-[11px] font-semibold text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]">총 예산 입력<ArrowRight size={12} aria-hidden="true" /></Link>}
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-6 lg:gap-y-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1"><PreparationStageRail groups={missionModel.groups} /></div>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:space-y-6">
          <section id="today-missions" data-tutorial-target="lounge-focus" aria-labelledby="lounge-priority-title" className="scroll-mt-24">
            <div className="mb-5"><AmoraMissions hub /></div>
            {journey ? <LoungePriorityFeed items={priorityItems} /> : <div role="status" className="rounded-[14px] border border-[var(--amora-line)] bg-white p-5"><h2 id="lounge-priority-title" className="text-[14px] font-semibold">준비 정보를 확인하고 있어요</h2><p className="mt-2 text-[12px] leading-5 text-[var(--amora-muted)]">현재 계정의 계획을 확인하면 이어갈 준비를 보여드려요.</p></div>}
          </section>
          <PreparationRecordPanel checked={summary.done} completed={summary.completed} upcoming={upcomingEvents.length} />
          {!showJoinedHandoff && <details className="rounded-[16px] border border-[var(--amora-line)] bg-white px-4">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg text-[12px] font-medium text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]"><Sparkles size={15} aria-hidden="true" />아모라와 오늘 할 일 정하기</summary>
            <div className="pb-4"><DailyAmoraFocusBridge partnerLinked={Boolean(partner)} /></div>
          </details>}
          {firstArrival && <LoungeFirstArrivalEmptyNote view={firstArrival} />}
        </div>
        <aside className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-2">
          <section data-tutorial-target="lounge-tools" aria-label="예산과 일정" className="space-y-4">
            <UpcomingEventsPanel events={upcomingEvents} />
            <BudgetPanel totalBudget={totalBudget} spentBudget={spentBudget} budgetWidth={budgetWidth} />
          </section>
          <LoungeReferencePanels categoryKey={priorityItems.find((item) => item.kind === "checklist")?.category.key ?? "greeting"} allocated={budgetTotals.photoAttireMakeup} />
        </aside>
      </div>
      <details className="rounded-[16px] border border-[var(--amora-line)] bg-white px-[18px] lg:px-6">
        <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-lg text-[12px] font-medium text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]"><span>참고한 자료와 같은 시기 준비 이야기</span><Users size={16} className="shrink-0 text-[var(--amora-rose)]" aria-hidden="true" /></summary>
        <div className="grid gap-4 pb-5 pt-1 lg:grid-cols-2">
          <SavedPostsPanel posts={savedPosts} loading={savedLoading} error={savedError} onRetry={() => setSavedRetry(value => value + 1)} />
          <CohortPulsePanel cohort={cohortState} onRetry={() => setCohortRetry(value => value + 1)} />
        </div>
      </details>
    </div>
  );
}
function HandoffMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-3">
      <dt className="text-[10px] font-semibold text-[var(--amora-muted)]">{label}</dt>
      <dd className="mt-1 truncate text-[13px] font-semibold text-[var(--amora-ink)]">
        {value}
      </dd>
      {note && (
        <dd className="mt-0.5 truncate text-[10px] font-medium text-[var(--amora-muted)]">
          {note}
        </dd>
      )}
    </div>
  );
}

function BudgetPanel({
  totalBudget,
  spentBudget,
  budgetWidth,
}: {
  totalBudget: number;
  spentBudget: number;
  budgetWidth: number;
}) {
  const balance = totalBudget - spentBudget;
  const overrun = totalBudget > 0 && balance < 0;
  const balanceLabel = totalBudget <= 0
    ? "기록 지출"
    : overrun
      ? "총 예산보다 더 기록된 금액"
      : "지출 기록을 뺀 금액";
  const balanceValue = totalBudget <= 0 ? spentBudget : Math.abs(balance);
  const tone = totalBudget <= 0 ? "예산 미정" : overrun ? "기록 초과" : "지출 기록 기준";

  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">예산</p>
          <h2 className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]">기록 지출 현황</h2>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--amora-warm)] px-2 py-1 text-[10px] font-semibold text-[var(--amora-ink)]">{tone}</span>
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-[11px] font-semibold text-[var(--amora-soft)]">{balanceLabel}</p>
            <p className="mt-1 break-words amora-display text-[23px] font-medium leading-tight text-[var(--amora-ink)]">
              {formatLoungeWon(balanceValue)}
            </p>
          </div>
          <p className="text-[13px] font-semibold text-[var(--amora-ink)]">
            {totalBudget > 0 ? `${formatLoungeBudgetRatio(spentBudget, totalBudget)} 기록` : "비율 계산 전"}
          </p>
        </div>
        <progress aria-label="총 예산 대비 기록 지출" value={budgetWidth} max={100} className="mt-3 block h-2 w-full overflow-hidden rounded-full border-0 bg-[var(--amora-warm)] [&::-moz-progress-bar]:bg-[var(--amora-ink)] [&::-webkit-progress-bar]:bg-[var(--amora-warm)] [&::-webkit-progress-value]:bg-[var(--amora-ink)]" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-medium text-[var(--amora-soft)]">
          <span>{formatLoungeWon(spentBudget)} 기록 지출</span>
          <span>총 {formatLoungeWon(totalBudget)}</span>
        </div>
        <p className="mt-2 text-[10px] font-medium leading-4 text-[var(--amora-soft)]">
          배정액·결제 여부와 별도로, 입력한 지출을 기준으로 계산해요.
        </p>
      </div>
      <Link {...weddingLinkProps("/budget")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[var(--amora-ink)]">
        예산 관리 열기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function UpcomingEventsPanel({ events }: { events: ScheduleEvent[] }) {
  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">일정</p>
          <h2 className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]">다가오는 일정</h2>
        </div>
        <Link {...weddingLinkProps("/schedule")} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-[12px] font-semibold text-[var(--amora-accent)]">일정 열기<CalendarCheck className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
      <div className="mt-4 space-y-2">
        {events.length > 0 ? (
          events.slice(0, 3).map((event) => (
            <Link key={event.id} {...weddingLinkProps("/schedule")} className="flex items-start gap-3 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3.5 py-3 hover:bg-white">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amora-ink)]" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-[var(--amora-ink)]">{event.title}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[var(--amora-soft)]">{formatDate(event.date)} · {isValidScheduleTime(event.time) ? event.time : "시간 미정"}</span>
              </span>
            </Link>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
            <p className="text-[13px] font-semibold text-[var(--amora-ink)]">가까운 일정이 없어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[var(--amora-soft)]">상담, 업체 방문, 옷을 입어보는 날짜를 넣으면 여기서 먼저 보여드려요.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SavedPostsPanel({ posts, loading, error, onRetry }: { posts: PostWithAuthor[]; loading: boolean; error: boolean; onRetry(): void }) {
  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">커뮤니티 참고글</p>
          <h2 className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]">저장해둔 판단 재료</h2>
        </div>
        <Bookmark className="h-5 w-5 text-[var(--amora-ink)]" />
      </div>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4 text-[13px] font-medium text-[var(--amora-soft)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : error ? <ResourceReadError message="저장한 글을 불러오지 못했어요." onRetry={onRetry} /> : posts.length > 0 ? (
          posts.map((post) => (
            <Link key={post.id} {...weddingLinkProps(`/community/post/${post.id}`)} className="block rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-3.5 hover:bg-white">
              <p className="line-clamp-1 text-[14px] font-semibold text-[var(--amora-ink)]">{post.title}</p>
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.55] text-[var(--amora-soft)]">{stripHtml(post.content)}</p>
              <p className="mt-2 text-[11px] font-semibold text-[var(--amora-rose-deep)]">
                댓글 {post.comment_count} · 저장 {post.bookmark_count}
              </p>
            </Link>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
            <p className="text-[13px] font-semibold text-[var(--amora-ink)]">아직 저장한 글이 없어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[var(--amora-soft)]">견적, 후기, 체크글을 저장하면 라운지에서 바로 다시 볼 수 있어요.</p>
          </div>
        )}
      </div>
      <Link {...weddingLinkProps("/community/my/bookmarks")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[var(--amora-ink)]">
        북마크 전체 보기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function CohortPulsePanel({ cohort, onRetry }: { cohort: CohortState; onRetry(): void }) {
  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">동기방</p>
          <h2 className="mt-1 amora-display text-[17px] text-[var(--amora-ink)]">같은 시기 흐름</h2>
        </div>
        <Users className="h-5 w-5 text-[var(--amora-ink)]" />
      </div>
      <div className="mt-4">
        {cohort.loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4 text-[13px] font-medium text-[var(--amora-soft)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            확인 중...
          </div>
        ) : cohort.error === "room" ? <ResourceReadError message="동기방 정보를 불러오지 못했어요." onRetry={onRetry} /> : cohort.room ? (
          <div className="space-y-3">
            {cohort.error === "digest" && <ResourceReadError message="동기방 요약을 불러오지 못했어요." onRetry={onRetry} />}
            <div className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-[var(--amora-ink)]">{cohort.room.name}</p>
                <span className="rounded-full bg-[var(--amora-sage-pale)] px-2.5 py-1 text-[11px] font-semibold text-[var(--amora-ink)]">
                  {cohort.room.member_count}명
                </span>
              </div>
              <p className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--amora-soft)]">
                {cohort.digest?.lead ?? cohort.lastMessage ?? (cohort.error === "digest" ? "요약을 다시 불러오면 이번 주 이야기를 확인할 수 있어요." : "아직 이번 주 요약이 많지 않아요.")}
              </p>
            </div>

            {cohort.digest && cohort.digest.topicBreakdown.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {cohort.digest.topicBreakdown.slice(0, 3).map((item) => (
                  <div key={item.topic} className="rounded-2xl border border-[var(--amora-line)] bg-white px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-[var(--amora-rose-deep)]">{item.label}</p>
                    <p className="mt-1 amora-display text-[22px] font-medium leading-none text-[var(--amora-ink)]">{item.count}</p>
                  </div>
                ))}
              </div>
            )}

            {cohort.digest?.highlights?.[0] && (
              <p className="rounded-2xl bg-[var(--amora-sage-pale)] px-4 py-3 text-[12px] font-medium leading-[1.65] text-[var(--amora-ink)]">
                {cohort.digest.highlights[0]}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
            <p className="text-[13px] font-semibold text-[var(--amora-ink)]">동기방이 아직 연결되지 않았어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[var(--amora-soft)]">예식 시기를 기준으로 같은 분기 방에 입장할 수 있어요.</p>
          </div>
        )}
      </div>
      <Link {...weddingLinkProps(cohort.room ? `/community/cohort/${cohort.room.id}` : "/community/cohort")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[var(--amora-ink)]">
        동기방 열기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function ResourceReadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div role="alert" className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
    <p className="text-[13px] font-semibold text-[var(--amora-ink)]">{message}</p>
    <p className="mt-1 text-[12px] leading-5 text-[var(--amora-soft)]">비어 있는 상태와는 달라요. 다시 확인해 주세요.</p>
    <button type="button" onClick={onRetry} className="mt-1 inline-flex min-h-11 items-center rounded-lg text-[13px] font-semibold text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]">다시 불러오기</button>
  </div>;
}
