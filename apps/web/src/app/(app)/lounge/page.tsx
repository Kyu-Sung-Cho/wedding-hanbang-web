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
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  EyeOff,
  HeartHandshake,
  ListChecks,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import DailyAmoraFocusBridge from "@/components/app/DailyAmoraFocusBridge";
import WeeklyCard from "@/components/app/WeeklyCard";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  getDashboardCompanionCopy,
  getJoinedDashboardMarkerSnapshot,
  JOINED_PLAN_REVIEW_PROMPT,
  notifyJoinedDashboardMarkerChanged,
  removeJoinedDashboardMarker,
  subscribeJoinedDashboardMarker,
} from "@/lib/amora/dashboardCompanion";
import { buildAmoraLifecyclePlan, type AmoraGuardrailSeverity } from "@/lib/amora/lifecycle";
import { getAmoraActions, mergeAmoraActions, type AmoraActionItem, type AmoraActionStatus } from "@/lib/amora/actions";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { getChecklistCounts, mergeChecklist } from "@/utils/checklist";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import type { CohortRoom, CohortThreadTopic, PostWithAuthor } from "@/types/community.types";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";

type Status = ProgressItem["status"];

interface LoungePriority {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  tone: "urgent" | "watch" | "steady";
  actionId?: string;
}

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

const STATUS_LABEL: Record<Status, string> = {
  not_started: "예정",
  in_progress: "진행 중",
  completed: "완료",
  not_applicable: "해당 없음",
};

const STATUS_TONE: Record<Status, string> = {
  not_started: "border-[#eadfc9] bg-white text-[#5d6879]",
  in_progress: "border-[#dfc88f] bg-[#fff8ec] text-[#9d6f36]",
  completed: "border-[#cdd8bf] bg-[#f4f8ee] text-[#607044]",
  not_applicable: "border-[#e3e0da] bg-[#f6f4f0] text-[#8b857c]",
};

const GUARDRAIL_TONE: Record<AmoraGuardrailSeverity, LoungePriority["tone"]> = {
  critical: "urgent",
  warning: "watch",
  steady: "steady",
  celebrate: "steady",
};

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

