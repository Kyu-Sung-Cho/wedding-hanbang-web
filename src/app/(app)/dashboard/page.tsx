"use client";

import { useRouter } from "next/navigation";
import {
  Heart, TrendingUp, CheckCircle2, Clock,
  ArrowRight, Sparkles, Calendar, CalendarDays, RotateCcw,
} from "lucide-react";
import { useJourneyStore } from "@/stores/journeyStore";
import { useScheduleStore } from "@/stores/scheduleStore";
import { useBudgetStore } from "@/stores/budgetStore";
import { CATEGORIES } from "@/constants/categories";
import { formatDday, formatBudgetAmount } from "@/utils/format";
import { CategoryId, CategoryStatus } from "@/types";
import Card from "@/components/ui/Card";

export default function DashboardPage() {
  const router = useRouter();
  const {
    weddingDate,
    getDaysUntilWedding,
    getOverallProgress,
    categoryStatuses,
    setCategoryStatus,
  } = useJourneyStore();

  const schedules = useScheduleStore((s) => s.schedules);
  const { totalBudget, getTotalSpent } = useBudgetStore();

  const dday = getDaysUntilWedding();
  const overallProgress = getOverallProgress();
  const totalSpent = getTotalSpent();

  // 카테고리 상태별 카운트
  const statusCounts = {
    completed: Object.values(categoryStatuses).filter((s) => s === "completed").length,
    in_progress: Object.values(categoryStatuses).filter((s) => s === "in_progress").length,
    not_started: Object.values(categoryStatuses).filter((s) => s === "not_started").length,
    skipped: Object.values(categoryStatuses).filter((s) => s === "skipped").length,
  };

  // 오늘 일정
  const today = new Date().toISOString().split("T")[0];
  const todaySchedules = schedules.filter((s) => s.date === today);

  // 다가오는 일정 (7일 이내)
  const upcomingSchedules = schedules
    .filter((s) => {
      const scheduleDate = new Date(s.date);
      const now = new Date();
      const diff = (scheduleDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 7 && !s.isCompleted;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  const statusColor: Record<CategoryStatus, string> = {
    completed: "bg-green-100 text-green-700",
    in_progress: "bg-blue-100 text-blue-700",
    not_started: "bg-gray-100 text-taupe-500",
    skipped: "bg-yellow-100 text-yellow-700",
  };

  const statusLabel: Record<CategoryStatus, string> = {
    completed: "완료",
    in_progress: "진행중",
    not_started: "미시작",
    skipped: "스킵",
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* D-Day 및 전체 진행 현황 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* D-Day 카드 */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-rose-500 to-gold">
          <div className="relative z-10">
            <Heart className="mb-2 h-6 w-6 text-white/80" />
            <p className="text-sm text-white/80">결혼식까지</p>
            <p className="mt-1 font-display text-3xl font-semibold text-white">
              {dday !== null ? formatDday(dday) : "날짜 미설정"}
            </p>
            {weddingDate && (
              <p className="mt-1 text-xs text-white/70">
                {new Date(weddingDate).toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
        </Card>

        {/* 전체 진행률 */}
        <Card>
          <TrendingUp className="mb-2 h-6 w-6 text-rose-500" />
          <p className="text-sm text-taupe-500">전체 진행률</p>
          <p className="mt-1 font-display text-3xl font-semibold text-noir-800">
            {overallProgress}%
          </p>
          <div className="mt-2 h-2 rounded-full bg-ivory-200">
            <div
              className="h-full rounded-full bg-rose-500 transition-all"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </Card>

        {/* 완료 카테고리 */}
        <Card>
          <CheckCircle2 className="mb-2 h-6 w-6 text-green-500" />
          <p className="text-sm text-taupe-500">완료</p>
          <p className="mt-1 font-display text-3xl font-semibold text-noir-800">
            {statusCounts.completed}
            <span className="text-lg text-taupe-400">
              /{CATEGORIES.length}
            </span>
          </p>
          <p className="mt-1 text-xs text-taupe-400">
            {statusCounts.in_progress}개 진행중
          </p>
        </Card>

        {/* 예산 현황 */}
        <Card>
          <Sparkles className="mb-2 h-6 w-6 text-gold" />
          <p className="text-sm text-taupe-500">예산 사용</p>
          <p className="mt-1 font-display text-3xl font-semibold text-noir-800">
            {formatBudgetAmount(totalSpent)}
          </p>
          {totalBudget > 0 && (
            <p className="mt-1 text-xs text-taupe-400">
              / {formatBudgetAmount(totalBudget)}
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 카테고리 현황 */}
        <div className="lg:col-span-2">
          <Card padding="none">
            <div className="flex items-center justify-between border-b border-platinum px-6 py-4">
              <h2 className="text-base font-medium text-noir-800">
                카테고리별 현황
              </h2>
              <span className="text-xs text-taupe-400">
                {CATEGORIES.length}개 카테고리
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-platinum sm:grid-cols-3 md:grid-cols-4">
              {CATEGORIES.map((category) => {
                const status =
                  categoryStatuses[category.id] || "not_started";
                return (
                  <div
                    key={category.id}
                    className="flex flex-col items-center gap-2 bg-white p-4"
                  >
                    {/* 이모지 + 이름 → 체크리스트로 이동 */}
                    <button
                      onClick={() => router.push(`/checklist?open=${category.id}`)}
                      className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-ivory-50"
                    >
                      <span className="text-2xl">{category.emoji}</span>
                      <span className="text-xs font-medium text-noir-800 text-center">
                        {category.name}
                      </span>
                    </button>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor[status]}`}
                    >
                      {statusLabel[status]}
                    </span>
                    {/* 액션 버튼 */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => router.push(`/schedule?category=${category.id}`)}
                        className="rounded-md p-1 text-taupe-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                        title="일정"
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                      </button>
                      {status !== "completed" ? (
                        <button
                          onClick={() => setCategoryStatus(category.id as CategoryId, "completed")}
                          className="rounded-md p-1 text-taupe-400 transition-colors hover:bg-green-50 hover:text-green-500"
                          title="완료"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setCategoryStatus(category.id as CategoryId, "not_started")}
                          className="rounded-md p-1 text-taupe-400 transition-colors hover:bg-gray-100 hover:text-noir-800"
                          title="초기화"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* 오른쪽 사이드 */}
        <div className="space-y-6">
          {/* 오늘 일정 */}
          <Card padding="none">
            <div className="flex items-center justify-between border-b border-platinum px-6 py-4">
              <h2 className="text-base font-medium text-noir-800">
                오늘 일정
              </h2>
              <button
                onClick={() => router.push("/schedule")}
                className="text-xs text-rose-500 hover:underline"
              >
                전체보기
              </button>
            </div>
            <div className="p-4">
              {todaySchedules.length === 0 ? (
                <p className="py-4 text-center text-sm text-taupe-400">
                  오늘 일정이 없습니다
                </p>
              ) : (
                <div className="space-y-3">
                  {todaySchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="flex items-center gap-3 rounded-xl bg-ivory-50 p-3"
                    >
                      <Clock className="h-4 w-4 shrink-0 text-taupe-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-noir-800">
                          {schedule.title}
                        </p>
                        {schedule.time && (
                          <p className="text-xs text-taupe-400">
                            {schedule.time}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 다가오는 일정 */}
          <Card padding="none">
            <div className="flex items-center justify-between border-b border-platinum px-6 py-4">
              <h2 className="text-base font-medium text-noir-800">
                다가오는 일정
              </h2>
            </div>
            <div className="p-4">
              {upcomingSchedules.length === 0 ? (
                <p className="py-4 text-center text-sm text-taupe-400">
                  예정된 일정이 없습니다
                </p>
              ) : (
                <div className="space-y-3">
                  {upcomingSchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-ivory-50"
                    >
                      <Calendar className="h-4 w-4 shrink-0 text-taupe-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-noir-800">
                          {schedule.title}
                        </p>
                        <p className="text-xs text-taupe-400">
                          {new Date(schedule.date).toLocaleDateString("ko-KR", {
                            month: "short",
                            day: "numeric",
                          })}
                          {schedule.time ? ` ${schedule.time}` : ""}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-taupe-400" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* 빠른 액션 */}
          <Card padding="none">
            <div className="border-b border-platinum px-6 py-4">
              <h2 className="text-base font-medium text-noir-800">
                빠른 액션
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { label: "AI 플래너와 상담하기", href: "/chat", emoji: "💬" },
                { label: "예산 설정하기", href: "/budget", emoji: "💰" },
                { label: "일정 추가하기", href: "/schedule", emoji: "📅" },
                { label: "업체 탐색하기", href: "/vendors", emoji: "🏪" },
              ].map((action) => (
                <button
                  key={action.href}
                  onClick={() => router.push(action.href)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-ivory-50"
                >
                  <span className="text-lg">{action.emoji}</span>
                  <span className="flex-1 text-sm text-noir-800">
                    {action.label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-taupe-400" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
