"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { communityHtmlToPlainText, getJourneyProgressCounts } from "@hanbang/shared";
import {
  ArrowRight,
  Bookmark,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
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
import { getFinancialRecords } from "@/lib/amora/financialRecords";
import { buildAmoraLifecyclePlan, type AmoraGuardrailSeverity } from "@/lib/amora/lifecycle";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import { getChecklistCounts, mergeChecklist } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";
import type { PostWithAuthor } from "@/types/community.types";

type Status = ProgressItem["status"];

interface LoungePriority {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  tone: "urgent" | "watch" | "steady";
}

const STATUS_LABEL: Record<Status, string> = {
  not_started: "미정",
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

function getChecklistProgress(progress: Record<string, ProgressItem>, key: string) {
  const template = CATEGORY_CHECKLISTS.find((category) => category.key === key);
  const saved = progress[key]?.checklist;
  const status = getStatus(progress, key);
  if (!template) return { done: status === "completed" ? 1 : 0, total: 1 };
  const merged = mergeChecklist(template.items, saved, status);
  return getChecklistCounts(merged);
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

function buildPriorities(plan: ReturnType<typeof buildAmoraLifecyclePlan>, events: ScheduleEvent[]) {
  const primary: LoungePriority = {
    id: plan.primaryAction.id,
    eyebrow: plan.riskLabel,
    title: plan.primaryAction.title,
    body: plan.primaryAction.body,
    href: normalizeHref(plan.primaryAction.href),
    cta: plan.primaryAction.cta,
    tone: GUARDRAIL_TONE[plan.primaryAction.severity],
  };

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

  const merged: LoungePriority[] = [primary, ...(eventPriority ? [eventPriority] : [])];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.title}:${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 2);
}

function getActiveCategories(progress: Record<string, ProgressItem>) {
  return CATEGORY_CHECKLISTS.map((category) => {
    const counts = getChecklistProgress(progress, category.key);
    const status = getStatus(progress, category.key);
    const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    return { category, counts, status, percent };
  })
    .filter((item) => item.status === "in_progress")
    .slice(0, 6);
}

function buildDemoSavedPosts(): PostWithAuthor[] {
  const now = new Date().toISOString();
  return [
    {
      id: "demo-bookmark-1",
      author_id: "demo",
      viewer_is_author: false,
      category: "tips_v2",
      title: "계약 전 확인하면 좋은 체크포인트 정리",
      content: "기본 금액, 필수 추가금, 선택 옵션을 한 줄씩 분리해서 확인하면 나중에 비교하기 쉽습니다.",
      visibility: "public",
      ad_disclosure: "general",
      sponsorship_detail: null,
      is_resolved: false,
      under_review: false,
      upvote_count: 4,
      downvote_count: 0,
      comment_count: 2,
      view_count: 81,
      bookmark_count: 7,
      is_pinned: false,
      is_weekly_best: false,
      tags: ["계약", "체크리스트"],
      created_at: now,
      updated_at: now,
      author: {
        user_id: "demo",
        nickname: "웨딩한방 체크",
        avatar_url: null,
      },
      user_bookmarked: true,
    },
  ];
}

export default function LoungePage() {
  const { user, profile, partner, couple, journey, isDemo } = useAuthStore();
  const userId = user?.id ?? null;
  const [savedPosts, setSavedPosts] = useState<PostWithAuthor[]>([]);
  const [savedError, setSavedError] = useState(false);
  const [savedReloadKey, setSavedReloadKey] = useState(0);
  const [savedResolvedKey, setSavedResolvedKey] = useState<string | null>(null);
  const demoSavedPosts = useMemo(() => buildDemoSavedPosts(), []);
  const savedRequestKey = userId ? `${userId}:${savedReloadKey}` : null;
  const visibleSavedPosts = isDemo ? demoSavedPosts : userId ? savedPosts : [];
  const savedLoading = Boolean(!isDemo && savedRequestKey && savedResolvedKey !== savedRequestKey);
  const visibleSavedError = Boolean(
    !isDemo && savedRequestKey && savedResolvedKey === savedRequestKey && savedError,
  );

  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const financialRecords = useMemo(() => getFinancialRecords(progress), [progress]);
  const summary = useMemo(() => getJourneyProgressCounts(progress), [progress]);
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
  const priorities = useMemo(() => buildPriorities(plan, upcomingEvents), [plan, upcomingEvents]);
  const activeCategories = useMemo(() => getActiveCategories(progress), [progress]);
  const progressPercent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const partnerLabel = partner?.name ? `${partner.name}님과 함께` : couple ? "커플 연결 대기 중" : "커플 정보 없음";

  useEffect(() => {
    let cancelled = false;
    if (isDemo || !userId) return;

    fetch("/api/community/posts?bookmarked=true&limit=3", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { posts?: PostWithAuthor[] }) => {
        if (!cancelled) {
          setSavedPosts((data.posts ?? []).slice(0, 3));
          setSavedError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedPosts([]);
          setSavedError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSavedResolvedKey(`${userId}:${savedReloadKey}`);
      });

    return () => {
      cancelled = true;
    };
  }, [isDemo, savedReloadKey, userId]);

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
              label="시작한 항목 완료율"
              value={summary.total > 0 ? `${progressPercent}%` : "기록 없음"}
              note={summary.total > 0
                ? `${summary.done}/${summary.total}개 기록`
                : "시작하거나 완료한 체크만 계산"}
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <MetricTile
              label="계획 예산"
              value={totalBudget > 0 ? formatWon(totalBudget) : "미정"}
              note={financialRecords.categoryPlanTotal > 0
                ? `선택 항목 계획 합계 ${formatWon(financialRecords.categoryPlanTotal)}`
                : "사용자가 직접 입력한 계획만 표시"}
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
              <h2 className="mt-1 font-serif-kr text-[27px] font-medium leading-tight">현재 기록과 참고</h2>
            </div>
            <ShieldCheck className="h-6 w-6 text-[#ecd7a4]" />
          </div>
          <div className="mt-5 space-y-3">
            {priorities.map((item, index) => (
              <PriorityCard
                key={item.id}
                item={item}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>

      <WeeklyCard weddingDate={journey?.wedding_date} totalBudget={totalBudget} progress={progress} />

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">준비 흐름</p>
              <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">내가 시작한 체크리스트</h2>
              <p className="mt-1 text-[11px] font-medium text-[#7a8290]">직접 진행 중으로 표시한 항목만 보여요. 모든 준비 항목이 필수는 아닙니다.</p>
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
                <p className="mt-2 text-[14px] font-semibold text-[#263832]">아직 시작한 체크리스트가 없어요.</p>
                <p className="mt-1 text-[11px] font-medium text-[#607044]">필요한 항목만 골라 시작해도 됩니다.</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <BudgetPanel totalBudget={totalBudget} financialRecords={financialRecords} />
          <UpcomingEventsPanel events={upcomingEvents} />
        </div>
      </section>

      <section className="grid gap-4">
        <SavedPostsPanel
          posts={visibleSavedPosts}
          loading={savedLoading}
          error={visibleSavedError}
          onRetry={() => setSavedReloadKey((key) => key + 1)}
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
            body: "입력한 예식일·예산·진행 기록을 대화에 참고합니다.",
            href: weddingPath("/chat"),
          },
          {
            icon: ListChecks,
            title: "라운지에 남김",
            body: "직접 입력한 일정, 금액 기록, 체크리스트를 한곳에서 봅니다.",
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
}: {
  item: LoungePriority;
  index: number;
}) {
  const tone =
    item.tone === "urgent"
      ? "border-[#f3c2ad] bg-[#fff5ef]"
      : item.tone === "watch"
        ? "border-[#eadfc9] bg-[#fff8ec]"
        : "border-white/10 bg-white/[0.08]";
  const textTone = item.tone === "steady" ? "text-white" : "text-[#263832]";
  const subTone = item.tone === "steady" ? "text-white/70" : "text-[#635b51]";

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
    </div>
  );
}

function CategoryRow({
  item,
}: {
  item: ReturnType<typeof getActiveCategories>[number];
}) {
  return (
    <Link
      {...weddingLinkProps("/schedule")}
      className="group rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-3.5 hover:border-[#d8bb86] hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#071629]">{item.category.label}</p>
          <p className="mt-1 text-[11px] font-medium text-[#7a8290]">일반 순서 참고 · {item.counts.done}/{item.counts.total} 체크</p>
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
  financialRecords,
}: {
  totalBudget: number;
  financialRecords: ReturnType<typeof getFinancialRecords>;
}) {
  const hasTotalBudget = totalBudget > 0;
  const needsRecordCheck = hasTotalBudget && financialRecords.contractedTotal > totalBudget;
  const records = [
    {
      label: "계획 예산",
      value: hasTotalBudget ? formatWon(totalBudget) : "미정",
      note: financialRecords.categoryPlanTotal > 0
        ? `선택 항목 계획 합계 ${formatWon(financialRecords.categoryPlanTotal)}`
        : "사용자가 직접 입력한 전체 계획",
    },
    {
      label: "서명한 계약 총액",
      value: formatWon(financialRecords.contractedTotal),
      note: "계약서 원문을 보고 직접 기록한 합계",
    },
    {
      label: "누적 납부액",
      value: formatWon(financialRecords.paidToDate),
      note: "실제로 납부했다고 직접 기록한 합계",
    },
  ];

  return (
    <section className="rounded-[22px] border border-[#eadfc9] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[#9d6f36]">예산</p>
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">예산 기록</h2>
        </div>
        <span className="rounded-full bg-[#fff8ec] px-3 py-1 text-[12px] font-semibold text-[#36534E]">
          {needsRecordCheck ? "입력값 확인" : "서로 다른 기록"}
        </span>
      </div>
      <div className="mt-4 space-y-2.5">
        {records.map((record) => (
          <div key={record.label} className="rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-[#5d6879]">{record.label}</p>
              <p className="font-serif-kr text-[20px] font-medium text-[#071629]">{record.value}</p>
            </div>
            <p className="mt-1 text-[11px] font-medium leading-relaxed text-[#7a8290]">{record.note}</p>
          </div>
        ))}
      </div>
      {needsRecordCheck ? (
        <p className="mt-3 rounded-[12px] border border-[#eadfc9] bg-[#fff8ec] px-3 py-2.5 text-[11px] font-medium leading-relaxed text-[#6d6254]">
          계획 예산보다 서명한 계약 총액 기록이 큽니다. 계약의 적정성 판단이 아니라 중복 입력과 금액 단위를 확인하는 안내예요.
        </p>
      ) : null}
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
          <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">다가오는 내 일정</h2>
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
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-[1.55] text-[#5d6879]">{communityHtmlToPlainText(post.content)}</p>
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
