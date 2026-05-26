"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { CHECKLIST_MAP } from "@/constants/checklists";
import { useAuthStore } from "@/stores/authStore";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";
import { getChecklistCounts, mergeChecklist } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";

type Status = "not_started" | "in_progress" | "completed";

interface CategoryMeta {
  key: string;
  label: string;
  group: string;
  due: string;
  icon: LucideIcon;
  tasks: string[];
}

const categories: CategoryMeta[] = [
  {
    key: "venue",
    label: "웨딩홀",
    group: "장소",
    due: "D-270 권장",
    icon: Building2,
    tasks: ["후보 3곳 비교", "식대와 대관료 확인", "계약 변경 조건 확인"],
  },
  {
    key: "studio",
    label: "스튜디오",
    group: "스드메",
    due: "D-150 권장",
    icon: Camera,
    tasks: ["촬영 스타일 정하기", "원본·보정 포함 여부 확인", "촬영 일정 확정"],
  },
  {
    key: "snap",
    label: "본식 스냅/영상",
    group: "기록",
    due: "D-120 권장",
    icon: Video,
    tasks: ["스냅·영상 범위 결정", "작가 포트폴리오 3곳 비교", "당일 촬영 동선 협의"],
  },
  {
    key: "dress",
    label: "드레스",
    group: "스드메",
    due: "D-120 권장",
    icon: Shirt,
    tasks: ["샵 후보 비교", "투어 일정 잡기", "본식 드레스 셀렉"],
  },
  {
    key: "makeup",
    label: "메이크업",
    group: "스드메",
    due: "D-60 권장",
    icon: Palette,
    tasks: ["원하는 무드 정리", "리허설 일정 확인", "혼주 메이크업 포함 여부 확인"],
  },
  {
    key: "ring",
    label: "예물",
    group: "계약",
    due: "D-120 권장",
    icon: Gem,
    tasks: ["예산 정하기", "브랜드와 공방 비교", "수령 일정 확인"],
  },
  {
    key: "honeymoon",
    label: "신혼여행",
    group: "여행",
    due: "D-30 권장",
    icon: Plane,
    tasks: ["여행지 확정", "항공·숙소 예약", "여권·보험 확인"],
  },
  {
    key: "houseware",
    label: "혼수",
    group: "생활",
    due: "D-60 권장",
    icon: Home,
    tasks: ["필수 품목 정리", "가전 견적 비교", "배송 일정 확인"],
  },
];

const serviceCards: Array<{ icon: LucideIcon; title: string; desc: string; href: string; cta: string }> = [
  {
    icon: MessageCircle,
    title: "아모라 상담",
    desc: "견적, 업체 답변, 가족 의견을 대화로 정리해요.",
    href: "/chat",
    cta: "상담하기",
  },
  {
    icon: Wallet,
    title: "예산 관리",
    desc: "총 예산과 실제 지출, 항목별 여유분을 확인해요.",
    href: "/budget",
    cta: "예산 보기",
  },
  {
    icon: CalendarCheck,
    title: "일정 관리",
    desc: "해야 할 일과 예약 일정을 D-day 기준으로 봐요.",
    href: "/schedule",
    cta: "일정 보기",
  },
  {
    icon: Users,
    title: "커뮤니티",
    desc: "비슷한 상황의 예비부부 후기와 질문을 이어서 봐요.",
    href: "/community",
    cta: "글 보러가기",
  },
];

const statusMeta: Record<Status, { label: string; tone: string; dot: string }> = {
  not_started: {
    label: "예정",
    tone: "border-[#eadfc9] bg-white text-[#5d6879]",
    dot: "bg-[#c8bda8]",
  },
  in_progress: {
    label: "진행중",
    tone: "border-[#dfc88f] bg-[#fff8ec] text-[#9d6f36]",
    dot: "bg-[#b68a3a]",
  },
  completed: {
    label: "완료",
    tone: "border-[#cdd8bf] bg-[#f4f8ee] text-[#607044]",
    dot: "bg-[#7b8b56]",
  },
};

function getStatus(progress: Record<string, ProgressItem>, key: string): Status {
  const status = progress[key]?.status;
  if (status === "completed" || status === "in_progress" || status === "not_started") return status;
  return "not_started";
}

