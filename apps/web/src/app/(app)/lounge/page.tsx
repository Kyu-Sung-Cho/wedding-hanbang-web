"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import WeeklyCard from "@/components/app/WeeklyCard";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { buildAmoraLifecyclePlan, type AmoraGuardrailSeverity } from "@/lib/amora/lifecycle";
import { getAmoraActions, mergeAmoraActions, type AmoraActionItem, type AmoraActionStatus } from "@/lib/amora/actions";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { getChecklistCounts, mergeChecklist } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import type { CohortRoom, CohortThreadTopic, PostWithAuthor } from "@/types/community.types";

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
  error: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  not_started: "예정",
  in_progress: "진행 중",
  completed: "완료",
};

const STATUS_TONE: Record<Status, string> = {
  not_started: "border-[#eadfc9] bg-white text-[#5d6879]",
  in_progress: "border-[#dfc88f] bg-[#fff8ec] text-[#9d6f36]",
  completed: "border-[#cdd8bf] bg-[#f4f8ee] text-[#607044]",
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
  lead: "이번 주는 드레스 투어와 스냅 예약 이야기가 가장 많았어요.",
  topicBreakdown: [
    { topic: "price", label: "가격", count: 7 },
    { topic: "review", label: "후기", count: 6 },
    { topic: "concern", label: "고민", count: 5 },
  ],
  highlights: [
    "드레스 투어는 피팅비와 헬퍼비를 따로 확인했다는 이야기가 많았어요.",
    "본식 스냅은 원본 제공 범위와 보정본 수를 먼저 비교하는 흐름이 있었어요.",
  ],
  questions: [
    { topic: "price", label: "가격", text: "스냅 원본 제공이면 보통 추가금이 붙나요?" },
    { topic: "concern", label: "고민", text: "드레스 투어를 몇 곳까지 가보는 게 적당할까요?" },
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

function getStatus(progress: Record<string, ProgressItem>, key: string): Status {
  const status = progress[key]?.status;
  if (status === "completed" || status === "in_progress" || status === "not_started") return status;
  return "not_started";
}

function getSpent(progress: Record<string, ProgressItem>) {
  return Object.entries(progress).reduce((sum, [key, item]) => {
    if (key.startsWith("__")) return sum;
    const amount = Number(item.spent ?? item.cost ?? 0);
    return Number.isFinite(amount) ? sum + amount : sum;
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
      const counts = getChecklistProgress(progress, category.key);
      acc[status] += 1;
      acc.done += counts.done;
      acc.total += counts.total;
      return acc;
    },
    { completed: 0, in_progress: 0, not_started: 0, done: 0, total: 0 }
  );
}

function getDdayLabel(dday: number | null) {
  if (dday === null) return "D-day 미정";
  if (dday > 0) return `D-${dday}`;
  if (dday === 0) return "D-day";
  return `D+${Math.abs(dday)}`;
}

function getUpcomingEvents(progress: Record<string, ProgressItem>): ScheduleEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getEvents(progress as Record<string, unknown>)
    .filter((event) => {
      const date = new Date(event.date);
      return !Number.isNaN(date.getTime()) && date >= today;
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
    eyebrow: plan.riskLabel,
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
  const { user, profile, partner, couple, journey, isDemo } = useAuthStore();
  const userId = user?.id ?? null;
  const [savedPosts, setSavedPosts] = useState<PostWithAuthor[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState(false);
  const [savedReloadKey, setSavedReloadKey] = useState(0);
  const [storedActions, setStoredActions] = useState<AmoraActionItem[]>([]);
  const [actionsLoadError, setActionsLoadError] = useState(false);
  const [actionsReloadKey, setActionsReloadKey] = useState(0);
  const [actionUpdatingId, setActionUpdatingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [cohortState, setCohortState] = useState<CohortState>({
    room: null,
    lastMessage: null,
    loading: true,
    digest: null,
    error: false,
  });
  const [cohortReloadKey, setCohortReloadKey] = useState(0);

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
  const partnerLabel = partner?.name ? `${partner.name}님과 함께` : couple ? "커플 연결 대기 중" : "커플 정보 없음";

  useEffect(() => {
    let cancelled = false;
    if (isDemo) {
      setSavedPosts(buildDemoSavedPosts());
      setSavedLoading(false);
      setSavedError(false);
      return;
    }
    if (!userId) {
      setSavedLoading(false);
      setSavedError(false);
      return;
    }

    setSavedLoading(true);
    setSavedError(false);
    fetch("/api/community/posts?bookmarked=true&limit=3", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { posts?: PostWithAuthor[] }) => {
        if (!cancelled) setSavedPosts((data.posts ?? []).slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) {
          setSavedPosts([]);
          setSavedError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSavedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemo, savedReloadKey, userId]);

  useEffect(() => {
    let cancelled = false;
    if (isDemo || !userId) {
      setStoredActions([]);
      setActionsLoadError(false);
      return;
    }

    setActionsLoadError(false);
    setActionNotice(null);
    fetch("/api/amora/actions?status=open&limit=8", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { actions?: AmoraActionItem[] }) => {
        if (!cancelled) {
          setStoredActions(data.actions ?? []);
          setActionsLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStoredActions([]);
          setActionsLoadError(true);
          setActionNotice("아모라가 기억한 할 일을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actionsReloadKey, isDemo, userId]);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) {
      setCohortState({
        room: DEMO_COHORT_ROOM,
        lastMessage: "스냅 원본 제공 범위는 계약서에 꼭 적어두자는 이야기가 나왔어요.",
        loading: false,
        digest: DEMO_DIGEST,
        error: false,
      });
      return;
    }
    if (!userId) {
      setCohortState({ room: null, lastMessage: null, loading: false, digest: null, error: false });
      return;
    }

    setCohortState((prev) => ({ ...prev, loading: true, error: false }));
    (async () => {
      try {
        const cohortRes = await fetch("/api/community/cohort", { cache: "no-store" });
        if (!cohortRes.ok) throw new Error("cohort");
        const cohortData = (await cohortRes.json()) as { room?: CohortRoom | null; lastMessage?: string | null };
        if (cancelled) return;

        let digest: CohortDigest | null = null;
        let digestFailed = false;
        if (cohortData.room?.id) {
          const digestRes = await fetch(
            `/api/community/cohort/${encodeURIComponent(cohortData.room.id)}/digest?period=week`,
            { cache: "no-store" }
          );
          if (digestRes.ok) {
            digest = (await digestRes.json()) as CohortDigest;
          } else {
            digestFailed = true;
          }
        }

        if (!cancelled) {
          setCohortState({
            room: cohortData.room ?? null,
            lastMessage: cohortData.lastMessage ?? null,
            loading: false,
            digest,
            error: digestFailed,
          });
        }
      } catch {
        if (!cancelled) {
          setCohortState({ room: null, lastMessage: null, loading: false, digest: null, error: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cohortReloadKey, isDemo, userId]);

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

  return (
    <div className="space-y-5 text-[#061a34]">
      <section className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
        <div className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_14px_36px_rgba(8,22,38,0.045)] md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
                <Sparkles className="h-4 w-4" />
                {plan.stageLabel}
              </p>
              <h1 className="mt-4 font-serif-kr text-[32px] font-medium leading-[1.18] text-[#061a34] md:text-[42px]">
                {profile?.name ? `${profile.name}님의 오늘 준비` : "오늘의 웨딩 준비"}
              </h1>
              <p className="mt-2 max-w-[560px] text-[14px] font-medium leading-[1.7] text-[#38475c]">
                {plan.stageSummary}
              </p>
            </div>
            <div className="min-w-[116px] rounded-[18px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-right">
              <p className="text-[11px] font-semibold text-[#9d6f36]">예식일</p>
              <p className="mt-1 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">
                {getDdayLabel(plan.dday)}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-[#5d6879]">{formatDate(journey?.wedding_date)}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            <MetricTile
              label="진행률"
              value={`${progressPercent}%`}
              note={`${summary.done}/${summary.total}개 체크`}
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <MetricTile
              label="예산 사용"
              value={`${budgetPercent}%`}
              note={`${formatWon(spentBudget)} / ${formatWon(totalBudget)}`}
              icon={<Wallet className="h-4 w-4" />}
            />
            <MetricTile
              label="커플 상태"
              value={partner ? "연결됨" : "대기"}
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
            <div
              className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-[12px] font-semibold text-white/80"
              role={actionsLoadError ? "alert" : "status"}
            >
              <p>{actionNotice}</p>
              {actionsLoadError && (
                <button
                  type="button"
                  onClick={() => setActionsReloadKey((key) => key + 1)}
                  className="mt-1 min-h-11 px-2 text-white underline underline-offset-2"
                >
                  할 일 다시 불러오기
                </button>
              )}
            </div>
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
        <SavedPostsPanel
          posts={savedPosts}
          loading={savedLoading}
          error={savedError}
          onRetry={() => setSavedReloadKey((key) => key + 1)}
        />
        <CohortPulsePanel
          cohort={cohortState}
          onRetry={() => setCohortReloadKey((key) => key + 1)}
        />
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
            body: "내 예식일, 예산, 진행 단계에 맞게 바꿉니다.",
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
      ? "마감 계산 전"
      : item.daysUntilDeadline < 0
        ? `${Math.abs(item.daysUntilDeadline)}일 지남`
        : `${item.daysUntilDeadline}일 남음`;

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
  const remaining = Math.max(0, totalBudget - spentBudget);
  const tone = totalBudget <= 0 ? "예산 미정" : budgetPercent >= 100 ? "초과" : budgetPercent >= 85 ? "주의" : "안정";

  return (
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">예산</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">지출 안전선</h2>
        </div>
        <span className="rounded-full bg-[#fff8ec] px-3 py-1 text-[12px] font-semibold text-[#36534E]">{tone}</span>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold text-[#7a8290]">남은 예산</p>
            <p className="mt-1 font-serif-kr text-[28px] font-medium leading-none text-[#071629]">{formatWon(remaining)}</p>
          </div>
          <p className="text-[13px] font-semibold text-[#36534E]">{budgetPercent}% 사용</p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-[#efe6d7]">
          <span className="block h-full rounded-full bg-[#36534E]" style={{ width: `${budgetWidth}%` }} />
        </span>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[#7a8290]">
          <span>{formatWon(spentBudget)} 사용</span>
          <span>총 {formatWon(totalBudget)}</span>
        </div>
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
            <p className="mt-1 text-[11px] font-medium leading-[1.5] text-[#7a8290]">상담, 투어, 피팅 날짜를 넣으면 여기서 먼저 보여드려요.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SavedPostsPanel({
  posts,
  loading,
  error,
  onRetry,
}: {
  posts: PostWithAuthor[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
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
        ) : error ? (
          <div className="rounded-[14px] border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-[13px] font-semibold text-red-800">저장한 글을 불러오지 못했어요.</p>
            <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg px-3 text-[12px] font-semibold text-red-700 underline underline-offset-2">
              다시 불러오기
            </button>
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

function CohortPulsePanel({ cohort, onRetry }: { cohort: CohortState; onRetry: () => void }) {
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
        ) : cohort.error && !cohort.room ? (
          <div className="rounded-[14px] border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-[13px] font-semibold text-red-800">동기방 소식을 불러오지 못했어요.</p>
            <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg px-3 text-[12px] font-semibold text-red-700 underline underline-offset-2">
              다시 불러오기
            </button>
          </div>
        ) : cohort.room ? (
          <div className="space-y-3">
            {cohort.error && (
              <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-[12px] font-medium text-amber-900" role="status">
                이번 주 요약 일부를 불러오지 못했어요.
                <button type="button" onClick={onRetry} className="ml-2 min-h-11 px-2 font-semibold underline underline-offset-2">
                  다시 불러오기
                </button>
              </div>
            )}
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
