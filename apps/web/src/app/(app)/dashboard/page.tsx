"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Gem,
  HeartHandshake,
  Home,
  MessageCircle,
  Palette,
  Plane,
  ShieldCheck,
  Shirt,
  Sparkles,
  Users,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import ServiceDashboardTutorial from "@/components/app/ServiceDashboardTutorial";
import ServiceGuide from "@/components/app/ServiceGuide";
import TodayOneCard from "@/components/app/TodayOneCard";
import WeeklyCard from "@/components/app/WeeklyCard";
import GuideOpenButton from "@/components/common/GuideOpenButton";
import { useAuthStore } from "@/stores/authStore";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";
import {
  getJoinedDashboardMarkerSnapshot,
  getDashboardCompanionCopy,
  JOINED_PLAN_REVIEW_PROMPT,
  notifyJoinedDashboardMarkerChanged,
  removeJoinedDashboardMarker,
  subscribeJoinedDashboardMarker,
} from "@/lib/amora/dashboardCompanion";
import { weddingPath } from "@/lib/weddingPaths";
import { getChecklistCounts, mergeChecklist, summarizePlanningChecklist } from "@/utils/checklist";
import { getEvents, getScheduleEventStatus } from "@/utils/scheduleEvents";
import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared";

type Status = "not_started" | "in_progress" | "completed" | "not_applicable";

interface CategoryMeta {
  key: string;
  label: string;
  group: string;
  icon: LucideIcon;
  tasks: string[];
}

const categories: CategoryMeta[] = [
  {
    key: "venue",
    label: PLANNING_CATEGORY_LABELS.venue,
    group: "장소",
    icon: Building2,
    tasks: ["장소 후보 비교", "식사비와 장소 사용료 확인", "계약 취소·변경 조건 확인"],
  },
  {
    key: "studio",
    label: PLANNING_CATEGORY_LABELS.studio,
    group: "사진·의상·메이크업",
    icon: Camera,
    tasks: ["사진 분위기 정하기", "받는 사진 수와 보정 사진 수 확인", "촬영 일정 확정"],
  },
  {
    key: "snap",
    label: PLANNING_CATEGORY_LABELS.snap,
    group: "기록",
    icon: Video,
    tasks: ["사진·영상 중 필요한 것 정하기", "업체가 실제로 찍은 결과 비교", "당일 촬영 동선 협의"],
  },
  {
    key: "dress",
    label: PLANNING_CATEGORY_LABELS.dress,
    group: "사진·의상·메이크업",
    icon: Shirt,
    tasks: ["드레스 매장 후보 비교", "입어볼 날짜 정하기", "결혼식 날 입을 드레스 선택"],
  },
  {
    key: "makeup",
    label: PLANNING_CATEGORY_LABELS.makeup,
    group: "사진·의상·메이크업",
    icon: Palette,
    tasks: ["원하는 분위기 정리", "미리 받아볼 날짜 확인", "부모님 헤어·메이크업 포함 여부 확인"],
  },
  {
    key: "ring",
    label: PLANNING_CATEGORY_LABELS.ring,
    group: "계약",
    icon: Gem,
    tasks: ["예산 정하기", "브랜드와 반지 제작 매장 비교", "받을 날짜 확인"],
  },
  {
    key: "honeymoon",
    label: PLANNING_CATEGORY_LABELS.honeymoon,
    group: "여행",
    icon: Plane,
    tasks: ["여행지 확정", "항공·숙소 예약", "여권·보험 확인"],
  },
  {
    key: "houseware",
    label: PLANNING_CATEGORY_LABELS.houseware,
    group: "생활",
    icon: Home,
    tasks: ["필수 품목 정리", "가전 견적 비교", "배송 일정 확인"],
  },
];

