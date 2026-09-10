"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Bookmark,
  CalendarCheck,
  ClipboardCheck,
  Clock3,
  HeartHandshake,
  Loader2,
  Sparkles,
  Users,
  Wallet,
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
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { getProgressSummary } from "@/app/(app)/lounge/progressSummary";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";
import { getWeeklyImminentCategories } from "@/utils/imminentChecklist";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import type { CohortRoom, CohortThreadTopic, PostWithAuthor } from "@/types/community.types";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

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

function formatWon(amount: number) {
  if (!amount) return "0만원";
  return `${Math.round(amount / 10000).toLocaleString("ko-KR")}만원`;
}

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

function getSpent(progress: Record<string, ProgressItem>) {
  return Object.entries(progress).reduce((sum, [key, item]) => {
    if (key.startsWith("__")) return sum;
    // 명시적으로 기록한 지출만 합산한다. legacy cost는 용도 확인 전까지
    // 예산 사용·지출·결제 완료 수치에서 제외한다.
    const amount = isValidWeddingWonAmount(item.spent) ? item.spent : 0;
    const next = sum + amount;
    return Number.isSafeInteger(next) ? next : sum;
  }, 0);
}

function getDdayLabel(dday: number | null) {
  if (dday === null) return "D-day 미정";
  if (dday > 0) return `D-${dday}`;
  if (dday === 0) return "D-day";
  return `D+${Math.abs(dday)}`;
}