function getStatus(progress: Record<string, ProgressItem>, key: string): Status {
  const status = progress[key]?.status;
  if (status === "completed" || status === "in_progress" || status === "not_started") return status;
  return "not_started";
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

function getChecklistProgress(progress: Record<string, ProgressItem>, key: string) {
  const template = CATEGORY_CHECKLISTS.find((category) => category.key === key);
  const saved = progress[key]?.checklist;
  const status = getStatus(progress, key);
  if (!template) return { done: status === "completed" ? 1 : 0, total: 1 };
  const merged = mergeChecklist(template.items, saved, status);
  return getChecklistCounts(merged);
}

function getProgressSummary(progress: Record<string, ProgressItem>) {
  return CATEGORY_CHECKLISTS.reduce(
    (acc, category) => {
      const status = getStatus(progress, category.key);
      // "해당 없음"으로 끈 항목은 진행률 분모에서 빠진다 —
      // 함·폐백·예단을 생략한 커플이 영원히 미완료로 남지 않게.
      if (status === "not_applicable") {
        acc.not_applicable += 1;
        return acc;
      }
      const counts = getChecklistProgress(progress, category.key);
      acc[status] += 1;
      acc.done += counts.done;
      acc.total += counts.total;
      return acc;
    },
    { completed: 0, in_progress: 0, not_started: 0, not_applicable: 0, done: 0, total: 0 }
  );
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

function normalizeHref(href: string | undefined, fallback = "/chat") {
  if (!href) return weddingPath(fallback);
  return weddingPath(href);
}

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function actionToPriority(action: AmoraActionItem): LoungePriority {
  return {
    id: action.id,
    eyebrow: action.dueDate ? `아모라 기억 · ${action.dueDate}` : "아모라 기억",
    title: action.title,
    body: action.description ?? "채팅에서 남겨둔 다음 행동이에요.",
    href: normalizeHref(action.href),
    cta: "열기",
    tone: action.priority === "high" ? "urgent" : action.priority === "low" ? "steady" : "watch",
    actionId: action.id,
  };
}

function buildPriorities(plan: ReturnType<typeof buildAmoraLifecyclePlan>, actions: AmoraActionItem[], events: ScheduleEvent[]) {
  const primary: LoungePriority = {
    id: plan.primaryAction.id,
    eyebrow: plan.primaryAction.dueLabel ?? "아모라가 정리한 다음 일",
    title: plan.primaryAction.title,
    body: plan.primaryAction.body,
    href: normalizeHref(plan.primaryAction.href),
    cta: plan.primaryAction.cta,
    tone: GUARDRAIL_TONE[plan.primaryAction.severity],
  };

  const actionPriorities: LoungePriority[] = actions.slice(0, 2).map(actionToPriority);
  const eventPriority: LoungePriority | null = events[0]
    ? {
        id: `event_${events[0].id}`,
        eyebrow: "다가오는 일정",
        title: events[0].title,
        body: `${formatDate(events[0].date)}에 예정되어 있어요. 메모와 준비물을 한 번 확인해두세요.`,
        href: weddingPath("/schedule"),
        cta: "일정 보기",
        tone: "steady" as const,
    }
    : null;

  const merged: LoungePriority[] = [primary, ...actionPriorities, ...(eventPriority ? [eventPriority] : [])];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.title}:${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function getActiveCategories(progress: Record<string, ProgressItem>, dday: number | null) {
  return CATEGORY_CHECKLISTS.map((category) => {
    const counts = getChecklistProgress(progress, category.key);
    const status = getStatus(progress, category.key);
    const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    const daysUntilDeadline = dday === null ? null : dday - category.ddayDeadline;
    return { category, counts, status, percent, daysUntilDeadline };
  })
    .filter((item) => item.status !== "completed")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "in_progress" ? -1 : b.status === "in_progress" ? 1 : 0;
      const aDeadline = a.daysUntilDeadline ?? 9999;
      const bDeadline = b.daysUntilDeadline ?? 9999;
      return aDeadline - bDeadline;
    })
    .slice(0, 6);
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
  const { user, partner, journey, isDemo } = useAuthStore();
  const userId = user?.id ?? null;
  const [savedPosts, setSavedPosts] = useState<PostWithAuthor[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const joinedHandoffVisible = useSyncExternalStore(
    subscribeJoinedDashboardMarker,
    getJoinedDashboardMarkerSnapshot,
    () => false,
  );
  const [storedActions, setStoredActions] = useState<AmoraActionItem[]>([]);
  const [actionUpdatingId, setActionUpdatingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
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
  const openActions = useMemo(() => {
    const legacyActions = getAmoraActions(progress as Record<string, ProgressItem | unknown>);
    return mergeAmoraActions(storedActions, legacyActions).filter((action) => action.status === "open");
  }, [progress, storedActions]);
  const upcomingEvents = useMemo(() => getUpcomingEvents(progress), [progress]);
  const priorities = useMemo(() => buildPriorities(plan, openActions, upcomingEvents), [plan, openActions, upcomingEvents]);
  const activeCategories = useMemo(() => getActiveCategories(progress, plan.dday), [progress, plan.dday]);
  const budgetPercent = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
  const budgetWidth = Math.min(100, Math.max(0, budgetPercent));
  const progressPercent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
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
    if (isDemo || !userId) {
      setStoredActions([]);
      return;
    }

    fetch("/api/amora/actions?status=open&limit=8", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { actions?: AmoraActionItem[] }) => {
        if (!cancelled) setStoredActions(data.actions ?? []);
      })
      .catch(() => {
        if (!cancelled) setStoredActions([]);
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

  const handleActionStatus = async (actionId: string, status: Extract<AmoraActionStatus, "done" | "dismissed">) => {
    const target = openActions.find((action) => action.id === actionId);
    if (!target || actionUpdatingId) return;

    const previous = storedActions;
    const now = new Date().toISOString();
    const optimistic: AmoraActionItem = {
      ...target,
      status,
      updatedAt: now,
      completedAt: status === "done" ? now : target.completedAt,
    };

    setActionUpdatingId(actionId);
    setActionNotice(null);
    setStoredActions((current) => mergeAmoraActions([optimistic], current));

    if (isDemo) {
      setActionNotice(status === "done" ? "완료로 표시했어요." : "숨겼어요.");
      setActionUpdatingId(null);
      return;
    }

    try {
      const response = await fetch(`/api/amora/actions/${encodeURIComponent(actionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = (await response.json()) as { action?: AmoraActionItem };
      if (data.action) {
        setStoredActions((current) => mergeAmoraActions([data.action as AmoraActionItem], current));
      }
      setActionNotice(status === "done" ? "완료로 표시했어요." : "숨겼어요.");
    } catch {
      setStoredActions(previous);
      setActionNotice("처리하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setActionUpdatingId(null);
    }
  };

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
    <div className="space-y-5 text-[#061a34]">
      {showJoinedHandoff && (
        <section
          data-testid="joined-plan-handoff"
          className="rounded-[22px] border border-[#C7D1C2] bg-[#F7FAF5] p-5 shadow-[0_14px_36px_rgba(54,83,78,0.09)] md:p-6"
          aria-labelledby="joined-plan-title"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E] shadow-[0_4px_14px_rgba(54,83,78,0.08)]">
              <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#607044]">
                함께 준비 시작
              </p>
              <h2
                id="joined-plan-title"
                className="mt-1 font-serif-kr text-[26px] font-medium leading-tight text-[#243832] md:text-[30px]"
              >
                이제 이 계획을 함께 봐요
              </h2>
              <p className="mt-2 text-[13px] font-medium leading-6 text-[#5D6879]">
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#36534E] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#2B423E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 sm:w-auto"
            >
              함께 확인할 내용 찾기
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={dismissJoinedHandoff}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-[13px] font-semibold text-[#5D6879] transition-colors hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 sm:w-auto"
            >
              이 내용 확인했어요
            </button>
          </div>
        </section>
      )}
      {!showJoinedHandoff && (
        <div className="lg:hidden">
          <DailyAmoraFocusBridge
            partnerLinked={Boolean(partner)}
            focusTitle={priorities[0]?.title ?? null}
          />
        </div>
      )}
      <section className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
        <div className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_14px_36px_rgba(8,22,38,0.045)] md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
                <Sparkles className="h-4 w-4" />
                {companionCopy.loungeLabel}
              </p>
              <h1 className="mt-4 font-serif-kr text-[32px] font-medium leading-[1.18] text-[#061a34] md:text-[42px]">
                {companionCopy.statusHeading}
              </h1>
              <p className="mt-2 max-w-[560px] text-[14px] font-medium leading-[1.7] text-[#38475c]">
                {companionCopy.description}
              </p>
              <p className="mt-2 max-w-[560px] text-[12px] font-medium leading-[1.6] text-[#7A8290]">
                {plan.stageLabel} · {plan.stageSummary}
              </p>
            </div>
            <div className="min-w-[116px] rounded-[18px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-right">
              <p className="text-[11px] font-semibold text-[#9d6f36]">결혼식 날짜</p>
              <p className="mt-1 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">
                {getDdayLabel(plan.dday)}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-[#5d6879]">{formatDate(journey?.wedding_date)}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
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
            />
          </div>
        </div>

        <div className="rounded-[22px] border border-[#29433e] bg-[#36534E] p-5 text-white shadow-[0_16px_38px_rgba(54,83,78,0.16)] md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold text-[#ecd7a4]">아모라 브리핑</p>
              <h2 className="mt-1 font-serif-kr text-[27px] font-medium leading-tight">지금 먼저 볼 것</h2>
            </div>
            <ShieldCheck className="h-6 w-6 text-[#ecd7a4]" />
          </div>
          <div className="mt-5 space-y-3">
            {!showJoinedHandoff && (
              <div className="hidden lg:block">
                <DailyAmoraFocusBridge
                  partnerLinked={Boolean(partner)}
                  focusTitle={priorities[0]?.title ?? null}
                />
              </div>
            )}
            {priorities.map((item, index) => (
              <PriorityCard
                key={item.id}
                item={item}
                index={index}
                updating={actionUpdatingId === item.actionId}
                onActionStatus={handleActionStatus}
              />
            ))}
          </div>
          {actionNotice && (
            <p className="mt-3 rounded-full bg-white/10 px-3 py-2 text-[12px] font-semibold text-white/80">
              {actionNotice}
            </p>
          )}
        </div>
      </section>

      <WeeklyCard weddingDate={journey?.wedding_date} totalBudget={totalBudget} progress={progress} actions={openActions} />

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">준비 흐름</p>
              <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">놓치기 쉬운 항목</h2>
            </div>
            <Link
              {...weddingLinkProps("/schedule")}
              className="inline-flex items-center gap-1 rounded-full border border-[#eadfc9] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#36534E] hover:bg-[#fff8ec]"
            >
              전체 체크
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {activeCategories.length > 0 ? (
              activeCategories.map((item) => (
                <CategoryRow key={item.category.key} item={item} />
              ))
            ) : (
              <div className="sm:col-span-2 rounded-[16px] border border-[#dce8d4] bg-[#f6fbf4] p-4">
                <CheckCircle2 className="h-5 w-5 text-[#607044]" />
                <p className="mt-2 text-[14px] font-semibold text-[#263832]">열려 있는 핵심 항목이 안정적이에요.</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <BudgetPanel totalBudget={totalBudget} spentBudget={spentBudget} budgetPercent={budgetPercent} budgetWidth={budgetWidth} />
          <UpcomingEventsPanel events={upcomingEvents} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <SavedPostsPanel posts={savedPosts} loading={savedLoading} />
        <CohortPulsePanel cohort={cohortState} />
      </section>

      <section className="grid gap-3 rounded-[22px] border border-[#eadfc9] bg-[#fffaf0] p-5 md:grid-cols-3">
        {[
          {
            icon: HeartHandshake,
            title: "커뮤니티에서 확인",
            body: "남들이 겪은 조건과 질문을 먼저 봅니다.",
            href: weddingPath(),
          },
          {
            icon: MessageCircle,
            title: "아모라가 해석",
            body: "내 결혼식 날짜, 예산, 진행 단계에 맞게 바꿉니다.",
            href: weddingPath("/chat"),
          },
          {
            icon: ListChecks,
            title: "라운지에 남김",
            body: "일정, 예산, 체크리스트, 다음 행동으로 관리합니다.",
            href: weddingPath("/schedule"),
          },
        ].map((item) => (
          <Link key={item.title} {...weddingLinkProps(item.href)} className="group flex gap-4 rounded-[16px] bg-white/80 p-4 hover:bg-white">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff8ec] text-[#36534E]">
              <item.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-[#071629]">{item.title}</span>
              <span className="mt-1 block text-[12px] font-medium leading-[1.6] text-[#5d6879]">{item.body}</span>
            </span>
            <ChevronRight className="ml-auto mt-2 h-4 w-4 shrink-0 text-[#36534E] transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-[#9d6f36]">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E]">{icon}</span>
      </div>
      <p className="mt-2 truncate font-serif-kr text-[24px] font-medium leading-none text-[#071629]">{value}</p>
      <p className="mt-1.5 truncate text-[11px] font-medium text-[#5d6879]">{note}</p>
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
    <div className="min-w-0 rounded-[14px] border border-[#DCE5D8] bg-white/88 p-3">
      <dt className="text-[10px] font-semibold text-[#71806D]">{label}</dt>
      <dd className="mt-1 truncate text-[13px] font-semibold text-[#243832]">
        {value}
      </dd>
      {note && (
        <dd className="mt-0.5 truncate text-[10px] font-medium text-[#7A8290]">
          {note}
        </dd>
      )}
    </div>
  );
}

function PriorityCard({
  item,
  index,
  updating,
  onActionStatus,
}: {
  item: LoungePriority;
  index: number;
  updating: boolean;
  onActionStatus: (actionId: string, status: Extract<AmoraActionStatus, "done" | "dismissed">) => void;
}) {
  const tone =
    item.tone === "urgent"
      ? "border-[#f3c2ad] bg-[#fff5ef]"
      : item.tone === "watch"
        ? "border-[#eadfc9] bg-[#fff8ec]"
        : "border-white/10 bg-white/[0.08]";
  const textTone = item.tone === "steady" ? "text-white" : "text-[#263832]";
  const subTone = item.tone === "steady" ? "text-white/70" : "text-[#635b51]";
  const hasActionControls = Boolean(item.actionId);

  return (
    <div className={`rounded-[16px] border p-3.5 transition-transform hover:-translate-y-0.5 ${tone}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            item.tone === "steady" ? "bg-white/12 text-[#ecd7a4]" : "bg-white text-[#36534E]"
          }`}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[11px] font-semibold ${subTone}`}>{item.eyebrow}</span>
          <span className={`mt-0.5 block text-[14px] font-semibold leading-[1.35] ${textTone}`}>{item.title}</span>
          <span className={`mt-1 line-clamp-2 text-[12px] font-medium leading-[1.55] ${subTone}`}>{item.body}</span>
        </span>
        <Link
          {...weddingLinkProps(item.href)}
          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            item.tone === "steady" ? "bg-white text-[#36534E]" : "bg-[#36534E] text-white"
          }`}
        >
          {item.cta}
        </Link>
      </div>
      {hasActionControls && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-11">
          <button
            type="button"
            onClick={() => item.actionId && onActionStatus(item.actionId, "done")}
            disabled={updating}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              item.tone === "steady"
                ? "border-white/15 bg-white/10 text-white hover:bg-white/15"
                : "border-[#d8e0d5] bg-white text-[#36534E] hover:bg-[#f6f9f6]"
            }`}
          >
            {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            완료
          </button>
          <button
            type="button"
            onClick={() => item.actionId && onActionStatus(item.actionId, "dismissed")}
            disabled={updating}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              item.tone === "steady"
                ? "border-white/15 bg-transparent text-white/75 hover:bg-white/10"
                : "border-[#eadfc9] bg-transparent text-[#6d6254] hover:bg-white/60"
            }`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            숨김
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  item,
}: {
  item: ReturnType<typeof getActiveCategories>[number];
}) {
  const deadline =
    item.daysUntilDeadline === null
      ? "기본 확인 순서"
      : item.daysUntilDeadline < 0
        ? `기본 확인 시점에서 ${Math.abs(item.daysUntilDeadline)}일 지남`
        : `기본 확인 시점까지 ${item.daysUntilDeadline}일`;

  return (
    <Link
      {...weddingLinkProps("/schedule")}
      className="group rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-3.5 hover:border-[#d8bb86] hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#071629]">{item.category.label}</p>
          <p className="mt-1 text-[11px] font-medium text-[#7a8290]">{deadline} · {item.counts.done}/{item.counts.total} 체크</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[item.status]}`}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
        <span className="block h-full rounded-full bg-[#36534E]" style={{ width: `${item.percent}%` }} />
      </span>
    </Link>
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
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">예산</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">기록 지출 현황</h2>
        </div>
        <span className="rounded-full bg-[#fff8ec] px-3 py-1 text-[12px] font-semibold text-[#36534E]">{tone}</span>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold text-[#7a8290]">{balanceLabel}</p>
            <p className="mt-1 font-serif-kr text-[28px] font-medium leading-none text-[#071629]">
              {formatWon(balanceValue)}
            </p>
          </div>
          <p className="text-[13px] font-semibold text-[#36534E]">
            {totalBudget > 0 ? `${budgetPercent}% 기록` : "비율 계산 전"}
          </p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-[#efe6d7]">
          <span className="block h-full rounded-full bg-[#36534E]" style={{ width: `${budgetWidth}%` }} />
        </span>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[#7a8290]">
          <span>{formatWon(spentBudget)} 기록 지출</span>
          <span>총 {formatWon(totalBudget)}</span>
        </div>
        <p className="mt-2 text-[10px] font-medium leading-4 text-[#7a8290]">
          기록 지출은 사용자가 입력한 금액이며 결제 완료 확인과는 별도예요.
        </p>
      </div>
      <Link {...weddingLinkProps("/budget")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[#36534E]">
        예산 관리 열기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function UpcomingEventsPanel({ events }: { events: ScheduleEvent[] }) {
  return (
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">일정</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">다가오는 예약</h2>
        </div>
        <CalendarCheck className="h-5 w-5 text-[#36534E]" />
      </div>
      <div className="mt-4 space-y-2">
        {events.length > 0 ? (
          events.slice(0, 3).map((event) => (
            <Link key={event.id} {...weddingLinkProps("/schedule")} className="flex items-start gap-3 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-3.5 py-3 hover:bg-white">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#36534E]" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-[#071629]">{event.title}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#7a8290]">{formatDate(event.date)}</span>
              </span>
            </Link>
          ))
        ) : (
          <div className="rounded-[14px] border border-dashed border-[#eadfc9] bg-[#fffdf7] p-4">
            <p className="text-[13px] font-semibold text-[#071629]">가까운 일정이 없어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[#7a8290]">상담, 업체 방문, 옷을 입어보는 날짜를 넣으면 여기서 먼저 보여드려요.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SavedPostsPanel({ posts, loading }: { posts: PostWithAuthor[]; loading: boolean }) {
  return (
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">커뮤니티 참고글</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">저장해둔 판단 재료</h2>
        </div>
        <Bookmark className="h-5 w-5 text-[#36534E]" />
      </div>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-4 text-[13px] font-medium text-[#7a8290]">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <Link key={post.id} {...weddingLinkProps(`/community/post/${post.id}`)} className="block rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-3.5 hover:bg-white">
              <p className="line-clamp-1 text-[14px] font-semibold text-[#071629]">{post.title}</p>
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.55] text-[#5d6879]">{stripHtml(post.content)}</p>
              <p className="mt-2 text-[11px] font-semibold text-[#9d6f36]">
                댓글 {post.comment_count} · 저장 {post.bookmark_count}
              </p>
            </Link>
          ))
        ) : (
          <div className="rounded-[14px] border border-dashed border-[#eadfc9] bg-[#fffdf7] p-4">
            <p className="text-[13px] font-semibold text-[#071629]">아직 저장한 글이 없어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[#7a8290]">견적, 후기, 체크글을 저장하면 라운지에서 바로 다시 볼 수 있어요.</p>
          </div>
        )}
      </div>
      <Link {...weddingLinkProps("/community/my/bookmarks")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[#36534E]">
        북마크 전체 보기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function CohortPulsePanel({ cohort }: { cohort: CohortState }) {
  return (
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">동기방</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">같은 시기 흐름</h2>
        </div>
        <Users className="h-5 w-5 text-[#36534E]" />
      </div>
      <div className="mt-4">
        {cohort.loading ? (
          <div className="flex items-center gap-2 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-4 text-[13px] font-medium text-[#7a8290]">
            <Loader2 className="h-4 w-4 animate-spin" />
            확인 중...
          </div>
        ) : cohort.room ? (
          <div className="space-y-3">
            <div className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-[#071629]">{cohort.room.name}</p>
                <span className="rounded-full bg-[#eef4ef] px-2.5 py-1 text-[11px] font-semibold text-[#36534E]">
                  {cohort.room.member_count}명
                </span>
              </div>
              <p className="mt-2 text-[13px] font-medium leading-[1.6] text-[#5d6879]">
                {cohort.digest?.lead ?? cohort.lastMessage ?? "아직 이번 주 요약이 많지 않아요."}
              </p>
            </div>

            {cohort.digest && cohort.digest.topicBreakdown.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {cohort.digest.topicBreakdown.slice(0, 3).map((item) => (
                  <div key={item.topic} className="rounded-[14px] border border-[#eadfc9] bg-white px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-[#9d6f36]">{item.label}</p>
                    <p className="mt-1 font-serif-kr text-[22px] font-medium leading-none text-[#071629]">{item.count}</p>
                  </div>
                ))}
              </div>
            )}

            {cohort.digest?.highlights?.[0] && (
              <p className="rounded-[14px] bg-[#f6f9f6] px-4 py-3 text-[12px] font-medium leading-[1.65] text-[#36534E]">
                {cohort.digest.highlights[0]}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[#eadfc9] bg-[#fffdf7] p-4">
            <p className="text-[13px] font-semibold text-[#071629]">동기방이 아직 연결되지 않았어요.</p>
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[#7a8290]">예식 시기를 기준으로 같은 분기 방에 입장할 수 있어요.</p>
          </div>
        )}
      </div>
      <Link {...weddingLinkProps(cohort.room ? `/community/cohort/${cohort.room.id}` : "/community/cohort")} className="mt-4 inline-flex items-center text-[12px] font-semibold text-[#36534E]">
        동기방 열기
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
