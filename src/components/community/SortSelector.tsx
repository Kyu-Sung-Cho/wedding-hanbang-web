"use client";

import { Flame, Sparkles, TrendingUp } from "lucide-react";
import type { PostSort, TimePeriod } from "@/types/community.types";

interface SortSelectorProps {
  sort: PostSort;
  period: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
}

const SORT_OPTIONS: {
  key: PostSort;
  label: string;
  icon: typeof Flame;
  activeClass: string;
}[] = [
  {
    key: "hot",
    label: "인기",
    icon: Flame,
    activeClass:
      "bg-orange-50 text-[#FF4500] border border-orange-200 font-semibold",
  },
  {
    key: "new",
    label: "최신",
    icon: Sparkles,
    activeClass:
      "bg-blue-50 text-[#2563EB] border border-blue-200 font-semibold",
  },
  {
    key: "top",
    label: "추천",
    icon: TrendingUp,
    activeClass:
      "bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold",
  },
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
            className={`flex items-center gap-1 px-3 py-1 text-sm rounded-lg transition-all duration-200 ${
              isActive ? option.activeClass : "text-[#6B7280] hover:bg-[#F4F6F8]"
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
          <span className="text-[#E5E7EB] mx-1">|</span>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriodChange(p.key)}
              className={`px-2 py-0.5 text-sm rounded-full transition-all duration-200 ${
                period === p.key
                  ? "bg-[#1c1c1e] text-white font-semibold"
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
