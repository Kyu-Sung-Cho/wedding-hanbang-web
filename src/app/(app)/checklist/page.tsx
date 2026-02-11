"use client";

import { useState } from "react";
import {
  CheckCircle2, Circle, ChevronDown, ChevronRight,
  Sparkles, SkipForward, Clock, MapPin,
} from "lucide-react";
import { useJourneyStore } from "@/stores/journeyStore";
import { CATEGORIES } from "@/constants/categories";
import { CategoryId, CategoryStatus } from "@/types";
import Card from "@/components/ui/Card";

const STATUS_CONFIG: Record<CategoryStatus, { color: string; bg: string; line: string; label: string; icon: string }> = {
  completed: { color: "text-green-600", bg: "bg-green-500", line: "bg-green-500", label: "완료", icon: "check" },
  in_progress: { color: "text-blue-600", bg: "bg-blue-500", line: "bg-blue-500", label: "진행중", icon: "clock" },
  not_started: { color: "text-taupe-400", bg: "bg-gray-300", line: "bg-gray-200", label: "미시작", icon: "circle" },
  skipped: { color: "text-yellow-600", bg: "bg-yellow-400", line: "bg-yellow-400", label: "스킵", icon: "skip" },
};

export default function ChecklistPage() {
  const {
    categoryStatuses,
    checklistProgress,
    toggleChecklistItem,
    setCategoryStatus,
    getCategoryProgress,
    getOverallProgress,
    getDaysUntilWedding,
    weddingDate,
  } = useJourneyStore();

  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(null);

  const overallProgress = getOverallProgress();
  const dday = getDaysUntilWedding();

  const completedCount = Object.values(categoryStatuses).filter((s) => s === "completed" || s === "skipped").length;

  const toggleExpand = (categoryId: CategoryId) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
  };

  const handleCheckItem = (categoryId: CategoryId, itemId: string) => {
    toggleChecklistItem(categoryId, itemId);

    // 체크리스트 진행 상태에 따라 카테고리 상태 자동 업데이트
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return;

    const updatedProgress = { ...checklistProgress };
    const key = `${categoryId}_${itemId}`;
    updatedProgress[key] = !checklistProgress[key];

    const total = category.checklistItems.length;
    const checked = category.checklistItems.filter(
      (item) => updatedProgress[`${categoryId}_${item.id}`]
    ).length;

    if (checked === total && total > 0) {
      setCategoryStatus(categoryId, "completed");
    } else if (checked > 0) {
      setCategoryStatus(categoryId, "in_progress");
    }
  };

  const handleSkipCategory = (categoryId: CategoryId) => {
    setCategoryStatus(categoryId, "skipped");
  };

  const handleResetCategory = (categoryId: CategoryId) => {
    setCategoryStatus(categoryId, "not_started");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 상단 요약 */}
      <Card className="bg-gradient-to-r from-rose-500/10 to-gold/10 border-rose-500/20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium text-noir-800">결혼 준비 체크리스트</h1>
            <p className="mt-1 text-sm text-taupe-500">
              {dday !== null && dday > 0 ? `D-${dday}` : weddingDate ? "결혼식 당일!" : "날짜 미설정"}
              {" · "}
              {completedCount}/{CATEGORIES.length}개 완료
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-3xl font-semibold text-rose-500">{overallProgress}%</p>
            <p className="text-xs text-taupe-400">전체 진행률</p>
          </div>
        </div>
        {/* 전체 프로그레스 바 */}
        <div className="mt-4 h-3 rounded-full bg-white/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-gold transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </Card>

      {/* 로드맵 + 체크리스트 */}
      <div className="relative">
        {CATEGORIES.map((category, index) => {
          const status = (categoryStatuses[category.id] || "not_started") as CategoryStatus;
          const config = STATUS_CONFIG[status];
          const isExpanded = expandedCategory === category.id;
          const isLast = index === CATEGORIES.length - 1;
          const progress = getCategoryProgress(category.id);
          const checkedCount = category.checklistItems.filter(
            (item) => checklistProgress[`${category.id}_${item.id}`]
          ).length;

          return (
            <div key={category.id} className="relative flex gap-4">
              {/* 로드맵 라인 + 노드 */}
              <div className="flex flex-col items-center">
                {/* 노드 */}
                <div
                  className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                    status === "completed"
                      ? "border-green-500 bg-green-500 text-white"
                      : status === "in_progress"
                        ? "border-blue-500 bg-blue-50 text-blue-500"
                        : status === "skipped"
                          ? "border-yellow-400 bg-yellow-50 text-yellow-600"
                          : "border-gray-300 bg-white text-taupe-400"
                  }`}
                >
                  {status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : status === "skipped" ? (
                    <SkipForward className="h-4 w-4" />
                  ) : status === "in_progress" ? (
                    <Clock className="h-4 w-4" />
                  ) : (
                    <span className="text-sm">{category.emoji}</span>
                  )}
                </div>
                {/* 연결 라인 */}
                {!isLast && (
                  <div className="relative w-0.5 flex-1 bg-gray-200">
                    <div
                      className={`absolute left-0 top-0 w-full transition-all duration-500 ${config.line}`}
                      style={{
                        height: status === "completed" || status === "skipped" ? "100%" : status === "in_progress" ? `${progress}%` : "0%",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* 카테고리 카드 */}
              <div className={`mb-4 flex-1 ${isLast ? "" : "pb-2"}`}>
                <button
                  onClick={() => toggleExpand(category.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                    isExpanded
                      ? "border-rose-500/30 bg-white shadow-sm"
                      : status === "completed"
                        ? "border-green-200 bg-green-50/50 hover:bg-green-50"
                        : status === "in_progress"
                          ? "border-blue-200 bg-blue-50/50 hover:bg-blue-50"
                          : "border-platinum bg-white hover:bg-ivory-50"
                  }`}
                >
                  <span className="text-xl">{category.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-noir-800">
                        {category.name}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        status === "completed" ? "bg-green-100 text-green-700" :
                        status === "in_progress" ? "bg-blue-100 text-blue-700" :
                        status === "skipped" ? "bg-yellow-100 text-yellow-700" :
                        "bg-gray-100 text-taupe-400"
                      }`}>
                        {STATUS_CONFIG[status].label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-taupe-400">
                      {category.description}
                      {checkedCount > 0 && ` · ${checkedCount}/${category.checklistItems.length}`}
                    </p>
                  </div>
                  {/* 미니 프로그레스 */}
                  {status === "in_progress" && (
                    <div className="hidden sm:block w-16 h-1.5 rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-taupe-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-taupe-400" />
                  )}
                </button>

                {/* 확장된 체크리스트 */}
                {isExpanded && (
                  <div className="mt-2 rounded-xl border border-platinum bg-white p-4">
                    {/* 정보 */}
                    <div className="mb-4 flex flex-wrap gap-3 text-xs text-taupe-400">
                      {category.estimatedCost && (
                        <span className="flex items-center gap-1 rounded-full bg-ivory-100 px-2.5 py-1">
                          💰 {category.estimatedCost}
                        </span>
                      )}
                      {category.suggestedTiming && (
                        <span className="flex items-center gap-1 rounded-full bg-ivory-100 px-2.5 py-1">
                          📅 D-{category.suggestedTiming.latestDaysBefore}~{category.suggestedTiming.earliestDaysBefore}
                        </span>
                      )}
                    </div>

                    {/* 체크리스트 아이템 */}
                    <div className="space-y-2">
                      {category.checklistItems.map((item) => {
                        const isChecked = !!checklistProgress[`${category.id}_${item.id}`];
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleCheckItem(category.id, item.id)}
                            className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-ivory-50"
                          >
                            {isChecked ? (
                              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                            ) : (
                              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-300" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${isChecked ? "text-taupe-400 line-through" : "text-noir-800"}`}>
                                {item.title}
                                {item.isRequired && (
                                  <span className="ml-1.5 text-[10px] text-rose-500">필수</span>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-taupe-400">{item.description}</p>
                              {item.aiTip && (
                                <p className="mt-1 flex items-center gap-1 text-xs text-rose-500/80">
                                  <Sparkles className="h-3 w-3" />
                                  {item.aiTip}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* 팁 & 실수 */}
                    {(category.tips.length > 0 || category.commonMistakes.length > 0) && (
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {category.tips.length > 0 && (
                          <div className="rounded-lg bg-blue-50/60 p-3">
                            <p className="mb-1.5 text-[10px] font-medium uppercase text-blue-600">💡 팁</p>
                            {category.tips.map((tip, i) => (
                              <p key={i} className="text-xs text-blue-800/70">· {tip}</p>
                            ))}
                          </div>
                        )}
                        {category.commonMistakes.length > 0 && (
                          <div className="rounded-lg bg-red-50/60 p-3">
                            <p className="mb-1.5 text-[10px] font-medium uppercase text-red-600">⚠️ 주의</p>
                            {category.commonMistakes.map((mistake, i) => (
                              <p key={i} className="text-xs text-red-800/70">· {mistake}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 액션 버튼 */}
                    <div className="mt-4 flex gap-2 border-t border-platinum pt-3">
                      {status !== "skipped" && (
                        <button
                          onClick={() => handleSkipCategory(category.id)}
                          className="rounded-lg bg-ivory-100 px-3 py-1.5 text-xs text-taupe-500 transition-colors hover:bg-ivory-200"
                        >
                          건너뛰기
                        </button>
                      )}
                      {(status === "skipped" || status === "completed") && (
                        <button
                          onClick={() => handleResetCategory(category.id)}
                          className="rounded-lg bg-ivory-100 px-3 py-1.5 text-xs text-taupe-500 transition-colors hover:bg-ivory-200"
                        >
                          초기화
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
