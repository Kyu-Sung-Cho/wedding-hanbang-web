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
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { CHECKLIST_MAP, CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { CategoryChecklistTemplate } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import ServiceGuide from "@/components/app/ServiceGuide";

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

export default function DashboardPage() {
  const { profile, partner, journey, couple, updateJourney } = useAuthStore();
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

  // 진행률 계산 (개별 체크리스트 항목 기준 — 일정/채팅 패널과 동일)
  const progress = journey?.progress ?? {};
  const { totalDone, totalItems } = CATEGORY_CHECKLISTS.reduce(
    (acc, cat) => {
      const template = CHECKLIST_MAP[cat.key];
      if (!template) return acc;
      const existing = progress[cat.key] as { status?: string; checklist?: { id: string; label: string; done: boolean }[] } | undefined;
      const merged = mergeChecklist(template.items, existing?.checklist, existing?.status as "not_started" | "in_progress" | "completed" | undefined);
      const counts = getChecklistCounts(merged);
      return { totalDone: acc.totalDone + counts.done, totalItems: acc.totalItems + counts.total };
    },
    { totalDone: 0, totalItems: 0 }
  );
  const progressPercent = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;

  // 예산 계산
  const totalBudget = journey?.total_budget ?? 0;
  const spentBudget = Math.round(totalBudget * (progressPercent / 100));
  const budgetPercent = totalBudget > 0 ? Math.round((spentBudget / totalBudget) * 100) : 0;
  const formatBudget = (amount: number) =>
    amount >= 10000
      ? `₩${(amount / 10000).toLocaleString()}만`
      : `₩${amount.toLocaleString()}`;

  const userName = profile?.name ?? "사용자";
  const partnerName = partner?.name;

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-10 bg-[#fcf9f8]">
      {/* 파트너 미연동 안내 */}
      {couple && !partner && inviteCode && (
        <div className="bg-white rounded-2xl p-6 mb-8 flex items-center justify-between max-md:flex-col max-md:gap-3 animate-fade-in shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div>
            <p className="text-[17px] font-medium text-[#1b1c1c]">
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

      {/* 1. 에디토리얼 히어로 배너 */}
      <section className="relative rounded-2xl overflow-hidden aspect-[5/3] sm:aspect-[16/7] lg:aspect-[16/6] mb-8 animate-fade-in shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {/* 배경 그라디언트 (CSS 폴백) */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#E8DDD5] via-[#D9C5BC] to-[#946a6a]" />
        {/* 장식 패턴 */}
        <div className="absolute top-[-15%] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(255,255,255,0.3),transparent_70%)] rounded-full" />
        <div className="absolute bottom-[-25%] left-[5%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(201,169,110,0.25),transparent_70%)] rounded-full" />
        <div className="absolute top-[20%] left-[40%] w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(121,82,82,0.2),transparent_70%)] rounded-full" />
        {/* 어두운 오버레이 (가독성) */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/30 to-transparent" />

        {/* 텍스트 컨텐츠 */}
        <div className="relative h-full flex items-center px-6 sm:px-10 lg:px-16">
          <div className="min-w-0">
            <p className="text-xs lg:text-sm tracking-[0.3em] uppercase text-white/75 font-medium mb-3 sm:mb-5">
              The Curated Atelier
            </p>
            <h1 className="text-white mb-3 sm:mb-4 leading-[1.05] break-words">
              <span className="block headline-italic text-4xl sm:text-5xl lg:text-7xl">
                Welcome,
              </span>
              <span className="block font-serif-kr font-light text-2xl sm:text-3xl lg:text-5xl mt-1 sm:mt-2">
                {partnerName
                  ? <>{userName} & {partnerName}</>
                  : <>{userName ?? "예비 부부"}님</>}
              </span>
            </h1>
            <p className="text-base sm:text-lg lg:text-xl text-white/90 font-light italic font-serif-kr">
              결혼 준비가 아름답게 시작됐어요.
            </p>
          </div>
        </div>
      </section>

      {/* 2. D-day + Budget Overview (2-column) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 mb-8 animate-fade-in">
        {/* D-day 카드 */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-center min-h-[240px] sm:min-h-[300px] relative overflow-hidden">
          {/* 장식 스파클 */}
          <Sparkles className="absolute top-6 right-6 w-8 h-8 text-[#C9A96E]/30" />
          <Sparkles className="absolute bottom-8 left-8 w-6 h-6 text-[#C9A96E]/15" />

          <p className="text-xs text-[#795252] tracking-[0.25em] uppercase mb-4 font-medium">
            The Big Day
          </p>
          <p className="font-serif-kr text-6xl sm:text-7xl lg:text-[96px] leading-none text-[#795252] mb-2 font-light">
            {ddayDisplay}
          </p>
          <p className="headline-italic text-xl sm:text-2xl text-[#504444] mb-4 sm:mb-6">
            {ddayLabel}
          </p>
          <p className="text-base text-[#504444]">
            {dateStr}
          </p>
        </div>

        {/* Budget Overview */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-start justify-between mb-6 sm:mb-8">
            <div className="min-w-0">
              <h2 className="font-serif-kr text-2xl sm:text-3xl text-[#1b1c1c] mb-2 font-light">예산 현황</h2>
              <p className="text-base text-[#504444]">소중한 투자를 관리해요</p>
            </div>
            <Link href="/budget" className="text-[#504444] hover:text-[#795252] transition-colors flex-shrink-0">
              <MoreHorizontal className="w-5 h-5" />
            </Link>
          </div>

          <div className="flex justify-between items-end gap-3 mb-6">
            <div className="min-w-0">
              <p className="font-serif-kr text-3xl sm:text-4xl text-[#1b1c1c] font-light mb-1 break-words">
                {formatBudget(spentBudget)}
              </p>
              <p className="text-sm text-[#504444]">사용한 금액</p>
            </div>
            <div className="text-right min-w-0">
              <p className="font-serif-kr text-3xl sm:text-4xl text-[#1b1c1c] font-light mb-1 break-words">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 mb-8 animate-fade-in">
        {/* 다가오는 일정 + 빠른 실행 — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 sm:p-8 lg:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          {/* 다가오는 일정 */}
          <div className="mb-8">
            <h3 className="font-serif-kr text-xl sm:text-2xl text-[#1b1c1c] mb-5 font-light">다가오는 일정</h3>

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
                  <p className="text-xl font-serif-kr text-[#1b1c1c] mb-1 font-light">{nextMilestone.label}</p>
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
            ) : (
              <div className="flex items-center gap-5 p-5 rounded-xl bg-[#f6f3f2]">
                <div className="w-14 h-14 rounded-xl bg-[#dee6c4]/40 flex items-center justify-center shrink-0">
                  <Check className="w-7 h-7 text-sage-500" />
                </div>
                <div className="flex-1">
                  <p className="text-xl font-serif-kr text-[#1b1c1c] mb-1 font-light">모두 순조로워요</p>
                  <p className="text-base text-[#504444]">현재 급한 일정은 없어요</p>
                </div>
              </div>
            )}
          </div>

          {/* 빠른 실행 */}
          <div>
            <h3 className="font-serif-kr text-xl sm:text-2xl text-[#1b1c1c] mb-5 font-light">빠른 실행</h3>
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

        {/* Spotlight — 다크 테마 */}
        <Link
          href="/fitting"
          className="relative rounded-2xl overflow-hidden min-h-[320px] sm:min-h-[400px] group cursor-pointer block"
        >
          {/* 배경 */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] via-[#3a2a2a] to-[#5a4040]" />
          <div className="absolute top-[-20%] right-[-10%] w-[250px] h-[250px] bg-[radial-gradient(circle,rgba(201,169,110,0.35),transparent_70%)] rounded-full" />
          <div className="absolute bottom-[-10%] left-[-15%] w-[200px] h-[200px] bg-[radial-gradient(circle,rgba(148,106,106,0.4),transparent_70%)] rounded-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

          {/* 상단 아이콘 */}
          <div className="absolute top-8 right-8">
            <Sparkles className="w-7 h-7 text-[#C9A96E]/70" />
          </div>

          {/* 컨텐츠 */}
          <div className="relative h-full flex flex-col justify-end p-6 sm:p-8 text-white">
            <p className="text-xs tracking-[0.25em] uppercase text-[#C9A96E] mb-3 font-medium">
              Spotlight
            </p>
            <h3 className="font-serif-kr text-2xl sm:text-3xl mb-3 font-light">AI 드레스 피팅</h3>
            <p className="text-base text-white/80 mb-5 line-clamp-2 leading-relaxed">
              내 사진으로 수백 벌의 드레스를 미리 입어보세요
            </p>
            <div className="inline-flex items-center gap-2 text-base font-medium text-white border-b border-white/30 group-hover:border-white self-start pb-1 transition-colors">
              지금 시작
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Link>
      </div>

      {/* 4. 지금 해야 할 것 + 커플 활동 */}
      {(urgentTasks.length > 0 || partnerActivities.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 sm:gap-8 mb-8 animate-fade-in">
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
                          <span className="text-[17px] font-medium text-[#1b1c1c]">{task.label}</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 sm:gap-8 animate-fade-in">
        {/* 카테고리 현황 */}
        <div className="lg:col-span-3 bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
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
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-black/[0.02] transition-all group rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base text-[#1b1c1c] font-medium">{label}</span>
                      {total > 0 && (
                        <span className="text-sm text-[#504444]">{done}/{total}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(["not_started", "in_progress", "completed"] as const).map((s) => {
                        const opt = STATUS_STYLES[s];
                        return (
                          <button
                            key={s}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(key, s);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                              status === s
                                ? `${opt.color} text-white`
                                : "bg-white/60 text-[#504444] hover:bg-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                      <ChevronRight className="w-4 h-4 text-[#504444] opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 시작 가이드 */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
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
    </div>
  );
}
