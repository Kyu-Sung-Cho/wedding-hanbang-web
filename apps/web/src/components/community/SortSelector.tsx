"use client";

import type { PostSort, TimePeriod } from "@/types/community.types";

interface SortSelectorProps {
  sort: PostSort;
  period: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
}

const SORT_OPTIONS: { key: PostSort; label: string }[] = [
  { key: "hot", label: "인기" },
  { key: "new", label: "최신" },
  { key: "top", label: "추천" },
  { key: "my_cohort", label: "내 동기글" },
  { key: "my_posts", label: "내 글" },
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
    <div className="flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1 sm:justify-end sm:pb-0">
      {SORT_OPTIONS.map((option) => {
        const isActive = sort === option.key;

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSortChange(option.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors duration-200 sm:text-sm ${
              isActive
                ? "bg-[#1b1c1c] text-white"
                : "bg-white text-[#928980] hover:bg-[#f6f3f2] hover:text-[#504444]"
            }`}
          >
            {option.label}
          </button>
        );
      })}

      {sort === "top" && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-[#e4e2e1]" />
          {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPeriodChange(p.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors duration-200 sm:text-sm ${
                  period === p.key
                    ? "bg-[#795252] text-white"
                    : "bg-white text-[#928980] hover:bg-[#f6f3f2] hover:text-[#504444]"
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
