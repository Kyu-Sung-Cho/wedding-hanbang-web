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
    <div className="flex items-center gap-0 flex-wrap">
      {SORT_OPTIONS.map((option, idx) => {
        const isActive = sort === option.key;

        return (
          <span key={option.key} className="flex items-center">
            {idx > 0 && <span className="text-[#B5ADA3] mx-2 text-xs select-none">&middot;</span>}
            <button
              type="button"
              onClick={() => onSortChange(option.key)}
              className={`text-sm transition-colors duration-200 ${
                isActive
                  ? "text-[#1A1A1F] font-medium"
                  : "text-[#B5ADA3] hover:text-[#878680]"
              }`}
            >
              {option.label}
            </button>
          </span>
        );
      })}

      {/* 추천순 선택 시 기간 서브버튼 */}
      {sort === "top" && (
        <>
          <span className="text-[#B5ADA3] mx-3 text-xs select-none">|</span>
          {PERIOD_OPTIONS.map((p, idx) => (
            <span key={p.key} className="flex items-center">
              {idx > 0 && <span className="text-[#B5ADA3] mx-2 text-xs select-none">&middot;</span>}
              <button
                type="button"
                onClick={() => onPeriodChange(p.key)}
                className={`text-sm transition-colors duration-200 ${
                  period === p.key
                    ? "text-[#1A1A1F] font-medium"
                    : "text-[#B5ADA3] hover:text-[#878680]"
                }`}
              >
                {p.label}
              </button>
            </span>
          ))}
        </>
      )}
    </div>
  );
}