function getChecklistProgress(progress: Record<string, ProgressItem>, key: string) {
  const template = CHECKLIST_MAP[key];
  const saved = progress[key]?.checklist;
  const status = getStatus(progress, key);
  if (!template) return { done: status === "completed" ? 1 : 0, total: 1 };
  const merged = mergeChecklist(template.items, saved as ChecklistItem[] | undefined, status);
  return getChecklistCounts(merged);
}

function formatWon(amount: number) {
  if (!amount) return "0원";
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
  return categories.reduce(
    (acc, category) => {
      const status = getStatus(progress, category.key);
      acc[status] += 1;
      const counts = getChecklistProgress(progress, category.key);
      acc.doneItems += counts.done;
      acc.totalItems += counts.total;
      return acc;
    },
    { completed: 0, in_progress: 0, not_started: 0, doneItems: 0, totalItems: 0 }
  );
}

function getSpent(progress: Record<string, ProgressItem>) {
  return Object.entries(progress).reduce((sum, [key, item]) => {
    if (key.startsWith("__")) return sum;
    const value = item.spent ?? item.cost ?? 0;
    return sum + value;
  }, 0);
}

export default function DashboardPage() {
  const { partner, journey, couple, updateJourney, isDemo } = useAuthStore();
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryMeta | null>(null);

  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const totalBudget = journey?.total_budget ?? 0;
  const spentBudget = useMemo(() => getSpent(progress), [progress]);
  const budgetPercent = totalBudget > 0 ? Math.min(100, Math.round((spentBudget / totalBudget) * 100)) : 0;
  const dday = getDday(journey?.wedding_date);
  const summary = useMemo(() => getStatusSummary(progress), [progress]);
  const progressPercent = summary.totalItems > 0 ? Math.round((summary.doneItems / summary.totalItems) * 100) : 0;
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return getEvents(progress as Record<string, unknown>)
      .filter((event) => new Date(event.date) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
  }, [progress]);

  const nextCategories = useMemo(
    () =>
      categories
        .filter((category) => getStatus(progress, category.key) !== "completed")
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

  async function copyCode() {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function updateCategoryStatus(key: string, status: Status) {
    const currentProgress = { ...progress };
    const existing = currentProgress[key];
    currentProgress[key] = {
      ...existing,
      category: key,
      status,
    };
    await updateJourney({ progress: currentProgress });
  }

  const ddayLabel =
    dday === null ? "D-day 미정" : dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : `D+${Math.abs(dday)}`;

  return (
    <div className="space-y-5 text-[#061a34]">
      {couple && !partner && inviteCode && (
        <section className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.045)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[15px] font-semibold text-[#071629]">커플과 함께 준비할 수 있어요.</p>
              <p className="mt-1 text-[13px] font-medium text-[#5d6879]">
                초대 코드를 공유하면 같은 예산, 일정, 체크리스트를 함께 볼 수 있습니다.
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

      <section className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]" data-tutorial-target="dashboard-hero">
        <div className="rounded-[24px] border border-[#eadfc9] bg-white/90 p-6 shadow-[0_18px_48px_rgba(8,22,38,0.06)] md:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#eadfc9] bg-[#fff8ec] px-4 py-2 text-[12px] font-semibold text-[#9d6f36]">
            우리 둘의 결혼 준비실
            <Sparkles className="h-4 w-4" />
          </p>
          <h1 className="mt-5 font-serif-kr text-[34px] font-medium leading-[1.25] text-[#061a34] md:text-[46px]">
            오늘 해야 할 준비를
            <br />
            한 화면에서 정리해요.
          </h1>
          <p className="mt-5 max-w-[620px] text-[15px] font-medium leading-[1.85] text-[#38475c]">
            커뮤니티에서 얻은 정보와 아모라 상담 내용을 실제 예산, 일정, 체크리스트로 옮겨
            결혼 준비가 흩어지지 않게 관리합니다.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <MetricCard label="예식일" value={ddayLabel} note={formatDate(journey?.wedding_date)} />
            <MetricCard label="진행률" value={`${progressPercent}%`} note={`${summary.doneItems}/${summary.totalItems}개 체크`} />
            <MetricCard label="예산 사용" value={`${budgetPercent}%`} note={`${formatWon(spentBudget)} / ${formatWon(totalBudget)}`} />
          </div>
        </div>

        <div className="rounded-[24px] border border-[#eadfc9] bg-[#061a34] p-6 text-white shadow-[0_18px_48px_rgba(6,26,52,0.12)] md:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold text-[#ecd7a4]">Amora Briefing</p>
              <h2 className="mt-2 font-serif-kr text-[28px] font-medium">지금 먼저 볼 것</h2>
            </div>
            <ShieldCheck className="h-7 w-7 text-[#ecd7a4]" />
          </div>
          <div className="space-y-3">
            {nextCategories.length > 0 ? (
              nextCategories.map((category) => {
                const Icon = category.icon;
                const status = getStatus(progress, category.key);
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className="flex w-full items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.06] p-4 text-left transition-colors hover:bg-white/[0.1]"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#ecd7a4]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-white">{category.label}</span>
                      <span className="mt-1 block text-[12px] font-medium text-white/62">
                        {category.due} · {statusMeta[status].label}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-white/45" />
                  </button>
                );
              })
            ) : (
              <div className="rounded-[16px] border border-white/10 bg-white/[0.06] p-5">
                <Check className="h-6 w-6 text-[#ecd7a4]" />
                <p className="mt-3 text-[15px] font-semibold">주요 준비가 안정적으로 진행 중이에요.</p>
              </div>
            )}
          </div>
          <Link
            href="/chat"
            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-[14px] font-semibold text-[#061a34]"
          >
            아모라에게 다음 할 일 묻기
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-tutorial-target="dashboard-actions">
        {serviceCards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group rounded-[18px] border border-[#eadfc9] bg-white/90 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)] transition-transform hover:-translate-y-0.5"
          >
            <card.icon className="h-8 w-8 stroke-[1.55] text-[#b68a3a]" />
            <h2 className="mt-4 text-[17px] font-semibold text-[#071629]">{card.title}</h2>
            <p className="mt-2 min-h-[44px] text-[13px] font-medium leading-[1.65] text-[#5d6879]">{card.desc}</p>
            <span className="mt-5 inline-flex items-center text-[13px] font-semibold text-[#9d6f36]">
              {card.cta}
              <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]" data-tutorial-target="dashboard-dday-budget">
        <div className="rounded-[22px] border border-[#eadfc9] bg-white/90 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">진행 현황</p>
              <h2 className="mt-1 font-serif-kr text-[26px] font-medium text-[#071629]">준비 항목별 상태</h2>
            </div>
            <Link href="/schedule" className="inline-flex items-center rounded-full border border-[#eadfc9] bg-white px-4 py-2 text-[13px] font-semibold text-[#9d6f36]">
              전체 체크리스트
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {categories.map((category) => {
              const status = getStatus(progress, category.key);
              const counts = getChecklistProgress(progress, category.key);
              const Icon = category.icon;
              return (
                <article key={category.key} className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-4">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#b68a3a]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-semibold text-[#071629]">{category.label}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusMeta[status].tone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta[status].dot}`} />
                          {statusMeta[status].label}
                        </span>
                      </span>
                      <span className="mt-2 block text-[12px] font-medium text-[#7a8290]">
                        {category.group} · {category.due} · {counts.done}/{counts.total}
                      </span>
                    </span>
                  </button>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {(["not_started", "in_progress", "completed"] as Status[]).map((nextStatus) => (
                      <button
                        key={nextStatus}
                        type="button"
                        onClick={() => void updateCategoryStatus(category.key, nextStatus)}
                        className={`rounded-full border px-2 py-2 text-[12px] font-semibold transition-colors ${
                          status === nextStatus
                            ? "border-[#061a34] bg-[#061a34] text-white"
                            : "border-[#eadfc9] bg-white text-[#5d6879] hover:border-[#b68a3a] hover:text-[#9d6f36]"
                        }`}
                      >
                        {statusMeta[nextStatus].label}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-[22px] border border-[#eadfc9] bg-white/90 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-[#9d6f36]">예산</p>
                <h2 className="mt-1 font-serif-kr text-[26px] font-medium text-[#071629]">지출 흐름</h2>
              </div>
              <Wallet className="h-7 w-7 text-[#b68a3a]" />
            </div>
            <div className="rounded-[16px] bg-[#fff8ec] p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#7a8290]">사용 금액</p>
                  <p className="mt-1 font-serif-kr text-[32px] font-medium text-[#071629]">{formatWon(spentBudget)}</p>
                </div>
                <p className="text-[15px] font-semibold text-[#9d6f36]">{budgetPercent}%</p>
              </div>
              <progress
                value={budgetPercent}
                max={100}
                className="mt-4 h-2 w-full overflow-hidden rounded-full accent-[#b68a3a]"
              />
              <p className="mt-3 text-[12px] font-medium text-[#7a8290]">총 예산 {formatWon(totalBudget)}</p>
            </div>
            <Link href="/budget" className="mt-4 inline-flex items-center rounded-full bg-[#061a34] px-5 py-3 text-[13px] font-semibold text-white">
              예산 자세히 보기
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </section>

          <section className="rounded-[22px] border border-[#eadfc9] bg-white/90 p-6 shadow-[0_10px_30px_rgba(8,22,38,0.04)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-[#9d6f36]">일정</p>
                <h2 className="mt-1 font-serif-kr text-[26px] font-medium text-[#071629]">다가오는 일정</h2>
              </div>
              <Bell className="h-7 w-7 text-[#b68a3a]" />
            </div>
            <div className="space-y-3">
              {upcomingEvents.length > 0 ? (
                upcomingEvents.map((event) => (
                  <Link key={event.id} href="/schedule" className="block rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-4">
                    <p className="text-[13px] font-semibold text-[#071629]">{event.title}</p>
                    <p className="mt-1 text-[12px] font-medium text-[#7a8290]">{formatDate(event.date)}</p>
                  </Link>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-[#eadfc9] bg-[#fffdf7] p-5 text-center">
                  <CalendarCheck className="mx-auto h-7 w-7 text-[#b68a3a]" />
                  <p className="mt-3 text-[13px] font-semibold text-[#071629]">아직 등록된 일정이 없어요.</p>
                  <p className="mt-1 text-[12px] font-medium text-[#7a8290]">상담이나 일정 관리에서 첫 일정을 추가해보세요.</p>
                </div>
              )}
            </div>
            <Link href="/schedule?new=1" className="mt-4 inline-flex items-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[13px] font-semibold text-[#9d6f36]">
              일정 추가하기
              <ArrowRight className="ml-2 h-4 w-4" />
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
          <Link key={item.title} href={item.href} className="flex gap-4 rounded-[16px] bg-white/78 p-5">
            <item.icon className="mt-1 h-7 w-7 shrink-0 stroke-[1.55] text-[#b68a3a]" />
            <span>
              <span className="block text-[15px] font-semibold text-[#071629]">{item.title}</span>
              <span className="mt-2 block text-[12px] font-medium leading-[1.65] text-[#5d6879]">{item.desc}</span>
            </span>
          </Link>
        ))}
      </section>

      <CategoryPanel
        category={selectedCategory}
        status={selectedCategory ? getStatus(progress, selectedCategory.key) : "not_started"}
        onClose={() => setSelectedCategory(null)}
        onStatusChange={updateCategoryStatus}
      />
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-4">
      <p className="text-[12px] font-semibold text-[#7a8290]">{label}</p>
      <p className="mt-2 font-serif-kr text-[27px] font-medium leading-none text-[#071629]">{value}</p>
      <p className="mt-2 truncate text-[12px] font-medium text-[#5d6879]">{note}</p>
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
  if (!category) return null;
  const Icon = category.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#061a34]/45 px-4 pb-4 backdrop-blur-sm md:items-center md:pb-0">
      <section className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-[#eadfc9] bg-white shadow-[0_24px_70px_rgba(6,26,52,0.22)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#eadfc9] bg-[#fff8ec] p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[#b68a3a]">
              <Icon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[#9d6f36]">{category.group} · {category.due}</p>
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
                onClick={() => void onStatusChange(category.key, nextStatus)}
                className={`rounded-full border px-3 py-3 text-[13px] font-semibold ${
                  status === nextStatus
                    ? "border-[#061a34] bg-[#061a34] text-white"
                    : "border-[#eadfc9] bg-white text-[#5d6879]"
                }`}
              >
                {statusMeta[nextStatus].label}
              </button>
            ))}
          </div>

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
            <Link href="/chat" className="inline-flex flex-1 items-center justify-center rounded-full bg-[#061a34] px-5 py-3 text-[13px] font-semibold text-white">
              아모라에게 묻기
            </Link>
            <Link href="/schedule" className="inline-flex flex-1 items-center justify-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[13px] font-semibold text-[#9d6f36]">
              일정에서 보기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
