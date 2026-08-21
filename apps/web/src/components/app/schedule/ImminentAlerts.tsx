"use client";

import { useState } from "react";
import {
  FileText,
  Clock,
  ChevronDown,
  ChevronUp,
  Users,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Key,
  Mail,
  Gift,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
} from "lucide-react";
import type { ImminentCategory } from "@/utils/imminentChecklist";

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift,
  Sparkles, Flower, Heart, Mic, Box,
};

// 기본 일정과의 거리만 구분한다. 실제 업체·가족 일정의 긴급도를 판정하지 않는다.
const URGENCY_STYLES: Record<string, {
  stripBg: string;
  iconBox: string;
  iconColor: string;
  bar: string;
  badgeBg: string;
  badgeText: string;
}> = {
  overdue: {
    stripBg: "bg-[#795252]",
    iconBox: "bg-[#795252]/10",
    iconColor: "text-[#795252]",
    bar: "bg-[#795252]",
    badgeBg: "bg-[#795252]",
    badgeText: "text-white",
  },
  urgent: {
    stripBg: "bg-[#946a6a]",
    iconBox: "bg-[#946a6a]/10",
    iconColor: "text-[#946a6a]",
    bar: "bg-[#946a6a]",
    badgeBg: "bg-[#946a6a]",
    badgeText: "text-white",
  },
  soon: {
    stripBg: "bg-[#C9A96E]",
    iconBox: "bg-[#C9A96E]/10",
    iconColor: "text-[#C9A96E]",
    bar: "bg-[#C9A96E]",
    badgeBg: "bg-[#C9A96E]",
    badgeText: "text-white",
  },
};

interface Props {
  items: ImminentCategory[];
  onCategoryClick: (key: string) => void;
}

export default function ImminentAlerts({ items, onCategoryClick }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (items.length === 0) return null;

  const overdueCount = items.filter((i) => i.urgency === "overdue").length;
  const urgentCount = items.filter((i) => i.urgency === "urgent").length;
  const needsScheduleCount = items.filter((i) => !i.hasScheduledEvent).length;

  return (
    <div
      className="overflow-hidden rounded-[14px] border border-[#eadfc9]/70 bg-[#fffdf7] animate-fade-in"
    >
      {/* 헤더 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock className="h-4 w-4 shrink-0 text-[#36534E]" />
            <h3 className="min-w-0 truncate text-[14px] font-semibold text-[#071629]">
              날짜를 정할 항목
            </h3>
            <span className="shrink-0 text-[12px] font-medium text-[#7a8290]">{items.length}건</span>
          </div>
          {(overdueCount > 0 || urgentCount > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
              {needsScheduleCount > 0 && (
                <span className="rounded-full bg-[#36534E] px-2 py-0.5 text-[11px] font-semibold text-white">
                  {needsScheduleCount} 일정 필요
                </span>
              )}
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="mt-0.5 w-5 h-5 shrink-0 text-[#B5ADA3]" />
        ) : (
          <ChevronDown className="mt-0.5 w-5 h-5 shrink-0 text-[#B5ADA3]" />
        )}
      </button>

      {/* 항목 목록 */}
      {expanded && (
        <div
          className="overflow-hidden"
        >
          <div className="divide-y divide-[#F6F3F2]">
            {items.map((item) => {
              const styles = URGENCY_STYLES[item.urgency];
              const IconComp = ICON_MAP[item.icon] ?? Clock;
              const pct = item.totalCount > 0
                ? Math.round((item.doneCount / item.totalCount) * 100)
                : 0;

              return (
                <button
                  key={item.key}
                  onClick={() => onCategoryClick(item.key)}
                  className="w-full flex items-stretch hover:bg-[#FAFAF8] transition-colors text-left group"
                >
                  {/* 좌측 컬러 스트립 */}
                  <div className={`w-1 flex-shrink-0 ${styles.stripBg}`} />

                  <div className="grid flex-1 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 px-3 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]">
                    {/* 아이콘 */}
                    <div className={`flex h-9 w-9 items-center justify-center rounded-[12px] ${styles.iconBox}`}>
                      <IconComp className={`h-4 w-4 ${styles.iconColor}`} />
                    </div>

                    {/* 카테고리 정보 */}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-[14px] font-semibold text-[#071629]">
                          {item.label}
                        </span>
                        <span className="shrink-0 text-[12px] font-medium text-[#7a8290]">
                          {item.doneCount}/{item.totalCount}
                        </span>
                      </div>
                      {/* 진행률 바 */}
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
                        <div
                          className={`h-full rounded-full transition-all ${styles.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* 실제 날짜를 정해야 하는 항목 */}
                    <span className={`col-start-2 w-fit rounded-full px-2.5 py-1 text-[12px] font-semibold sm:col-start-auto ${styles.badgeBg} ${styles.badgeText}`}>
                      일정 필요
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="border-t border-[#eadfc9]/70 px-4 py-3 text-[11px] leading-5 text-[#7a8290]">
            표시 순서는 기본 일정 기준이며, 업체나 가족과 정한 실제 날짜가 우선입니다.
          </p>
        </div>
      )}
    </div>
  );
}
