"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { PostSort, TimePeriod } from "@/types/community.types";

interface SortSelectorProps {
  sort: PostSort;
  period: TimePeriod;
  onSortChange: (sort: PostSort) => void;
  onPeriodChange: (period: TimePeriod) => void;
}

const SORT_OPTIONS: { key: PostSort; label: string }[] = [
  { key: "hot", label: "인기순" },
  { key: "new", label: "최신순" },
  { key: "top", label: "추천순" },
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLabel = SORT_OPTIONS.find((o) => o.key === sort)?.label ?? "인기순";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[#928980] bg-white border border-[#F5F2ED] rounded-lg hover:border-[#B5ADA3] transition-colors"
      >
        {currentLabel}
        {sort === "top" && (
          <span className="text-[#C4967E]">
            &middot; {PERIOD_OPTIONS.find((p) => p.key === period)?.label}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-[#F5F2ED] rounded-xl shadow-lg py-1 z-20">
          {SORT_OPTIONS.map((option) => (
            <div key={option.key}>
              <button
                type="button"
                onClick={() => {
                  onSortChange(option.key);
                  if (option.key !== "top") {
                    setOpen(false);
                  }
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  sort === option.key
                    ? "text-[#C4967E] font-medium bg-[#C4967E]/5"
                    : "text-[#1A1A1F] hover:bg-[#FAF8F5]"
                }`}
              >
                {option.label}
              </button>

              {/* 추천순 선택 시 기간 서브옵션 */}
              {option.key === "top" && sort === "top" && (
                <div className="border-t border-[#F5F2ED] mx-2 py-1">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        onPeriodChange(p.key);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-6 py-1.5 text-xs transition-colors ${
                        period === p.key
                          ? "text-[#C4967E] font-medium"
                          : "text-[#928980] hover:text-[#1A1A1F]"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