export function getUpcomingEvents(progress: Record<string, ProgressItem>): ScheduleEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getEvents(progress as Record<string, unknown>)
    .filter((event) => {
      const date = new Date(event.date);
      return getScheduleEventStatus(event) === "planned"
        && !Number.isNaN(date.getTime())
        && date >= today;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);
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
  const { user, partner, profile, journey, isDemo } = useAuthStore();
  const userId = user?.id ?? null;
  const [savedPosts, setSavedPosts] = useState<PostWithAuthor[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
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
  });

  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const spentBudget = useMemo(() => getSpent(progress), [progress]);
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
  const imminentCategory = useMemo(
    () => getWeeklyImminentCategories(progress, journey?.wedding_date)[0] ?? null,
    [progress, journey?.wedding_date],
  );
  const budgetPercent = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
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
        if (!cancelled) setSavedPosts([]);
      })
      .finally(() => {
        if (!cancelled) setSavedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemo, userId]);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) {
      setCohortState({
        room: DEMO_COHORT_ROOM,
        lastMessage: "결혼식 날 받는 사진 파일 수는 계약서에 적어두자는 이야기가 나왔어요.",
        loading: false,
        digest: DEMO_DIGEST,
      });
      return;
    }
    if (!userId) {
      setCohortState({ room: null, lastMessage: null, loading: false, digest: null });
      return;
    }

    setCohortState((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const cohortRes = await fetch("/api/community/cohort", { cache: "no-store" });
        if (!cohortRes.ok) throw new Error("cohort");
        const cohortData = (await cohortRes.json()) as { room?: CohortRoom | null; lastMessage?: string | null };
        if (cancelled) return;

        let digest: CohortDigest | null = null;
        if (cohortData.room?.id) {
          const digestRes = await fetch(
            `/api/community/cohort/${encodeURIComponent(cohortData.room.id)}/digest?period=week`,
            { cache: "no-store" }
          );
          if (digestRes.ok) digest = (await digestRes.json()) as CohortDigest;
        }

        if (!cancelled) {
          setCohortState({
            room: cohortData.room ?? null,
            lastMessage: cohortData.lastMessage ?? null,
            loading: false,
            digest,
          });
        }
      } catch {
        if (!cancelled) setCohortState({ room: null, lastMessage: null, loading: false, digest: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemo, userId]);

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
    <div className="mx-auto max-w-[1160px] space-y-5 px-[18px] py-5 text-[var(--amora-ink)] md:space-y-6 md:px-9 md:py-6">
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
                className="mt-1 amora-display text-[var(--amora-ink)]"
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
              value={totalBudget > 0 ? formatWon(totalBudget) : "미입력"}
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
      <section aria-label="현재 준비 현황">
        <div className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[var(--amora-line)] bg-[var(--amora-warm)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--amora-rose-deep)]">
                <Sparkles className="h-4 w-4" />
                {companionCopy.loungeLabel}
              </p>
              <h2 className="amora-display mt-4 text-[22px] text-[var(--amora-ink)] md:text-[26px]">
                {companionCopy.statusHeading}
              </h2>
              <p className="mt-2 max-w-[560px] text-[14px] font-medium leading-[1.7] text-[var(--amora-soft)]">
                {companionCopy.description}
              </p>
              <p className="mt-2 max-w-[560px] text-[12px] font-medium leading-[1.6] text-[var(--amora-muted)]">
                {plan.stageLabel} · {plan.stageSummary}
              </p>
            </div>
            <div className="min-w-[116px] rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] px-4 py-3 text-right">
              <p className="text-[11px] font-semibold text-[var(--amora-rose-deep)]">결혼식 날짜</p>
              <p className="mt-1 amora-display text-[30px] font-medium leading-none text-[var(--amora-ink)]">
                {getDdayLabel(plan.dday)}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-[var(--amora-soft)]">{formatDate(journey?.wedding_date)}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 md:gap-3">
            <MetricTile
              label="체크 진행"
              value={`${progressPercent}%`}
              note={`${summary.done}/${summary.total}개 직접 체크`}
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <MetricTile
              label="기록 지출 비율"
              value={totalBudget > 0 ? `${budgetPercent}%` : "미입력"}
              note={totalBudget > 0
                ? `${formatWon(spentBudget)} 기록 / ${formatWon(totalBudget)} · 결제 확인과 별도`
                : `${formatWon(spentBudget)} 기록 · 총 예산 입력 전`}
              icon={<Wallet className="h-4 w-4" />}
            />
            <MetricTile
              label="준비 방식"
              value={partner ? "함께 준비" : "혼자 준비"}
              note={partnerLabel}
              icon={<Users className="h-4 w-4" />}
              // 초대 안내는 아직 혼자인 사람에게만 짚는다. 이미 연결된 사람에게
              // 앵커가 없으면 그 단계(optional)는 투어가 조용히 건너뛴다.
              tutorialTarget={partner ? undefined : "lounge-invite"}
            />
          </div>
        </div>

      </section>

      <section id="today-missions" data-tutorial-target="lounge-focus" aria-labelledby="today-missions-title" className="scroll-mt-28 border-t border-[var(--amora-line)] pt-6">
        {imminentCategory && <p aria-label="기본 확인 시점 안내" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--amora-line)] bg-[var(--amora-warm)] px-4 py-2 text-[12px] leading-5 text-[var(--amora-soft)]">
          <span><span className="font-semibold">{imminentCategory.label}</span> · {imminentCategory.deadlineDaysLeft < 0
            ? `기본 확인 시점에서 ${Math.abs(imminentCategory.deadlineDaysLeft)}일 지남`
            : `기본 확인 시점까지 ${imminentCategory.deadlineDaysLeft}일`}</span>
          <span>실제 일정·완료 여부를 확인해 주세요.</span>
          <Link {...weddingLinkProps(`/checklist?category=${encodeURIComponent(imminentCategory.key)}`)} className="inline-flex min-h-11 items-center gap-1 rounded-lg font-semibold text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]">체크리스트 확인<ArrowRight size={14} aria-hidden="true" /></Link>
        </p>}
        <AmoraMissions embedded />
      </section>

      {!showJoinedHandoff && <details className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] px-4">
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg text-[13px] font-semibold text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]">
          <Sparkles size={16} aria-hidden="true" />아모라와 오늘 할 일 정하기
        </summary>
        <div className="pb-4"><DailyAmoraFocusBridge partnerLinked={Boolean(partner)} /></div>
      </details>}

      {/* 왜 아직 비어 있는지를 빈 위젯 바로 위에서 말한다. 설명 없는 빈 화면은
          "고장 났나?"로 읽힌다. */}
      {firstArrival && <LoungeFirstArrivalEmptyNote view={firstArrival} />}

      <section data-tutorial-target="lounge-tools" aria-label="예산과 일정" className="grid gap-4 md:grid-cols-2">
        <BudgetPanel totalBudget={totalBudget} spentBudget={spentBudget} budgetPercent={budgetPercent} budgetWidth={budgetWidth} />
        <UpcomingEventsPanel events={upcomingEvents} />
      </section>

      <details className="border-t border-[var(--amora-line)] pt-2">
        <summary className="flex min-h-12 cursor-pointer items-center rounded-lg text-[13px] font-semibold text-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]">참고한 자료와 같은 시기 준비 이야기</summary>
        <div className="grid gap-4 pb-4 pt-2 lg:grid-cols-2">
          <SavedPostsPanel posts={savedPosts} loading={savedLoading} />
          <CohortPulsePanel cohort={cohortState} />
        </div>
      </details>
    </div>
  );
}

