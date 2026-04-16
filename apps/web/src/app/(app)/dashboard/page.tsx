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
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { CHECKLIST_MAP, CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { CategoryChecklistTemplate } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";

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
  completed: { label: "완료", color: "bg-[#2E7D5A]" },
  in_progress: { label: "진행중", color: "bg-rose-500" },
  not_started: { label: "예정", color: "bg-taupe-400" },
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

  // 예산 포맷
  const budget = journey?.total_budget ?? 0;
  const budgetStr =
    budget >= 10000
      ? `₩${(budget / 10000).toLocaleString()}만원`
      : `₩${budget.toLocaleString()}`;

  const userName = profile?.name ?? "사용자";
  const partnerName = partner?.name;
  const coupleStr = partnerName
    ? `${userName} & ${partnerName}`
    : userName;

  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";

  // 긴급 태스크 계산
  const urgentTasks = useMemo(
    () => getUrgentTasks(dday, progress as Record<string, { status?: string; checklist?: { id: string; label: string; done: boolean }[] }>, CATEGORY_CHECKLISTS),
    [dday, progress]
  );

  // 커플 활동 피드 (파트너의 진행 상태 변경 기반)
  const partnerActivities = useMemo(() => {
    if (!partner) return [];

    // progress에서 완료/진행중인 카테고리를 파트너 활동으로 표시
    // 실제 서비스에서는 activity log 테이블이 있겠지만, 현재는 progress 데이터로 추론
    const activities: { key: string; label: string; status: string; statusLabel: string }[] = [];
    for (const [key, item] of Object.entries(progress)) {
      if (key.startsWith("__")) continue; // __events 같은 메타 키 제외
      const catItem = item as { status?: string };
      if (!catItem?.status || catItem.status === "not_started") continue;
      const label = CATEGORY_LABELS[key];
      if (!label) continue;
      const statusLabel = catItem.status === "completed" ? "완료" : "진행중";
      activities.push({ key, label, status: catItem.status, statusLabel });
    }

    // 최근 3개까지만 표시
    return activities.slice(0, 3);
  }, [partner, progress]);

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 파트너 미연동 안내 */}
      {couple && !partner && inviteCode && (
        <div
          className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 mb-6 flex items-center justify-between max-md:flex-col max-md:gap-3 animate-fade-in"
        >
          <div>
            <p className="text-[14px] font-medium text-noir-800">
              파트너에게 초대 코드를 공유하세요
            </p>
            <p className="text-[12px] text-taupe-400 mt-0.5">
              파트너가 회원가입 시 이 코드를 입력하면 커플 연동됩니다
            </p>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-xl border border-black/[0.06] hover:border-rose-500/30 transition-all"
          >
            <span className="font-mono text-[15px] font-bold text-noir-800 tracking-wider">
              {inviteCode}
            </span>
            {copied ? (
              <Check className="w-4 h-4 text-[#2E7D5A]" />
            ) : (
              <Copy className="w-4 h-4 text-taupe-400" />
            )}
          </button>
        </div>
      )}

      {/* D-day 히어로 */}
      <div
        className="bg-gradient-to-br from-noir-800 to-noir-soft rounded-3xl p-10 max-md:p-6 mb-8 relative overflow-hidden animate-fade-in"
      >
        <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(196,150,126,0.12),transparent)] rounded-full" />
        <div className="relative z-10 flex items-center justify-between max-md:flex-col max-md:text-center max-md:gap-6">
          <div>
            <p className="text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-3">
              Wedding Day
            </p>
            <div className="flex items-baseline gap-3 max-md:justify-center">
              <span className="font-display text-[72px] max-md:text-[56px] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent leading-none">
                {dday !== null && dday > 0
                  ? `D-${dday}`
                  : dday === 0
                    ? "D-Day"
                    : dday !== null && dday < 0
                      ? `D+${Math.abs(dday)}`
                      : "미정"}
              </span>
            </div>
            <p className="text-white/40 text-[14px] font-light mt-3">
              {dateStr} · {coupleStr}
            </p>
          </div>
          <div className="text-center">
            <div className="relative w-[120px] h-[120px] mx-auto">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#progressGrad)" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${progressPercent * 3.27} ${327 - progressPercent * 3.27}`}
                />
                <defs>
                  <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#C4967E" />
                    <stop offset="100%" stopColor="#C9A96E" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-[28px] font-light text-white">{progressPercent}%</span>
                <span className="text-[10px] text-white/30">진행률</span>
              </div>
            </div>
            <p className="text-white/40 text-[12px] mt-2">{totalDone}/{totalItems} 항목 완료</p>
          </div>
        </div>
      </div>

      {/* 빠른 액션 */}
      <div
        className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1 animate-fade-in"
      >
        {[
          { href: "/chat", icon: MessageCircle, label: "아모라에게 물어보기", desc: "결혼 준비 뭐든 상담하세요", accent: "from-rose-500 to-gold" },
          { href: "/budget", icon: Wallet, label: "예산 현황 보기", desc: `총 예산 ${budgetStr}`, accent: "from-[#2E7D5A] to-[#4CAF80]" },
          { href: "/schedule", icon: CalendarCheck, label: "일정 관리", desc: "체크리스트를 확인하세요", accent: "from-gold to-[#DCC9A0]" },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group bg-white rounded-2xl p-6 border border-black/[0.04] hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition-all duration-300"
          >
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${action.accent} flex items-center justify-center mb-4`}>
              <action.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-[15px] font-medium text-noir-800 mb-1">{action.label}</h3>
            <p className="text-[12px] text-taupe-500 font-light">{action.desc}</p>
          </Link>
        ))}
      </div>

      {/* 지금 해야 할 것 + 커플 활동 */}
      {(urgentTasks.length > 0 || partnerActivities.length > 0) && (
        <div className="grid grid-cols-5 gap-6 mb-8 max-lg:grid-cols-1 animate-fade-in">
          {/* 지금 해야 할 것 */}
          {urgentTasks.length > 0 && (
            <div className={`${partnerActivities.length > 0 ? "col-span-3" : "col-span-5"} max-lg:col-span-1 bg-white rounded-2xl p-6 border border-black/[0.04]`}>
              <div className="flex items-center gap-2 mb-5">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">지금 해야 할 것</h3>
              </div>
              <div className="flex flex-col gap-3">
                {urgentTasks.map((task) => {
                  const IconComp = CATEGORY_ICONS[task.key] ?? CalendarCheck;
                  return (
                    <div
                      key={task.key}
                      onClick={() => setSelectedCategory(task.key)}
                      className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border cursor-pointer hover:shadow-sm transition-all ${task.urgencyBg} ${task.urgencyBorder}`}
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
                          <span className="text-[14px] font-medium text-noir-800">{task.label}</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${task.urgencyColor} ${
                            task.urgency === "overdue"
                              ? "bg-red-100"
                              : task.urgency === "soon"
                                ? "bg-amber-100"
                                : "bg-emerald-100"
                          }`}>
                            {task.urgencyLabel}
                          </span>
                        </div>
                        <p className="text-[12px] text-taupe-500 mt-0.5">{task.deadlineText}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-taupe-400 flex-shrink-0" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 커플 활동 */}
          {partnerActivities.length > 0 && (
            <div className={`${urgentTasks.length > 0 ? "col-span-2" : "col-span-5"} max-lg:col-span-1 bg-white rounded-2xl p-6 border border-black/[0.04]`}>
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-4 h-4 text-rose-500" />
                <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">커플 활동</h3>
              </div>
              <div className="flex flex-col gap-2">
                {partnerActivities.map((activity) => {
                  const IconComp = CATEGORY_ICONS[activity.key] ?? CalendarCheck;
                  return (
                    <div
                      key={activity.key}
                      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-ivory-50 border border-black/[0.02]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <IconComp className="w-4 h-4 text-rose-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-noir-800 font-light leading-snug">
                          <span className="font-medium">{partner?.name ?? "파트너"}</span>
                          {activity.status === "completed"
                            ? <span>가 <span className="font-medium text-[#2E7D5A]">{activity.label}</span>을 <span className="text-[#2E7D5A] font-medium">완료</span>했어요</span>
                            : <span>가 <span className="font-medium text-rose-500">{activity.label}</span>을 <span className="text-rose-500 font-medium">진행중</span>으로 변경했어요</span>
                          }
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Clock className="w-3 h-3 text-taupe-400" />
                          <span className="text-[11px] text-taupe-400">최근 활동</span>
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

      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 카테고리 현황 */}
        <div
          className="col-span-3 bg-white rounded-2xl p-6 border border-black/[0.04] animate-fade-in"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">카테고리별 진행 상태</h3>
            <Link href="/schedule" className="text-[12px] text-rose-500 font-medium flex items-center gap-1 hover:gap-2 transition-all">
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
                  className={`rounded-xl border transition-all ${
                    status === "completed"
                      ? "border-[#2E7D5A]/20 bg-[#2E7D5A]/[0.03]"
                      : status === "in_progress"
                        ? "border-rose-500/20 bg-rose-500/[0.03]"
                        : "border-black/[0.02] bg-ivory-50"
                  }`}
                >
                  <div
                    onClick={() => setSelectedCategory(key)}
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-black/[0.02] transition-all group rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-noir-800 font-medium">{label}</span>
                      {total > 0 && (
                        <span className="text-[11px] text-taupe-400">{done}/{total}</span>
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
                                : "bg-black/[0.04] text-taupe-400 hover:bg-black/[0.08]"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                      <ChevronRight className="w-3.5 h-3.5 text-taupe-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 최근 활동 / 안내 */}
        <div
          className="col-span-2 bg-white rounded-2xl p-6 border border-black/[0.04] animate-fade-in"
        >
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-rose-500" />
            <h3 className="font-serif-kr text-[17px] font-normal text-noir-800">시작 가이드</h3>
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
                className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-ivory-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-ivory-warm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <item.icon className="w-4 h-4 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-noir-800 font-light leading-snug">{item.text}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="w-3 h-3 text-taupe-400" />
                    <span className="text-[11px] text-taupe-400">시작하기</span>
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
    </div>
  );
}
