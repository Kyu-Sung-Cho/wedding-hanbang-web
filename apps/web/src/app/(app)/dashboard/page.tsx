"use client";

import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import {
  MessageCircle,
  Wallet,
  CalendarCheck,
  TrendingUp,
  Clock,
  ArrowRight,
  Copy,
  Check,
  ChevronRight,
  AlertCircle,
  Users,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Package,
  Plane,
  Home,
  Key,
  Mail,
  Video,
  Sparkles,
  Flower,
  Gift,
  Mic,
  Box,
  Heart,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { CHECKLIST_MAP, CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { CategoryChecklistTemplate } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import ServiceGuide from "@/components/app/ServiceGuide";
import ServiceDashboardTutorial from "@/components/app/ServiceDashboardTutorial";
import {
  buildAmoraLifecyclePlan,
  type AmoraActionIconKey,
  type AmoraGuardrailSeverity,
  type AmoraRiskLevel,
} from "@/lib/amora/lifecycle";
import {
  getOpenAmoraActions,
  withUpdatedAmoraAction,
  getActionPriorityLabel,
  type AmoraActionItem,
} from "@/lib/amora/actions";

// 카테고리 아이콘 매핑
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  meeting: Users,
  venue: Building2,
  studio: Camera,
  dress: Shirt,
  makeup: Palette,
  ring: Gem,
  hanbok: Flower2,
  yedan: Package,
  honeymoon: Plane,
  houseware: Home,
  housing: Key,
  invitation: Mail,
  snap: Video,
  shoes: Sparkles,
  bouquet: Flower,
  gift: Gift,
  mc: Mic,
  ham: Box,
  pyebaek: Heart,
};

// 긴급도 레벨 타입
interface UrgentTask {
  key: string;
  label: string;
  ddayDeadline: number;
  daysUntilDeadline: number;
  urgency: "overdue" | "soon" | "relaxed";
  urgencyLabel: string;
  urgencyColor: string;
  urgencyBg: string;
  urgencyBorder: string;
  deadlineText: string;
}

// 긴급 태스크 계산 함수
function getUrgentTasks(
  dday: number | null,
  progress: Record<string, { status?: string; checklist?: { id: string; label: string; done: boolean }[] }>,
  templates: CategoryChecklistTemplate[]
): UrgentTask[] {
  if (dday === null || dday <= 0) return [];

  const tasks: UrgentTask[] = [];

  for (const tpl of templates) {
    const item = progress[tpl.key];
    const status = item?.status ?? "not_started";
    if (status === "completed") continue;

    const daysUntilDeadline = dday - tpl.ddayDeadline;
    let urgency: UrgentTask["urgency"];
    let urgencyLabel: string;
    let urgencyColor: string;
    let urgencyBg: string;
    let urgencyBorder: string;

    if (daysUntilDeadline < 0) {
      urgency = "overdue";
      urgencyLabel = "지금 바로";
      urgencyColor = "text-red-600";
      urgencyBg = "bg-red-50";
      urgencyBorder = "border-red-200";
    } else if (daysUntilDeadline <= 14) {
      urgency = "soon";
      urgencyLabel = "2주 내";
      urgencyColor = "text-amber-600";
      urgencyBg = "bg-amber-50";
      urgencyBorder = "border-amber-200";
    } else {
      urgency = "relaxed";
      urgencyLabel = "여유 있음";
      urgencyColor = "text-emerald-600";
      urgencyBg = "bg-emerald-50";
      urgencyBorder = "border-emerald-200";
    }

    tasks.push({
      key: tpl.key,
      label: tpl.label,
      ddayDeadline: tpl.ddayDeadline,
      daysUntilDeadline,
      urgency,
      urgencyLabel,
      urgencyColor,
      urgencyBg,
      urgencyBorder,
      deadlineText: `D-${tpl.ddayDeadline}일 전까지 권장`,
    });
  }

  // 긴급한 순서로 정렬: overdue > soon > relaxed, 같은 urgency면 daysUntilDeadline 오름차순
  const urgencyOrder = { overdue: 0, soon: 1, relaxed: 2 };
  tasks.sort((a, b) => {
    const orderDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (orderDiff !== 0) return orderDiff;
    return a.daysUntilDeadline - b.daysUntilDeadline;
  });

  return tasks.slice(0, 3);
}

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례",
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스/턱시도",
  makeup: "메이크업",
  ring: "예물(반지)",
  hanbok: "한복",
  yedan: "예단",
  honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)",
  housing: "신혼집",
  invitation: "청첩장",
  snap: "본식스냅/영상",
  shoes: "웨딩구두",
  bouquet: "부케/꽃장식",
  gift: "답례품",
  mc: "사회/축가",
  ham: "함",
  pyebaek: "폐백",
};

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  completed: { label: "완료", color: "bg-sage-500" },
  in_progress: { label: "진행중", color: "bg-[#795252]" },
  not_started: { label: "예정", color: "bg-[#B5ADA3]" },
};

