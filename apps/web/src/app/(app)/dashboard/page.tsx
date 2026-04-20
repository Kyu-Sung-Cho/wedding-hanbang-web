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
  completed: { label: "완료", color: "bg-[#5a6147]" },
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

  return (
    <div className="max-w-[1200px] mx-auto">
      {/* 파트너 미연동 안내 */}
      {couple && !partner && inviteCode && (
        <div
          className="bg-[#F6F3F2] rounded-xl p-5 mb-6 flex items-center justify-between max-md:flex-col max-md:gap-3 animate-fade-in shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        >
          <div>
            <p className="text-[14px] font-medium text-[#1A1A1F]">
              파트너에게 초대 코드를 공유하세요
            </p>
            <p className="text-[12px] text-[#B5ADA3] mt-0.5">
              파트너가 회원가입 시 이 코드를 입력하면 커플 연동됩니다
            </p>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-xl hover:shadow-md transition-all"
          >
            <span className="font-mono text-[15px] font-bold text-[#1A1A1F] tracking-wider">
              {inviteCode}
            </span>
            {copied ? (
              <Check className="w-4 h-4 text-[#5a6147]" />
            ) : (
              <Copy className="w-4 h-4 text-[#B5ADA3]" />
            )}
          </button>
        </div>
      )}

      {/* 에디토리얼 히어로 배너 */}
      <div className="relative h-64 md:h-80 rounded-xl overflow-hidden mb-8 animate-fade-in shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {/* 배경 그라디언트 (웨딩 무드) */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#E8DDD5] via-[#D9C5BC] to-[#C9A89D]" />
        {/* 장식 패턴 */}
        <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(255,255,255,0.25),transparent_70%)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[10%] w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(121,82,82,0.15),transparent_70%)] rounded-full" />
        {/* 오버레이 */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-black/10 to-transparent" />
        {/* 컨텐츠 */}
        <div className="relative h-full flex flex-col justify-center px-8 md:px-12">
          <p className="text-xs tracking-[0.25em] uppercase text-white/80 font-medium mb-3">
            Curated Atelier
          </p>
          <h1 className="font-serif-kr text-3xl md:text-5xl text-white font-light leading-tight mb-3">
            {partnerName
              ? <>{userName}님 & {partnerName}님</>
              : <>{userName}님, 환영합니다</>}
          </h1>
          <p className="text-white/90 font-serif-kr italic text-base md:text-lg">
            영원의 시작이 아름답게 펼쳐지고 있어요
          </p>
        </div>
      </div>

      {/* D-day + Budget Overview (2열) */}
      <div className="grid grid-cols-5 gap-6 mb-8 max-lg:grid-cols-1 animate-fade-in">
        {/* D-day 카드 */}
        <div className="col-span-2 max-lg:col-span-1 bg-white rounded-xl p-8 relative overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          {/* 장식 스파클 */}
          <div className="absolute top-4 right-4 w-8 h-8 opacity-10">
            <Sparkles className="w-full h-full text-[#795252]" />
          </div>
          <div className="absolute bottom-4 left-4 w-6 h-6 opacity-[0.06]">
            <Sparkles className="w-full h-full text-[#795252]" />
          </div>

          <p className="text-xs tracking-[0.25em] uppercase text-[#795252] font-medium mb-8 text-center">
            결혼식 D-DAY
          </p>
          <div className="text-center">
            <div className="font-serif-kr text-7xl font-light text-[#1A1A1F] mb-3 leading-none">
              {dday !== null && dday > 0
                ? dday
                : dday === 0
                  ? "D"
                  : dday !== null && dday < 0
                    ? `+${Math.abs(dday)}`
                    : "—"}
            </div>
            <p className="font-serif-kr italic text-[#504444] text-lg">
              {dday !== null && dday > 0
                ? "일 남았어요"
                : dday === 0
                  ? "오늘이에요"
                  : dday !== null && dday < 0
                    ? "일 지났어요"
                    : "날짜 미정"}
            </p>
          </div>
          <div className="mt-8 pt-6 border-t border-[#F6F3F2]">
            <p className="text-center text-sm text-[#B5ADA3]">{dateStr}</p>
          </div>
        </div>

        {/* Budget Overview 카드 */}
        <div className="col-span-3 max-lg:col-span-1 bg-white rounded-xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h3 className="font-serif-kr text-2xl text-[#1A1A1F] mb-1 font-light">예산 현황</h3>
              <p className="text-sm text-[#B5ADA3]">소중한 투자를 관리해요</p>
            </div>
            <Link href="/budget" className="text-[#B5ADA3] hover:text-[#795252] transition-colors">
              <MoreHorizontal className="w-5 h-5" />
            </Link>
          </div>

          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="font-serif-kr text-4xl font-light text-[#1A1A1F] leading-none">
                {formatBudget(spentBudget)}
              </p>
              <p className="text-xs text-[#B5ADA3] mt-2 tracking-wider uppercase">사용한 예산</p>
            </div>
            <div className="text-right">
              <p className="font-serif-kr text-2xl text-[#504444] font-light leading-none">
                {formatBudget(totalBudget)}
              </p>
              <p className="text-xs text-[#B5ADA3] mt-2 tracking-wider uppercase">전체 예산</p>
            </div>
          </div>

          <div className="h-2 bg-[#F6F3F2] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(budgetPercent, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#B5ADA3]">진행률 {progressPercent}%</p>
            <p className="text-right text-xs text-[#B5ADA3]">{budgetPercent}% 사용</p>
          </div>
        </div>
      </div>

      {/* Next Milestone / Quick Actions / Spotlight (3-column) */}
      <div className="grid grid-cols-3 gap-6 mb-8 max-lg:grid-cols-1 animate-fade-in">
        {/* Next Milestone */}
        <div className="bg-white rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
          <p className="text-xs tracking-[0.2em] uppercase text-[#795252] font-medium mb-5">
            Next Milestone
          </p>
          {nextMilestone ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F6F3F2] to-[#E8DDD5] flex items-center justify-center mb-5">
                {(() => {
                  const IconComp = CATEGORY_ICONS[nextMilestone.key] ?? CalendarCheck;
                  return <IconComp className="w-5 h-5 text-[#795252]" />;
                })()}
              </div>
              <h4 className="font-serif-kr text-xl text-[#1A1A1F] font-light mb-3 leading-snug">
                {nextMilestone.label}
              </h4>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#795252]/10 text-[#795252] text-xs font-medium tracking-wide">
                  {nextMilestone.urgency === "overdue"
                    ? "지금 바로"
                    : nextMilestone.daysUntilDeadline <= 14
                      ? `${nextMilestone.daysUntilDeadline}일 내`
                      : "여유 있음"}
                </span>
                <span className="text-xs text-[#B5ADA3]">{nextMilestone.deadlineText}</span>
              </div>
              <button
                onClick={() => setSelectedCategory(nextMilestone.key)}
                className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#795252] hover:text-[#946a6a] transition-colors"
              >
                자세히 보기
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F6F3F2] to-[#E8DDD5] flex items-center justify-center mb-5">
                <Check className="w-5 h-5 text-[#5a6147]" />
              </div>
              <h4 className="font-serif-kr text-xl text-[#1A1A1F] font-light mb-3 leading-snug">
                모두 순조로워요
              </h4>
              <p className="text-sm text-[#504444] leading-relaxed">
                현재 급한 일정은 없어요. 여유롭게 준비를 이어가세요.
              </p>
            </>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-[#F6F3F2] rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <p className="text-xs tracking-[0.2em] uppercase text-[#795252] font-medium mb-5">
            Quick Actions
          </p>
          <h4 className="font-serif-kr text-xl text-[#1A1A1F] font-light mb-5">
            빠른 시작
          </h4>
          <div className="flex flex-col gap-3">
            <Link
              href="/chat"
              className="group flex items-center justify-between px-4 py-4 bg-white rounded-xl hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center">
                  <MessageCircle className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-medium text-[#1A1A1F]">아모라 상담</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#B5ADA3] group-hover:text-[#795252] group-hover:translate-x-0.5 transition-all" />
            </Link>
            <Link
              href="/community"
              className="group flex items-center justify-between px-4 py-4 bg-white rounded-xl hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#5a6147] to-[#7a8560] flex items-center justify-center">
                  <Users className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-medium text-[#1A1A1F]">최근 커뮤니티 글</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#B5ADA3] group-hover:text-[#795252] group-hover:translate-x-0.5 transition-all" />
            </Link>
          </div>
        </div>

        {/* Spotlight */}
        <Link
          href="/fitting"
          className="group relative rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] min-h-[260px] block"
        >
          {/* 배경 그라디언트 */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#5a6147] via-[#795252] to-[#3d2e2e]" />
          <div className="absolute top-[-20%] right-[-10%] w-[200px] h-[200px] bg-[radial-gradient(circle,rgba(255,255,255,0.15),transparent_70%)] rounded-full" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[180px] h-[180px] bg-[radial-gradient(circle,rgba(201,169,110,0.2),transparent_70%)] rounded-full" />
          {/* 컨텐츠 */}
          <div className="relative h-full flex flex-col justify-between p-7">
            <div>
              <p className="text-xs tracking-[0.2em] uppercase text-white/70 font-medium mb-3">
                Spotlight
              </p>
              <Sparkles className="w-6 h-6 text-white/80 mb-4" />
            </div>
            <div>
              <h4 className="font-serif-kr text-2xl text-white font-light mb-2 leading-snug">
                AI 드레스 피팅
              </h4>
              <p className="text-sm text-white/80 mb-5 leading-relaxed">
                내 사진으로 수백 벌의 드레스를 미리 입어보세요
              </p>
              <div className="inline-flex items-center gap-1.5 text-sm text-white font-medium group-hover:gap-2.5 transition-all">
                지금 시작
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* 지금 해야 할 것 + 커플 활동 */}
      {(urgentTasks.length > 0 || partnerActivities.length > 0) && (
        <div className="grid grid-cols-5 gap-6 mb-8 max-lg:grid-cols-1 animate-fade-in">
          {/* 지금 해야 할 것 */}
          {urgentTasks.length > 0 && (
            <div className={`${partnerActivities.length > 0 ? "col-span-3" : "col-span-5"} max-lg:col-span-1 bg-white rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]`}>
              <div className="flex items-center gap-2 mb-5">
                <AlertCircle className="w-4 h-4 text-[#795252]" />
                <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F]">지금 해야 할 것</h3>
              </div>
              <div className="flex flex-col gap-3">
                {urgentTasks.map((task) => {
                  const IconComp = CATEGORY_ICONS[task.key] ?? CalendarCheck;
                  return (
                    <div
                      key={task.key}
                      onClick={() => setSelectedCategory(task.key)}
                      className={`flex items-center gap-4 px-4 py-3.5 rounded-xl cursor-pointer hover:shadow-sm transition-all ${task.urgencyBg}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        task.urgency === "overdue"
                          ? "bg-red-100"
                          : task.urgency === "soon"
                            ? "bg-amber-100"
                            : "bg-emerald-100"
                      }`}>
                        <IconComp className={`w-5 h-5 ${task.urgencyColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-[#1A1A1F]">{task.label}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${task.urgencyColor} ${
                            task.urgency === "overdue"
                              ? "bg-red-100"
                              : task.urgency === "soon"
                                ? "bg-amber-100"
                                : "bg-emerald-100"
                          }`}>
                            {task.urgencyLabel}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#504444] mt-0.5">{task.deadlineText}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#B5ADA3] flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 커플 활동 */}
          {partnerActivities.length > 0 && (
            <div className={`${urgentTasks.length > 0 ? "col-span-2" : "col-span-5"} max-lg:col-span-1 bg-white rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]`}>
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-4 h-4 text-[#795252]" />
                <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F]">커플 활동</h3>
              </div>
              <div className="flex flex-col gap-2">
                {partnerActivities.map((activity) => {
                  const IconComp = CATEGORY_ICONS[activity.key] ?? CalendarCheck;
                  return (
                    <div
                      key={activity.key}
                      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-[#F6F3F2]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#795252]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <IconComp className="w-4 h-4 text-[#795252]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-[#1A1A1F] font-light leading-snug">
                          <span className="font-medium">{partner?.name ?? "파트너"}</span>
                          {activity.status === "completed"
                            ? <span>가 <span className="font-medium text-[#5a6147]">{activity.label}</span>을 <span className="text-[#5a6147] font-medium">완료</span>했어요</span>
                            : <span>가 <span className="font-medium text-[#795252]">{activity.label}</span>을 <span className="text-[#795252] font-medium">진행중</span>으로 변경했어요</span>
                          }
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Clock className="w-3 h-3 text-[#B5ADA3]" />
                          <span className="text-[11px] text-[#B5ADA3]">최근 활동</span>
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

      {/* 카테고리별 진행 상태 + 시작 가이드 */}
      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1 animate-fade-in">
        {/* 카테고리 현황 */}
        <div className="col-span-3 bg-white rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs tracking-[0.2em] uppercase text-[#795252] font-medium mb-1">
                Progress
              </p>
              <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F]">카테고리별 진행 상태</h3>
            </div>
            <Link href="/schedule" className="text-[12px] text-[#795252] font-medium flex items-center gap-1 hover:gap-2 transition-all">
              전체 보기 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
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
                      ? "bg-[#5a6147]/[0.06]"
                      : status === "in_progress"
                        ? "bg-[#795252]/[0.06]"
                        : "bg-[#F6F3F2]"
                  }`}
                >
                  <div
                    onClick={() => setSelectedCategory(key)}
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-black/[0.02] transition-all group rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-[#1A1A1F] font-medium">{label}</span>
                      {total > 0 && (
                        <span className="text-[11px] text-[#B5ADA3]">{done}/{total}</span>
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
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all ${
                              status === s
                                ? `${opt.color} text-white`
                                : "bg-white/60 text-[#B5ADA3] hover:bg-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                      <ChevronRight className="w-3.5 h-3.5 text-[#B5ADA3] opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 시작 가이드 */}
        <div className="col-span-2 bg-white rounded-xl p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-[#795252]" />
            <h3 className="font-serif-kr text-xl font-light text-[#1A1A1F]">시작 가이드</h3>
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
                className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-[#F6F3F2] transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[#F6F3F2] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <item.icon className="w-4 h-4 text-[#795252]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#1A1A1F] font-light leading-snug">{item.text}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="w-3 h-3 text-[#B5ADA3]" />
                    <span className="text-[11px] text-[#B5ADA3]">시작하기</span>
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