const statusMeta: Record<Status, { label: string; tone: string; dot: string }> = {
  not_started: {
    label: PREPARATION_PROGRESS_STATUS_LABELS.not_started,
    tone: "border-[#eadfc9] bg-white text-[#5d6879]",
    dot: "bg-[#c8bda8]",
  },
  in_progress: {
    label: PREPARATION_PROGRESS_STATUS_LABELS.in_progress,
    tone: "border-[#dfc88f] bg-[#fff8ec] text-[#9d6f36]",
    dot: "bg-[#b68a3a]",
  },
  completed: {
    label: PREPARATION_PROGRESS_STATUS_LABELS.completed,
    tone: "border-[#cdd8bf] bg-[#f4f8ee] text-[#607044]",
    dot: "bg-[#7b8b56]",
  },
  not_applicable: {
    label: PREPARATION_PROGRESS_STATUS_LABELS.not_applicable,
    tone: "border-[#e3e0da] bg-[#f6f4f0] text-[#8b857c]",
    dot: "bg-[#a7a198]",
  },
};

function getStatus(progress: Record<string, ProgressItem>, key: string): Status {
  const status = progress[key]?.status;
  if (status === "completed" || status === "in_progress" || status === "not_started" || status === "not_applicable") return status;
  return "not_started";
}

function getChecklistProgress(progress: Record<string, ProgressItem>, key: string) {
  const template = CHECKLIST_MAP[key];
  const saved = progress[key]?.checklist;
  const status = getStatus(progress, key);
  if (!template) return { done: 0, total: 0 };
  const merged = mergeChecklist(template.items, saved as ChecklistItem[] | undefined, status);
  return getChecklistCounts(merged);
}