const AMORA_ACTION_ICONS: Record<AmoraActionIconKey, React.ComponentType<{ className?: string }>> = {
  calendar: CalendarCheck,
  wallet: Wallet,
  quote: AlertCircle,
  schedule: Clock,
  chat: MessageCircle,
  invitation: Mail,
  script: Mic,
  money: Gift,
  community: Users,
};

const GUARDRAIL_TONES: Record<AmoraGuardrailSeverity, string> = {
  critical: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-700",
  steady: "bg-[#eef2df] text-[#5a6147]",
  celebrate: "bg-[#f3e7e1] text-[#795252]",
};

const RISK_STYLES: Record<AmoraRiskLevel, { badge: string; bar: string; text: string }> = {
  urgent: {
    badge: "bg-red-50 text-red-600 border-red-100",
    bar: "bg-red-500",
    text: "text-red-600",
  },
  watch: {
    badge: "bg-amber-50 text-amber-700 border-amber-100",
    bar: "bg-amber-500",
    text: "text-amber-700",
  },
  calm: {
    badge: "bg-[#eef2df] text-[#5a6147] border-[#dfe6cf]",
    bar: "bg-[#8c9566]",
    text: "text-[#5a6147]",
  },
};

function formatActionDueDate(action: AmoraActionItem) {
  if (!action.dueDate) return "마감 미정";
  const due = new Date(`${action.dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return action.dueDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}일 지남`;
  if (days === 0) return "오늘까지";
  if (days === 1) return "내일까지";
  return `${days}일 남음`;
}

export default function DashboardPage() {
  const { partner, journey, couple, updateJourney } = useAuthStore();
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 카테고리 상태 변경
  const handleStatusChange = async (key: string, newStatus: "not_started" | "in_progress" | "completed") => {
    const currentProgress = { ...(journey?.progress ?? {}) };
    const existing = currentProgress[key];
    currentProgress[key] = {
      ...existing,
      category: key,
      status: newStatus,
    };
    await updateJourney({ progress: currentProgress });
  };

  // 커플 코드 불러오기
  useEffect(() => {
    if (couple && !partner) {
      fetch("/api/couple/code")
        .then((r) => r.json())
        .then((d) => { if (d.inviteCode) setInviteCode(d.inviteCode); })
        .catch(() => {});
    }
  }, [couple, partner]);

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // D-day 계산
  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;
  const today = new Date();
  const dday = weddingDate
    ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // 진행률 계산 (아모라 라이프사이클 엔진 기준 — 대시보드/알림/채팅이 같은 판단을 씀)
  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const amoraPlan = useMemo(
    () => buildAmoraLifecyclePlan({
      weddingDate: journey?.wedding_date ?? null,
      venue: journey?.venue ?? null,
      totalBudget,
      progress,
    }),
    [journey?.wedding_date, journey?.venue, totalBudget, progress]
  );
  const { totalDone, totalItems, progressPercent, spentBudget, budgetPercent } = amoraPlan;
  const formatBudget = (amount: number) =>
    amount >= 10000
      ? `₩${(amount / 10000).toLocaleString()}만`
      : `₩${amount.toLocaleString()}`;

  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";

  // 긴급 태스크 계산
  const urgentTasks = useMemo(
    () => getUrgentTasks(dday, progress as Record<string, { status?: string; checklist?: { id: string; label: string; done: boolean }[] }>, CATEGORY_CHECKLISTS),
    [dday, progress]
  );

  // 다음 주요 마일스톤 (가장 긴급한 태스크)
  const nextMilestone = urgentTasks[0];

  // 다가오는 예약/일정 이벤트 — progress.__events 에서 향후 60일 이내 정렬
  // 예약(create_booking 자동 sync)이 여기에 자동 등록됨.
  const upcomingEvents = useMemo(() => {
    const events = getEvents(progress as Record<string, unknown>);
    const todayStr = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const horizonStr = horizon.toISOString().slice(0, 10);
    return events
      .filter((e) => e.date >= todayStr && e.date <= horizonStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
  }, [progress]);

  // 커플 활동 피드 (파트너의 진행 상태 변경 기반)
  const partnerActivities = useMemo(() => {
    if (!partner) return [];

    const activities: { key: string; label: string; status: string; statusLabel: string }[] = [];
    for (const [key, item] of Object.entries(progress)) {
      if (key.startsWith("__")) continue;
      const catItem = item as { status?: string };
      if (!catItem?.status || catItem.status === "not_started") continue;
      const label = CATEGORY_LABELS[key];
      if (!label) continue;
      const statusLabel = catItem.status === "completed" ? "완료" : "진행중";
      activities.push({ key, label, status: catItem.status, statusLabel });
    }

    return activities.slice(0, 3);
  }, [partner, progress]);

  // D-day 표시 값
  const ddayDisplay =
    dday !== null && dday > 0
      ? dday
      : dday === 0
        ? "D"
        : dday !== null && dday < 0
          ? `+${Math.abs(dday)}`
          : "—";
  const ddayLabel =
    dday !== null && dday > 0
      ? "일 남았어요"
      : dday === 0
        ? "오늘이에요"
        : dday !== null && dday < 0
          ? "일 지났어요"
          : "날짜 미정";

  const briefingItems = useMemo(
    () => amoraPlan.guardrails.slice(0, 3).map((item) => ({
      ...item,
      text: item.body,
      icon: AMORA_ACTION_ICONS[item.iconKey],
      tone: GUARDRAIL_TONES[item.severity],
    })),
    [amoraPlan]
  );

  const lifecycleActions = useMemo(
    () => amoraPlan.quickActions.map((item) => ({
      ...item,
      icon: AMORA_ACTION_ICONS[item.iconKey],
    })),
    [amoraPlan]
  );

  const riskStyle = RISK_STYLES[amoraPlan.riskLevel];
  const amoraActions = useMemo(() => getOpenAmoraActions(progress).slice(0, 5), [progress]);

  const handleActionStatusChange = async (actionId: string, status: "done" | "dismissed") => {
    const nextProgress = withUpdatedAmoraAction(progress, actionId, { status });
    await updateJourney({ progress: nextProgress as unknown as typeof progress });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-10 bg-[#fbf8f4]">
      {/* 파트너 미연동 안내 */}
      {couple && !partner && inviteCode && (
        <div className="bg-white rounded-2xl p-6 mb-8 flex items-center justify-between max-md:flex-col max-md:gap-3 animate-fade-in shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div>
            <p className="text-[1.0625rem] font-medium text-[#1b1c1c]">
              파트너에게 초대 코드를 공유하세요
            </p>
            <p className="text-base text-[#504444] mt-1">
              파트너가 회원가입 시 이 코드를 입력하면 커플 연동됩니다
            </p>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-2 px-6 py-3 bg-[#f6f3f2] rounded-xl hover:shadow-md transition-all"
          >
            <span className="font-mono text-lg font-bold text-[#1b1c1c] tracking-wider">
              {inviteCode}
            </span>
            {copied ? (
              <Check className="w-5 h-5 text-sage-500" />
            ) : (
              <Copy className="w-5 h-5 text-[#504444]" />
            )}
          </button>
        </div>
      )}

      {/* 1. 웨딩 지휘실 히어로 */}
      <section
        data-tutorial-target="dashboard-hero"
        className="mb-6 animate-fade-in overflow-hidden rounded-2xl border border-[#e8ded7] bg-[#fffdf9] shadow-[0_12px_40px_rgba(80,68,68,0.06)]"
      >
        <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="p-5 sm:p-6 lg:p-7">
            <p className="mb-4 text-xs font-semibold tracking-[0.24em] text-[#8a5f5b] uppercase">
              Wedding command room
            </p>
            <h1 className="font-serif-kr text-[1.75rem] leading-tight text-[#1b1c1c] sm:text-[2.25rem] lg:text-[2.75rem]">
              오늘도 실수 없이,
              <br />
              우리다운 결혼식으로.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#504444] sm:text-[0.9375rem] sm:leading-7">
              아모라가 일정, 예산, 견적, 청첩장, 식후 감사 인사까지 이어서 챙겨요.
              지금 화면만 봐도 다음 행동이 보이도록 정리해둘게요.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/chat"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#795252] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(121,82,82,0.18)] transition-colors hover:bg-[#946a6a]"
              >
                <Sparkles className="h-4 w-4" />
                아모라에게 오늘 할 일 묻기
              </Link>
              <Link
                href="/community/quote-check"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9c8c8] bg-white px-5 py-3 text-sm font-semibold text-[#795252] transition-colors hover:bg-[#f7f0ed]"
              >
                <AlertCircle className="h-4 w-4" />
                견적 먼저 점검
              </Link>
            </div>
          </div>

          <div className="border-t border-[#eee5de] bg-[#f7efe8] p-5 sm:p-6 lg:border-l lg:border-t-0">
            <div className="grid h-full gap-3">
              <div className="rounded-xl border border-white/70 bg-white/80 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.2em] text-[#928980] uppercase">The date</p>
                    <p className="mt-2 font-serif-kr text-3xl text-[#795252] sm:text-4xl">
                      {dday !== null ? `D${dday > 0 ? `-${dday}` : dday === 0 ? "-day" : ddayDisplay}` : "D-day"}
                    </p>
                  </div>
                  <CalendarCheck className="h-8 w-8 text-[#8c9566]" />
                </div>
                <p className="mt-3 text-sm text-[#504444]">{dateStr}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/70 bg-white/75 p-4">
                  <p className="text-xs font-medium text-[#928980]">준비 진행</p>
                  <p className="mt-2 font-serif-kr text-2xl text-[#1b1c1c]">{progressPercent}%</p>
                  <p className="mt-1 text-xs text-[#504444]">{totalDone}/{totalItems}개 체크</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/75 p-4">
                  <p className="text-xs font-medium text-[#928980]">아모라 안전도</p>
                  <p className={`mt-2 text-lg font-semibold ${riskStyle.text}`}>{amoraPlan.riskLabel}</p>
                  <p className="mt-1 text-xs text-[#504444]">{amoraPlan.riskScore}점 점검</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 오늘의 아모라 브리핑 */}
      <section
        data-tutorial-target="dashboard-briefing"
        className="mb-6 grid gap-4 animate-fade-in lg:grid-cols-[1.25fr_0.75fr]"
      >
        <div className="rounded-2xl border border-[#e8ded7] bg-white p-5 shadow-[0_8px_30px_rgba(80,68,68,0.04)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-[#795252] uppercase">Amora briefing</p>
              <h2 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">오늘 놓치지 않을 것</h2>
            </div>
            <Link href="/chat" className="hidden rounded-lg bg-[#f6f1ee] px-3 py-2 text-sm font-medium text-[#795252] hover:bg-[#eee3dd] sm:inline-flex">
              상담 열기
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {briefingItems.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="group flex min-h-[150px] flex-col rounded-xl border border-[#efe6df] bg-[#fffdfb] p-4 transition-colors hover:bg-[#faf4ef]"
              >
                <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${item.tone}`}>
                  <item.icon className="h-5 w-5" />
                </span>
                <p className="text-[0.9375rem] font-semibold leading-snug text-[#1b1c1c]">{item.title}</p>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[#504444]">{item.text}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#795252]">
                  {item.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#dfe6cf] bg-[#f7faef] p-5 shadow-[0_8px_30px_rgba(80,68,68,0.04)] sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-[#667049] uppercase">Amora guardrails</p>
              <h2 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">실수 방지 점검</h2>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${riskStyle.badge}`}>
              {amoraPlan.riskLabel}
            </span>
          </div>
          <div className="mt-4 rounded-xl bg-white/80 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[#1b1c1c]">{amoraPlan.stageLabel}</span>
              <span className="text-sm font-semibold text-[#504444]">{amoraPlan.riskScore}/100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#ece7df]">
              <div
                className={`h-full rounded-full transition-all duration-700 ${riskStyle.bar}`}
                style={{ width: `${Math.max(8, Math.min(amoraPlan.riskScore, 100))}%` }}
              />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#504444]">{amoraPlan.stageSummary}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {amoraPlan.phases.map((phase) => (
              <div key={phase.id} className="rounded-xl bg-white/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#504444]">{phase.label}</span>
                  <span className={`h-2 w-2 rounded-full ${
                    phase.state === "done"
                      ? "bg-[#8c9566]"
                      : phase.state === "active"
                        ? "bg-[#795252]"
                        : "bg-[#d8cec8]"
                  }`} />
                </div>
                <p className="mt-2 font-serif-kr text-xl text-[#1b1c1c]">{phase.percent}%</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2">
            {lifecycleActions.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-xl bg-white/80 px-3 py-3 transition-colors hover:bg-white"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#795252]/10 text-[#795252]">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#1b1c1c]">{item.label}</span>
                  <span className="block truncate text-xs text-[#504444]">{item.text}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-[#928980]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 아모라 행동 카드 */}
      <section
        data-tutorial-target="dashboard-actions"
        className="mb-6 animate-fade-in rounded-2xl border border-[#e8ded7] bg-white p-5 shadow-[0_8px_30px_rgba(80,68,68,0.04)] sm:p-6"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[#795252] uppercase">Amora action memory</p>
            <h2 className="mt-1 font-serif-kr text-xl text-[#1b1c1c]">아모라가 기억하는 다음 행동</h2>
          </div>
          <Link
            href="/chat"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#f6f1ee] px-3 py-2 text-sm font-semibold text-[#795252] transition-colors hover:bg-[#eee3dd]"
          >
            <Sparkles className="h-4 w-4" />
            새 행동 저장
          </Link>
        </div>

        {amoraActions.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-5">
            {amoraActions.map((action) => (
              <div
                key={action.id}
                className="flex min-h-[166px] flex-col rounded-xl border border-[#eee6e0] bg-[#fffdfb] p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    action.priority === "high"
                      ? "bg-red-50 text-red-600"
                      : action.priority === "low"
                        ? "bg-[#eef2df] text-[#5a6147]"
                        : "bg-[#f3e7e1] text-[#795252]"
                  }`}>
                    {getActionPriorityLabel(action.priority)}
                  </span>
                  <span className="text-xs text-[#928980]">{formatActionDueDate(action)}</span>
                </div>

                <Link href={action.href ?? "/dashboard"} className="group min-w-0">
                  <p className="text-[0.9375rem] font-semibold leading-snug text-[#1b1c1c] group-hover:text-[#795252]">
                    {action.title}
                  </p>
                  {action.description && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#504444]">
                      {action.description}
                    </p>
                  )}
                </Link>

                <div className="mt-auto flex items-center gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => void handleActionStatusChange(action.id, "done")}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#795252] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#946a6a]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    완료
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleActionStatusChange(action.id, "dismissed")}
                    className="rounded-lg border border-[#e4d8d1] px-3 py-2 text-xs font-semibold text-[#928980] transition-colors hover:bg-[#f8f4f1] hover:text-[#504444]"
                  >
                    숨김
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#ddd1ca] bg-[#fffdfb] px-5 py-6 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-[#795252]" />
            <p className="mt-3 text-[0.9375rem] font-semibold text-[#1b1c1c]">
              아직 저장된 행동은 없어요
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#504444]">
              채팅에서 &ldquo;이거 다음 할 일로 저장해줘&rdquo;라고 말하면 아모라가 여기 계속 기억해둘게요.
            </p>
          </div>
        )}
      </section>

      {/* 4. D-day + Budget Overview (2-column) */}
      <div
        data-tutorial-target="dashboard-dday-budget"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mb-6 animate-fade-in"
      >
        {/* D-day 카드 */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 lg:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-center min-h-[200px] sm:min-h-[240px] relative overflow-hidden">
          {/* 장식 스파클 */}
          <Sparkles className="absolute top-5 right-5 w-6 h-6 text-[#C9A96E]/30" />
          <Sparkles className="absolute bottom-6 left-6 w-5 h-5 text-[#C9A96E]/15" />

          <p className="text-xs text-[#795252] tracking-[0.25em] uppercase mb-3 font-medium">
            The Big Day
          </p>
          <p className="font-serif-kr text-5xl sm:text-6xl lg:text-7xl leading-none text-[#795252] mb-2 font-light">
            {ddayDisplay}
          </p>
          <p className="headline-italic text-lg sm:text-xl text-[#504444] mb-3 sm:mb-4">
            {ddayLabel}
          </p>
          <p className="text-sm text-[#504444]">
            {dateStr}
          </p>
        </div>

        {/* Budget Overview */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 lg:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-start justify-between mb-4 sm:mb-5">
            <div className="min-w-0">
              <h2 className="font-serif-kr text-lg sm:text-xl text-[#1b1c1c] mb-1 font-light">예산 현황</h2>
              <p className="text-sm text-[#504444]">소중한 투자를 관리해요</p>
            </div>
            <Link href="/budget" className="text-[#504444] hover:text-[#795252] transition-colors flex-shrink-0">
              <MoreHorizontal className="w-5 h-5" />
            </Link>
          </div>

          <div className="flex justify-between items-end gap-3 mb-6">
            <div className="min-w-0">
              <p className="font-serif-kr text-2xl sm:text-3xl text-[#1b1c1c] font-light mb-1 break-words">
                {formatBudget(spentBudget)}
              </p>
              <p className="text-sm text-[#504444]">사용한 금액</p>
            </div>
            <div className="text-right min-w-0">
              <p className="font-serif-kr text-2xl sm:text-3xl text-[#1b1c1c] font-light mb-1 break-words">
                {formatBudget(totalBudget)}
              </p>
              <p className="text-sm text-[#504444]">전체 예산</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-[#f6f3f2] rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-700"
              style={{ width: `${Math.min(budgetPercent, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#504444]">진행률 {progressPercent}%</p>
            <p className="text-sm text-[#504444]">{budgetPercent}% 배분됨</p>
          </div>
        </div>
      </div>

      {/* 3. Bottom Row: Milestone + Quick Actions (2/3) + Spotlight (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 mb-6 animate-fade-in">
        {/* 다가오는 일정 + 빠른 실행 — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 sm:p-6 lg:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          {/* 다가오는 일정 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif-kr text-lg sm:text-xl text-[#1b1c1c] font-light">다가오는 일정</h3>
              <Link
                href="/schedule?new=1"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-[#795252] bg-[#795252]/8 hover:bg-[#795252]/15 transition-colors"
                aria-label="일정 추가"
              >
                <Plus className="w-4 h-4" />
                일정 추가
              </Link>
            </div>

            {/* 예약/일정 이벤트 (있으면 우선 노출 — create_booking 자동 sync 결과) */}
            {upcomingEvents.length > 0 && (
              <div className="mb-3 space-y-2">
                {upcomingEvents.map((ev) => {
                  const evDate = new Date(ev.date);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const daysUntil = Math.round((evDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const dateLabel = `${evDate.getMonth() + 1}/${evDate.getDate()} (${["일","월","화","수","목","금","토"][evDate.getDay()]})`;
                  return (
                    <Link
                      key={ev.id}
                      href="/schedule"
                      className="flex items-center gap-4 p-4 rounded-xl bg-[#fcf9f8] hover:bg-[#f6f3f2] transition-colors group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[#795252]/10 flex items-center justify-center shrink-0">
                        <CalendarCheck className="w-6 h-6 text-[#795252]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base text-[#1b1c1c] font-medium truncate">{ev.title}</p>
                        <p className="text-sm text-[#504444]">{dateLabel} · {daysUntil === 0 ? "오늘" : daysUntil === 1 ? "내일" : `${daysUntil}일 뒤`}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[#B5ADA3] group-hover:translate-x-1 transition-transform shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}

            {nextMilestone ? (
              <button
                onClick={() => setSelectedCategory(nextMilestone.key)}
                className="w-full flex items-center gap-5 p-5 rounded-xl hover:bg-[#f6f3f2] transition-colors group text-left"
              >
                <div className="w-14 h-14 rounded-xl bg-[#dee6c4]/40 flex items-center justify-center shrink-0">
                  {(() => {
                    const IconComp = CATEGORY_ICONS[nextMilestone.key] ?? CalendarCheck;
                    return <IconComp className="w-7 h-7 text-sage-500" />;
                  })()}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-serif-kr text-[#1b1c1c] mb-1 font-light">{nextMilestone.label}</p>
                  <p className="text-base text-[#504444]">{nextMilestone.deadlineText}</p>
                  <span className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-[#795252]/10 text-[#795252] text-sm font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {nextMilestone.urgency === "overdue"
                      ? "지금 바로"
                      : nextMilestone.daysUntilDeadline <= 14
                        ? `${nextMilestone.daysUntilDeadline}일 뒤`
                        : "여유 있음"}
                  </span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#504444] group-hover:translate-x-1 transition-transform" />
              </button>
            ) : upcomingEvents.length === 0 ? (
              <div className="flex items-center gap-5 p-5 rounded-xl bg-[#f6f3f2]">
                <div className="w-14 h-14 rounded-xl bg-[#dee6c4]/40 flex items-center justify-center shrink-0">
                  <Check className="w-7 h-7 text-sage-500" />
                </div>
                <div className="flex-1">
                  <p className="text-lg font-serif-kr text-[#1b1c1c] mb-1 font-light">모두 순조로워요</p>
                  <p className="text-base text-[#504444]">현재 급한 일정은 없어요</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* 빠른 실행 */}
          <div>
            <h3 className="font-serif-kr text-lg sm:text-xl text-[#1b1c1c] mb-4 font-light">빠른 실행</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link
                href="/chat"
                className="group flex items-center justify-between p-5 rounded-xl bg-[#f6f3f2] hover:bg-[#e4e2e1] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-[#795252]" />
                  <span className="text-lg font-medium text-[#1b1c1c]">AI 아모라 상담</span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#504444] group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/community"
                className="group flex items-center justify-between p-5 rounded-xl bg-[#f6f3f2] hover:bg-[#e4e2e1] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MessageCircle className="w-5 h-5 text-[#795252]" />
                  <span className="text-lg font-medium text-[#1b1c1c]">커뮤니티 글</span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#504444] group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        </div>

        {/* Spotlight — 커뮤니티 (이번 분기 핵심 채널) */}
        <Link
          href="/community"
          className="group block min-h-[320px] overflow-hidden rounded-2xl border border-[#e8ded7] bg-white shadow-[0_8px_30px_rgba(80,68,68,0.04)] transition-colors hover:bg-[#fffdfb]"
        >
          <div className="flex h-full min-h-[320px] flex-col p-6 sm:p-8">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.22em] uppercase text-[#795252]">
                  Real wedding room
                </p>
                <h3 className="mt-2 font-serif-kr text-xl font-light text-[#1b1c1c] sm:text-2xl">
                  웨딩 커뮤니티
                </h3>
              </div>
              <MessageCircle className="h-7 w-7 text-[#8c9566]" />
            </div>
            <p className="text-[0.9375rem] leading-7 text-[#504444]">
              가격표보다 중요한 건 실제 예비부부의 질문과 계약 전 확인이에요.
              견적, 업체 응대, 가족 고민을 혼자 판단하지 않도록 모아둘게요.
            </p>
            <div className="mt-6 space-y-3">
              {["견적이 정상인지 묻기", "업체 답변 같이 해석하기", "결혼 끝난 선배 후기 보기"].map((text, idx) => (
                <div key={text} className="flex items-center gap-3 rounded-xl bg-[#f8f4f1] px-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#795252]">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-[#1b1c1c]">{text}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto pt-6">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[#795252]">
                둘러보기
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* 4. 지금 해야 할 것 + 커플 활동 */}
      {(urgentTasks.length > 0 || partnerActivities.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5 mb-6 animate-fade-in">
          {/* 지금 해야 할 것 */}
          {urgentTasks.length > 0 && (
            <div className={`${partnerActivities.length > 0 ? "lg:col-span-3" : "lg:col-span-5"} bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]`}>
              <div className="flex items-center gap-2 mb-5">
                <AlertCircle className="w-5 h-5 text-[#795252]" />
                <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">지금 해야 할 것</h3>
              </div>
              <div className="flex flex-col gap-3">
                {urgentTasks.map((task) => {
                  const IconComp = CATEGORY_ICONS[task.key] ?? CalendarCheck;
                  return (
                    <div
                      key={task.key}
                      onClick={() => setSelectedCategory(task.key)}
                      className={`flex items-center gap-4 px-5 py-4 rounded-xl cursor-pointer hover:shadow-sm transition-all ${task.urgencyBg}`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        task.urgency === "overdue"
                          ? "bg-red-100"
                          : task.urgency === "soon"
                            ? "bg-amber-100"
                            : "bg-emerald-100"
                      }`}>
                        <IconComp className={`w-6 h-6 ${task.urgencyColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[1.0625rem] font-medium text-[#1b1c1c]">{task.label}</span>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${task.urgencyColor} ${
                            task.urgency === "overdue"
                              ? "bg-red-100"
                              : task.urgency === "soon"
                                ? "bg-amber-100"
                                : "bg-emerald-100"
                          }`}>
                            {task.urgencyLabel}
                          </span>
                        </div>
                        <p className="text-sm text-[#504444] mt-1">{task.deadlineText}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#504444] flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 커플 활동 */}
          {partnerActivities.length > 0 && (
            <div className={`${urgentTasks.length > 0 ? "lg:col-span-2" : "lg:col-span-5"} bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]`}>
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-5 h-5 text-[#795252]" />
                <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">커플 활동</h3>
              </div>
              <div className="flex flex-col gap-2">
                {partnerActivities.map((activity) => {
                  const IconComp = CATEGORY_ICONS[activity.key] ?? CalendarCheck;
                  return (
                    <div
                      key={activity.key}
                      className="flex items-start gap-3 px-4 py-4 rounded-xl bg-[#f6f3f2]"
                    >
                      <div className="w-10 h-10 rounded-lg bg-[#795252]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <IconComp className="w-5 h-5 text-[#795252]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base text-[#1b1c1c] font-light leading-snug">
                          <span className="font-medium">{partner?.name ?? "파트너"}</span>
                          {activity.status === "completed"
                            ? <span>가 <span className="font-medium text-sage-500">{activity.label}</span>을 <span className="text-sage-500 font-medium">완료</span>했어요</span>
                            : <span>가 <span className="font-medium text-[#795252]">{activity.label}</span>을 <span className="text-[#795252] font-medium">진행중</span>으로 변경했어요</span>
                          }
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock className="w-4 h-4 text-[#504444]" />
                          <span className="text-sm text-[#504444]">최근 활동</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. 카테고리별 진행 상태 + 시작 가이드 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5 animate-fade-in">
        {/* 카테고리 현황 */}
        <div
          data-tutorial-target="dashboard-categories"
          className="lg:col-span-3 bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        >
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="min-w-0">
              <p className="text-sm tracking-[0.2em] uppercase text-[#795252] font-medium mb-1">
                Progress
              </p>
              <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">카테고리별 진행 상태</h3>
            </div>
            <Link href="/schedule" className="text-sm sm:text-base text-[#795252] font-medium flex items-center gap-1 hover:gap-2 transition-all flex-shrink-0 whitespace-nowrap">
              전체 보기 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
              const item = progress[key] as { status: string; checklist?: { id: string; label: string; done: boolean }[] } | undefined;
              const status = item?.status ?? "not_started";
              const template = CHECKLIST_MAP[key];
              const merged = template ? mergeChecklist(template.items, item?.checklist, status as "not_started" | "in_progress" | "completed") : [];
              const { done, total } = getChecklistCounts(merged);
              return (
                <div
                  key={key}
                  className={`rounded-xl transition-all ${
                    status === "completed"
                      ? "bg-sage-500/[0.06]"
                      : status === "in_progress"
                        ? "bg-[#795252]/[0.06]"
                        : "bg-[#f6f3f2]"
                  }`}
                >
                  <div
                    onClick={() => setSelectedCategory(key)}
                    className="flex flex-col gap-2 px-4 py-3 sm:px-5 sm:py-4 cursor-pointer hover:bg-black/[0.02] transition-colors group rounded-xl"
                  >
                    {/* 카테고리 라벨 + 진행 카운트 — min-w-0 으로 좁은 폭에서도
                        한 글자씩 wrap 안 되게 (Windows 배율 ≥150% 등에서 카드가
                        좁아지는 케이스 보호) */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm sm:text-base text-[#1b1c1c] font-medium whitespace-nowrap">{label}</span>
                      {total > 0 && (
                        <span className="text-xs sm:text-sm text-[#504444] whitespace-nowrap">{done}/{total}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {(["not_started", "in_progress", "completed"] as const).map((s) => {
                        const opt = STATUS_STYLES[s];
                        return (
                          <button
                            key={s}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(key, s);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                              status === s
                                ? `${opt.color} text-white`
                                : "bg-white/60 text-[#504444] hover:bg-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                      <ChevronRight className="w-4 h-4 text-[#504444] opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 시작 가이드 */}
        <div
          data-tutorial-target="dashboard-start-guide"
          className="lg:col-span-2 bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        >
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-5 h-5 text-[#795252]" />
            <h3 className="font-serif-kr text-xl sm:text-2xl font-light text-[#1b1c1c]">시작 가이드</h3>
          </div>
          <div className="flex flex-col gap-1">
            {[
              { text: "아모라와 결혼 준비 계획 세우기", href: "/chat", icon: MessageCircle },
              { text: "예산을 설정하고 항목별로 관리하기", href: "/budget", icon: Wallet },
              { text: "일정을 확인하고 체크리스트 진행하기", href: "/schedule", icon: CalendarCheck },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 px-4 py-4 rounded-xl hover:bg-[#f6f3f2] transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-[#f6f3f2] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <item.icon className="w-5 h-5 text-[#795252]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base text-[#1b1c1c] font-light leading-snug">{item.text}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Clock className="w-4 h-4 text-[#504444]" />
                    <span className="text-sm text-[#504444]">시작하기</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 카테고리 체크리스트 모달 */}
      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
      />

      {/* 서비스 가이드 (첫 방문 시) */}
      <ServiceGuide />

      {/* ServiceGuide 닫힌 직후 — 스포트라이트 튜토리얼 */}
      <ServiceDashboardTutorial />
    </div>
  );
}