function MetricTile({
  label,
  value,
  note,
  icon,
  tutorialTarget,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  /** 첫 실행 투어가 이 타일을 짚어야 할 때만 준다. */
  tutorialTarget?: string;
}) {
  return (
    <div
      data-tutorial-target={tutorialTarget}
      className="min-w-0 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-2.5 md:p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[var(--amora-rose-deep)]">{label}</p>
        <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[var(--amora-ink)] md:flex">{icon}</span>
      </div>
      <p className="mt-2 break-words amora-display text-[19px] md:text-[24px] font-medium leading-none text-[var(--amora-ink)]">{value}</p>
      <p className="mt-1.5 break-words text-[11px] font-medium text-[var(--amora-soft)]">{note}</p>
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
  budgetPercent,
  budgetWidth,
}: {
  totalBudget: number;
  spentBudget: number;
  budgetPercent: number;
  budgetWidth: number;
}) {
  const balance = totalBudget - spentBudget;
  const overrun = totalBudget > 0 && balance < 0;
  const balanceLabel = totalBudget <= 0
    ? "기록 지출"
    : overrun
      ? "총 예산보다 더 기록된 금액"
      : "남은 예산";
  const balanceValue = totalBudget <= 0 ? spentBudget : Math.abs(balance);
  const tone = totalBudget <= 0
    ? "예산 미정"
    : budgetPercent > 100
      ? "기록 초과"
      : budgetPercent === 100
        ? "한도 도달"
        : budgetPercent >= 85
          ? "주의"
          : "안정";

  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">예산</p>
          <h2 className="mt-1 amora-display text-[var(--amora-ink)]">기록 지출 현황</h2>
        </div>
        <span className="rounded-full bg-[var(--amora-warm)] px-3 py-1 text-[12px] font-semibold text-[var(--amora-ink)]">{tone}</span>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold text-[var(--amora-soft)]">{balanceLabel}</p>
            <p className="mt-1 amora-display text-[28px] font-medium leading-none text-[var(--amora-ink)]">
              {formatWon(balanceValue)}
            </p>
          </div>
          <p className="text-[13px] font-semibold text-[var(--amora-ink)]">
            {totalBudget > 0 ? `${budgetPercent}% 기록` : "비율 계산 전"}
          </p>
        </div>
        <progress aria-label="총 예산 대비 기록 지출" value={budgetWidth} max={100} className="mt-3 block h-2 w-full overflow-hidden rounded-full border-0 bg-[var(--amora-warm)] [&::-moz-progress-bar]:bg-[var(--amora-ink)] [&::-webkit-progress-bar]:bg-[var(--amora-warm)] [&::-webkit-progress-value]:bg-[var(--amora-ink)]" />
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[var(--amora-soft)]">
          <span>{formatWon(spentBudget)} 기록 지출</span>
          <span>총 {formatWon(totalBudget)}</span>
        </div>
        <p className="mt-2 text-[10px] font-medium leading-4 text-[var(--amora-soft)]">
          기록 지출은 사용자가 입력한 금액이며 결제 완료 확인과는 별도예요.
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
          <h2 className="mt-1 amora-display text-[var(--amora-ink)]">다가오는 예약</h2>
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
                <span className="mt-0.5 block text-[11px] font-medium text-[var(--amora-soft)]">{formatDate(event.date)}</span>
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

function SavedPostsPanel({ posts, loading }: { posts: PostWithAuthor[]; loading: boolean }) {
  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">커뮤니티 참고글</p>
          <h2 className="mt-1 amora-display text-[var(--amora-ink)]">저장해둔 판단 재료</h2>
        </div>
        <Bookmark className="h-5 w-5 text-[var(--amora-ink)]" />
      </div>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4 text-[13px] font-medium text-[var(--amora-soft)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : posts.length > 0 ? (
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

function CohortPulsePanel({ cohort }: { cohort: CohortState }) {
  return (
    <section className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">동기방</p>
          <h2 className="mt-1 amora-display text-[var(--amora-ink)]">같은 시기 흐름</h2>
        </div>
        <Users className="h-5 w-5 text-[var(--amora-ink)]" />
      </div>
      <div className="mt-4">
        {cohort.loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4 text-[13px] font-medium text-[var(--amora-soft)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            확인 중...
          </div>
        ) : cohort.room ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-[var(--amora-ink)]">{cohort.room.name}</p>
                <span className="rounded-full bg-[var(--amora-sage-pale)] px-2.5 py-1 text-[11px] font-semibold text-[var(--amora-ink)]">
                  {cohort.room.member_count}명
                </span>
              </div>
              <p className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--amora-soft)]">
                {cohort.digest?.lead ?? cohort.lastMessage ?? "아직 이번 주 요약이 많지 않아요."}
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