function formatWon(amount: number) {
  if (!amount) return "0만원";
  return `${Math.round(amount / 10000).toLocaleString("ko-KR")}만원`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미정";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function getDday(value: string | null | undefined) {
  if (!value) return null;
  const weddingDate = new Date(value);
  if (Number.isNaN(weddingDate.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  weddingDate.setHours(0, 0, 0, 0);
  return Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getStatusSummary(progress: Record<string, ProgressItem>) {
  const summary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress);
  return { doneItems: summary.done, totalItems: summary.total };
}

function getSpent(progress: Record<string, ProgressItem>) {
  return Object.entries(progress).reduce((sum, [key, item]) => {
    if (key.startsWith("__")) return sum;
    // 명시적으로 기록한 지출만 합산한다. 이전 cost 값은 용도가
    // 확인되지 않았으므로 예산 사용이나 결제 완료로 승격하지 않는다.
    const value = isValidWeddingWonAmount(item.spent) ? item.spent : 0;
    const next = sum + value;
    return Number.isSafeInteger(next) ? next : sum;
  }, 0);
}

export default function DashboardPage() {
  const { partner, journey, couple, updateJourney, isDemo } = useAuthStore();
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const joinedHandoffVisible = useSyncExternalStore(
    subscribeJoinedDashboardMarker,
    getJoinedDashboardMarkerSnapshot,
    () => false,
  );
  const [selectedCategory, setSelectedCategory] = useState<CategoryMeta | null>(null);
  const [journeyNotice, setJourneyNotice] = useState("");
  const [journeyError, setJourneyError] = useState("");
  const companionCopy = getDashboardCompanionCopy(Boolean(partner));
  const amoraPromptHref = weddingPath(
    `/chat?${new URLSearchParams({ prefill: companionCopy.amoraPrompt })}`,
  );
  const joinedReviewHref = weddingPath(
    `/chat?${new URLSearchParams({ prefill: JOINED_PLAN_REVIEW_PROMPT })}`,
  );

  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const spentBudget = useMemo(() => getSpent(progress), [progress]);
  const hasTotalBudget = totalBudget > 0;
  const budgetPercent = hasTotalBudget
    ? Math.round((spentBudget / totalBudget) * 100)
    : 0;
  const budgetBarPercent = Math.min(100, Math.max(0, budgetPercent));
  const budgetUsageValue = hasTotalBudget ? `${budgetPercent}%` : "미입력";
  const budgetUsageNote = hasTotalBudget
    ? `${formatWon(spentBudget)} 기록 / ${formatWon(totalBudget)} · 결제 확인과 별도`
    : spentBudget > 0
      ? `기록 지출 ${formatWon(spentBudget)} · 총 예산 입력 전`
      : "총 예산을 입력해주세요";
  const dday = getDday(journey?.wedding_date);
  const summary = useMemo(() => getStatusSummary(progress), [progress]);
  const progressPercent = summary.totalItems > 0 ? Math.round((summary.doneItems / summary.totalItems) * 100) : 0;
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return getEvents(progress as Record<string, unknown>)
      .filter(
        (event) =>
          getScheduleEventStatus(event) === "planned"
          && new Date(event.date) >= today,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
  }, [progress]);

  const nextCategories = useMemo(
    () =>
      categories
        .filter((category) => !["completed", "not_applicable"].includes(getStatus(progress, category.key)))
        .slice(0, 3),
    [progress]
  );

  useEffect(() => {
    if (!couple || partner || inviteCode || isDemo) return;
    fetch("/api/couple/code")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { inviteCode?: string }) => {
        if (data.inviteCode) setInviteCode(data.inviteCode);
      })
      .catch(() => {});
  }, [couple, inviteCode, isDemo, partner]);

  // 모멘트 루프 — 라운지 진입 시 아모라가 챙길 게 있는지 확인 (fire-and-forget, 발화는 채팅 shared로 들어옴)
  // sessionStorage 스로틀: StrictMode 이중 이펙트·잦은 재방문의 중복 호출 방지 (서버 dedupe의 1차 방어선)
  useEffect(() => {
    if (isDemo) return;
    try {
      const key = "hanbang_proactive_last_ts";
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < 10 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* sessionStorage 불가 환경은 서버 dedupe에 위임 */ }
    void requestProactiveCare();
  }, [isDemo]);

  async function copyCode() {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function dismissJoinedHandoff() {
    const nextUrl = removeJoinedDashboardMarker(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    window.history.replaceState(window.history.state, "", nextUrl);
    notifyJoinedDashboardMarkerChanged();
  }

  async function updateCategoryStatus(key: string, status: Status) {
    const currentProgress = { ...progress };
    const existing = currentProgress[key];
    currentProgress[key] = {
      ...existing,
      category: key,
      status,
    };
    setJourneyNotice("");
    setJourneyError("");
    try {
      const result = await updateJourney({ progress: currentProgress });
      setJourneyNotice(
        result.status === "pending_partner"
          ? `${result.summary} 상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다.`
          : "준비 상태를 저장했어요.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "준비 상태를 저장하지 못했습니다.";
      setJourneyError(message);
      throw error;
    }
  }

  const ddayLabel =
    dday === null ? "D-day 미정" : dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : `D+${Math.abs(dday)}`;
  const nextEvent = upcomingEvents[0];
  const remainingItems = Math.max(0, summary.totalItems - summary.doneItems);
  const overviewCards: Array<{ icon: LucideIcon; label: string; value: string; note: string; href: string }> = [
    {
      icon: CalendarCheck,
      label: "다음 일정",
      value: nextEvent?.title ?? "일정 미정",
      note: nextEvent ? formatDate(nextEvent.date) : "가장 가까운 예약을 추가해보세요",
      href: "/schedule",
    },
    {
      icon: ClipboardCheck,
      label: "확인할 항목",
      value: `${remainingItems}개`,
      note: `${summary.doneItems}/${summary.totalItems}개 직접 체크`,
      href: "/schedule",
    },
    {
      icon: Wallet,
      label: "기록 지출 비율",
      value: budgetUsageValue,
      note: budgetUsageNote,
      href: "/budget",
    },
    {
      icon: Users,
      label: "준비 방식",
      value: partner ? "함께 준비" : "혼자 준비",
      note: partner
        ? `${partner.name ?? "파트너"}님과 같은 계획을 보고 있어요`
        : "원할 때 파트너를 초대할 수 있어요",
      href: "/settings",
    },
  ];

  return (
    <div className="space-y-5 text-[#061a34]">
      {journeyNotice && (
        <div
          role="status"
          className="rounded-xl border border-[#B9D5C8] bg-[#F2F8F5] px-4 py-3 text-sm leading-6 text-[#315B49]"
        >
          {journeyNotice}
        </div>
      )}
      {journeyError && (
        <div
          role="alert"
          className="rounded-xl border border-[#E4B7B7] bg-[#FFF7F7] px-4 py-3 text-sm leading-6 text-[#8A3535]"
        >
          {journeyError}
        </div>
      )}
      {joinedHandoffVisible && partner && (
        <section
          data-testid="joined-plan-handoff"
          className="rounded-[20px] border border-[#C7D1C2] bg-[#F7FAF5] p-5 shadow-[0_12px_34px_rgba(54,83,78,0.08)] md:p-6"
          aria-labelledby="joined-plan-title"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E] shadow-[0_4px_14px_rgba(54,83,78,0.08)]">
              <HeartHandshake className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#607044]">
                함께 준비 시작
              </p>
              <h2
                id="joined-plan-title"
                className="mt-1 font-serif-kr text-[24px] font-medium leading-tight text-[#243832]"
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
              value={formatDate(journey?.wedding_date)}
            />
            <HandoffMetric label="장소" value={journey?.venue || "장소 미정"} />
            <HandoffMetric
              label="총 예산"
              value={hasTotalBudget ? formatWon(totalBudget) : "미입력"}
            />
            <HandoffMetric
              label="준비 진행"
              value={`${progressPercent}%`}
              note={`${summary.doneItems}/${summary.totalItems}개 체크`}
            />
          </dl>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href={joinedReviewHref}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#36534E] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#2B423E] sm:w-auto"
            >
              함께 확인할 내용 찾기
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={dismissJoinedHandoff}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-[13px] font-semibold text-[#5D6879] transition-colors hover:bg-white/80 sm:w-auto"
            >
              이 내용 확인했어요
            </button>
          </div>
        </section>
      )}
      {couple && !partner && inviteCode && (
        <section className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[15px] font-semibold text-[#071629]">
                지금은 혼자 준비해도 괜찮아요
              </p>
              <p className="mt-1 text-[13px] font-medium text-[#5d6879]">
                함께 보고 싶을 때 이 코드를 공유하면 같은 예산과 일정, 할 일을 볼 수 있어요.
              </p>
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-5 py-3 text-[14px] font-semibold text-[#9d6f36]"
            >
              <span className="font-jakarta tracking-[0.18em]">{inviteCode}</span>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </section>
      )}

      {!isDemo && <TodayOneCard />}

      {/* 결혼식 날짜가 없으면 첫 행동 하나를, 있으면 이번 주 내용을 보여준다. */}
      {!journey?.wedding_date ? (
        <section className="rounded-[20px] border border-[#eadfc9] bg-white/90 p-5 shadow-[0_14px_36px_rgba(8,22,38,0.045)] md:p-6">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
            시작하기
            <Sparkles className="h-4 w-4" />
          </p>
          <h2 className="mt-3 font-serif-kr text-[24px] font-medium leading-[1.3] text-[#061a34] md:text-[28px]">
            결혼식 날짜를 알려주세요
          </h2>
          <p className="mt-2 max-w-[520px] text-[14px] font-medium leading-[1.6] text-[#38475c]">
            날짜를 입력하면 남은 기간에 맞춰 &lsquo;이번 주 한 장&rsquo;과 일정을 정리할 수 있어요.
            아직 미정이어도 괜찮고, 알림 수신 여부는 설정에서 따로 선택합니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link
              href={weddingPath("/settings")}
              className="inline-flex items-center gap-2 rounded-full bg-[#36534E] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#2B423E]"
            >
              결혼식 날짜 입력하기
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={weddingPath("/chat")}
              className="inline-flex items-center gap-2 rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#f6efe5]"
            >
              아직 막막하면, 아모라랑 시작하기
            </Link>
          </div>
        </section>
      ) : (
        <WeeklyCard
          weddingDate={journey?.wedding_date}
          totalBudget={journey?.total_budget}
          progress={progress}
        />
      )}

      <section className="grid gap-4 lg:grid-cols-2" data-tutorial-target="dashboard-hero">
        <div className="flex h-full flex-col rounded-[20px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_14px_36px_rgba(8,22,38,0.045)] md:p-5">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
            {companionCopy.loungeLabel}
            <Sparkles className="h-4 w-4" />
          </p>
          <h1 className="mt-3 font-serif-kr text-[29px] font-medium leading-[1.2] text-[#061a34] md:text-[36px]">
            {companionCopy.statusHeading}
          </h1>
          <p className="mt-2.5 max-w-[520px] text-[14px] font-medium leading-[1.55] text-[#38475c]">
            {companionCopy.description}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            <MetricCard label="결혼식 날짜" value={ddayLabel} note={formatDate(journey?.wedding_date)} />
            <MetricCard label="체크 진행" value={`${progressPercent}%`} note={`${summary.doneItems}/${summary.totalItems}개 직접 체크`} />
            <MetricCard label="기록 지출 비율" value={budgetUsageValue} note={budgetUsageNote} />
          </div>
        </div>

        <div
          className="flex h-full flex-col rounded-[20px] border border-[#eadfc9] bg-[#36534E] p-4 text-white shadow-[0_14px_36px_rgba(54,83,78,0.13)] md:p-5"
          data-tutorial-target="dashboard-briefing"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold text-[#ecd7a4]">아모라 안내</p>
              <h2 className="mt-1 font-serif-kr text-[23px] font-medium">지금 먼저 볼 것</h2>
            </div>
            <ShieldCheck className="h-6 w-6 text-[#ecd7a4]" />
          </div>
          <Link
            href={amoraPromptHref}
            className="mb-4 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-white px-5 text-[13px] font-semibold text-[#36534E]"
          >
            {companionCopy.amoraCtaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <div className="mt-auto grid grid-cols-3 gap-2">
            {nextCategories.length > 0 ? (
               nextCategories.map((category) => {
                 const Icon = category.icon;
                 const status = getStatus(progress, category.key);
                 const counts = getChecklistProgress(progress, category.key);
                 return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className="min-w-0 rounded-[14px] border border-white/10 bg-white/[0.06] p-3 text-left transition-colors hover:bg-white/[0.1]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#ecd7a4]">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="mt-2 block min-w-0">
                       <span className="block truncate text-[13px] font-semibold text-white">{category.label}</span>
                       <span className="mt-0.5 block truncate text-[11px] font-medium text-white/62">
                         {counts.done}/{counts.total}개 직접 체크 · {statusMeta[status].label}
                       </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="col-span-3 rounded-[14px] border border-white/10 bg-white/[0.06] p-4">
                <Check className="h-5 w-5 text-[#ecd7a4]" />
                <p className="mt-2 text-[14px] font-semibold">주요 준비가 안정적으로 진행 중이에요.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-tutorial-target="dashboard-actions">
        {overviewCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group rounded-[16px] border border-[#eadfc9] bg-white/90 p-3.5 shadow-[0_8px_24px_rgba(8,22,38,0.035)] transition-colors hover:border-[#d8bb86] sm:p-4"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8ec] text-[#36534E] sm:h-9 sm:w-9">
                <card.icon className="h-4 w-4 stroke-[1.55] sm:h-[18px] sm:w-[18px]" />
              </span>
              <ChevronRight className="h-4 w-4 text-[#36534E] transition-transform group-hover:translate-x-0.5" />
            </span>
            <p className="mt-2.5 text-[11px] font-semibold text-[#9d6f36] sm:mt-3">{card.label}</p>
            <h2 className="mt-1 truncate text-[16px] font-semibold text-[#071629] sm:text-[18px]">{card.value}</h2>
            <span className="mt-1 block truncate text-[10px] font-medium text-[#5d6879] sm:mt-1.5 sm:text-[11px]">
              {card.note}
            </span>
          </Link>
        ))}
      </section>

      <section className="grid items-stretch gap-4 lg:grid-cols-[1.28fr_0.72fr]" data-tutorial-target="dashboard-dday-budget">
        <div className="h-full rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">진행 현황</p>
              <h2 className="mt-1 font-serif-kr text-[22px] font-medium text-[#071629]">준비 항목별 상태</h2>
            </div>
            <Link href={weddingPath("/checklist")} className="inline-flex items-center rounded-full border border-[#eadfc9] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#9d6f36]">
              전체 체크리스트
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((category) => {
              const status = getStatus(progress, category.key);
              const counts = getChecklistProgress(progress, category.key);
              const Icon = category.icon;
              const percent = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className="group rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-3 text-left transition-colors hover:border-[#d8bb86] hover:bg-white"
                >
                  <span className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E] shadow-[0_4px_12px_rgba(8,22,38,0.04)]">
                        <Icon className="h-4 w-4" />
                      </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-[14px] font-semibold leading-tight text-[#071629]">{category.label}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusMeta[status].tone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta[status].dot}`} />
                          {statusMeta[status].label}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] font-medium text-[#7a8290]">
                        {category.group}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
                    <span className="block h-full rounded-full bg-[#36534E]" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-[#7a8290]">
                    <span>체크리스트</span>
                    <span>{counts.done}/{counts.total} 체크</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid h-full gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-[0.92fr_1.08fr]">
          <section className="flex flex-col justify-between rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-[#9d6f36]">예산</p>
                <h2 className="mt-1 font-serif-kr text-[22px] font-medium text-[#071629]">기록 지출 흐름</h2>
              </div>
              <Link href={weddingPath("/budget")} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8ec] text-[#36534E]" aria-label="예산 관리로 이동">
                <Wallet className="h-4 w-4" />
              </Link>
            </div>
            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-[#7a8290]">기록 지출</p>
                  <p className="mt-1 font-serif-kr text-[24px] font-medium leading-none text-[#071629]">{formatWon(spentBudget)}</p>
                </div>
                <p className="rounded-full bg-[#fff8ec] px-2.5 py-1 text-[12px] font-semibold text-[#36534E]">
                  {hasTotalBudget ? `${budgetPercent}%` : "계산 전"}
                </p>
              </div>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
                <span className="block h-full rounded-full bg-[#36534E]" style={{ width: `${budgetBarPercent}%` }} />
              </span>
              <p className="mt-2 text-[10px] font-medium text-[#7a8290]">
                기록 지출은 사용자가 입력한 금액이며 결제 완료 확인과는 별도예요.
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[#7a8290]">
              <span>
                {hasTotalBudget ? `총 예산 ${formatWon(totalBudget)}` : "총 예산 미입력"}
              </span>
              <Link href={weddingPath("/budget")} className="inline-flex items-center font-semibold text-[#36534E]">
                자세히
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </div>
          </section>

          <section className="flex flex-col justify-between rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-[#9d6f36]">일정</p>
                <h2 className="mt-1 font-serif-kr text-[22px] font-medium text-[#071629]">다가오는 일정</h2>
              </div>
              <Link href={weddingPath("/schedule?new=1")} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff8ec] text-[#36534E]" aria-label="일정 추가하기">
                <Bell className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-2">
              {upcomingEvents.length > 0 ? (
                upcomingEvents.slice(0, 2).map((event) => (
                  <Link key={event.id} href={weddingPath("/schedule")} className="block rounded-[12px] border border-[#eadfc9] bg-[#fffdf7] px-3.5 py-2.5">
                    <p className="truncate text-[13px] font-semibold text-[#071629]">{event.title}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-[#7a8290]">{formatDate(event.date)}</p>
                  </Link>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-[#eadfc9] bg-[#fffdf7] px-3.5 py-4">
                  <div className="flex items-start gap-3">
                    <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#36534E]" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#071629]">등록된 일정이 없어요.</p>
                      <p className="mt-0.5 text-[11px] font-medium text-[#7a8290]">첫 상담이나 예약 일정을 추가해보세요.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Link href={weddingPath("/schedule")} className="mt-2.5 inline-flex items-center text-[12px] font-semibold text-[#36534E]">
              일정 관리 열기
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </section>
        </div>
      </section>

      <section className="grid gap-4 rounded-[22px] border border-[#eadfc9] bg-[#fffaf0] p-6 md:grid-cols-3" data-tutorial-target="dashboard-start-guide">
        {[
          { icon: HeartHandshake, title: "커뮤니티에서 찾고", desc: "실제 후기와 질문으로 선택지를 좁혀요.", href: "/community" },
          { icon: MessageCircle, title: "아모라에게 묻고", desc: "우리 상황에 맞게 견적과 조건을 해석해요.", href: "/chat" },
          { icon: ClipboardCheck, title: "결정으로 남기기", desc: "예산과 일정, 체크리스트로 바로 옮겨요.", href: "/schedule" },
        ].map((item) => (
          <Link key={item.title} href={weddingPath(item.href)} className="flex gap-4 rounded-[16px] bg-white/78 p-5">
            <item.icon className="mt-1 h-7 w-7 shrink-0 stroke-[1.55] text-[#b68a3a]" />
            <span>
              <span className="block text-[15px] font-semibold text-[#071629]">{item.title}</span>
              <span className="mt-2 block text-[12px] font-medium leading-[1.65] text-[#5d6879]">{item.desc}</span>
            </span>
          </Link>
        ))}
      </section>

      <CategoryPanel
        key={selectedCategory?.key ?? "closed"}
        category={selectedCategory}
        status={selectedCategory ? getStatus(progress, selectedCategory.key) : "not_started"}
        onClose={() => setSelectedCategory(null)}
        onStatusChange={updateCategoryStatus}
      />
      <GuideOpenButton eventName="hanbang:open-service-guide" label="처음이신가요? 이용 가이드 보기" />
      <ServiceGuide />
      <ServiceDashboardTutorial />
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-2.5 sm:p-3.5">
      <p className="truncate text-[10px] font-semibold text-[#7a8290] sm:text-[11px]">{label}</p>
      <p className="mt-1.5 truncate font-serif-kr text-[21px] font-medium leading-none text-[#071629] sm:text-[24px]">{value}</p>
      <p className="mt-1.5 truncate text-[10px] font-medium text-[#5d6879] sm:text-[11px]">{note}</p>
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

function CategoryPanel({
  category,
  status,
  onClose,
  onStatusChange,
}: {
  category: CategoryMeta | null;
  status: Status;
  onClose: () => void;
  onStatusChange: (key: string, status: Status) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  if (!category) return null;
  const Icon = category.icon;
  const handleStatusChange = async (nextStatus: Status) => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await onStatusChange(category.key, nextStatus);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "준비 상태를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#061a34]/45 px-4 pb-4 backdrop-blur-sm md:items-center md:pb-0">
      <section className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-[#eadfc9] bg-white shadow-[0_24px_70px_rgba(6,26,52,0.22)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#eadfc9] bg-[#fff8ec] p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[#b68a3a]">
              <Icon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">{category.group}</p>
              <h2 className="mt-1 font-serif-kr text-[26px] font-medium text-[#071629]">{category.label}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#eadfc9] bg-white text-[#5d6879]"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 grid grid-cols-3 gap-2">
            {(["not_started", "in_progress", "completed"] as Status[]).map((nextStatus) => (
              <button
                key={nextStatus}
                type="button"
                disabled={saving}
                onClick={() => void handleStatusChange(nextStatus)}
                className={`rounded-full border px-3 py-3 text-[13px] font-semibold ${
                  status === nextStatus
                    ? "border-[#061a34] bg-[#061a34] text-white"
                    : "border-[#eadfc9] bg-white text-[#5d6879]"
                } disabled:opacity-50`}
              >
                {statusMeta[nextStatus].label}
              </button>
            ))}
          </div>
          {saveError && (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-[#E4B7B7] bg-[#FFF7F7] px-4 py-3 text-sm leading-6 text-[#8A3535]"
            >
              {saveError}
            </p>
          )}

          <div className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-5">
            <p className="mb-3 text-[13px] font-semibold text-[#9d6f36]">먼저 확인할 것</p>
            <div className="space-y-3">
              {category.tasks.map((task) => (
                <div key={task} className="flex items-center gap-3">
                  <Check className="h-4 w-4 text-[#b68a3a]" />
                  <span className="text-[14px] font-medium text-[#34445a]">{task}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={weddingPath("/chat")} className="inline-flex flex-1 items-center justify-center rounded-full bg-[#061a34] px-5 py-3 text-[13px] font-semibold text-white">
              아모라에게 묻기
            </Link>
            <Link href={weddingPath("/schedule")} className="inline-flex flex-1 items-center justify-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[13px] font-semibold text-[#9d6f36]">
              일정에서 보기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
