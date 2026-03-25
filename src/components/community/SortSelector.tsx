"use client";

import { Flame, Sparkles, TrendingUp } from "lucide-react";
import type { PostSort, TimePeriod } from "@/types/community.types";

interface SortSelectorProps {
  sort: PostSort;
  period: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
}

const SORT_OPTIONS: { key: PostSort; label: string; icon: typeof Flame }[] = [
  { key: "hot", label: "인기", icon: Flame },
  { key: "new", label: "최신", icon: Sparkles },
  { key: "top", label: "추천", icon: TrendingUp },
];

const PERIOD_OPTIONS: { key: TimePeriod; label: string }[] = [
  { key: "week", label: "이번 주" },
  { key: "month", label: "이번 달" },
  { key: "all", label: "전체" },
];

export default function SortSelector({
  sort,
  period,
  onSortChange,
  onPeriodChange,
}: SortSelectorProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {SORT_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = sort === option.key;

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSortChange(option.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-all ${
              isActive
                ? "bg-[#F4F6F8] font-medium text-[#1c1c1e]"
                : "text-[#6B7280] hover:bg-[#F4F6F8]"
            }`}
          >
            <Icon className="w-4 h-4" />
            {option.label}
          </button>
        );
      })}

      {/* 추천순 선택 시 기간 서브버튼 */}
      {sort === "top" && (
        <>
          <span className="text-[#E5E7EB] mx-0.5">|</span>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriodChange(p.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                period === p.key
                  ? "bg-[#F4F6F8] font-medium text-[#1c1c1e]"
                  : "text-[#6B7280] hover:bg-[#F4F6F8]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
