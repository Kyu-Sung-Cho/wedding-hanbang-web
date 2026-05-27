"use client";

import { useState } from "react";
import {
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
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift,
  Sparkles, Flower, Heart, Mic, Box,
};

// Atelier 스타일: 왼쪽 스트립 + 로즈 그라데이션 (긴급도에 따른 농도 차이)
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
    bar: "bg-gradient-to-r from-[#795252] to-[#946a6a]",
    badgeBg: "bg-[#795252]",
    badgeText: "text-white",
  },
  urgent: {
    stripBg: "bg-[#946a6a]",
    iconBox: "bg-[#946a6a]/10",
    iconColor: "text-[#946a6a]",
    bar: "bg-gradient-to-r from-[#946a6a] to-[#b48585]",
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

  return (
    <div
      className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6 overflow-hidden animate-fade-in"
    >
      {/* 헤더 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between gap-3 px-5 py-4 hover:bg-[#FAFAF8] transition-colors sm:px-6"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock className="w-5 h-5 shrink-0 text-[#795252]" />
            <h3 className="min-w-0 truncate font-serif-kr text-[18px] font-light text-[#1A1A1F]">
              임박 체크리스트
            </h3>
            <span className="shrink-0 text-sm text-[#B5ADA3]">{items.length}건</span>
          </div>
          {(overdueCount > 0 || urgentCount > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
              {overdueCount > 0 && (
                <span className="rounded-full bg-[#795252] px-2 py-0.5 text-xs font-medium text-white">
                  {overdueCount} 초과
                </span>
              )}
              {urgentCount > 0 && (
                <span className="rounded-full bg-[#946a6a] px-2 py-0.5 text-xs font-medium text-white">
                  {urgentCount} 긴급
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

                  <div className="grid flex-1 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:px-5">
                    {/* 아이콘 */}
                    <div className={`w-11 h-11 rounded-xl ${styles.iconBox} flex items-center justify-center`}>
                      <IconComp className={`w-5 h-5 ${styles.iconColor}`} />
                    </div>

                    {/* 카테고리 정보 */}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-serif-kr text-base font-normal text-[#1A1A1F]">
                          {item.label}
                        </span>
                        <span className="shrink-0 text-sm text-[#B5ADA3]">
                          {item.doneCount}/{item.totalCount}
                        </span>
                      </div>
                      {/* 진행률 바 */}
                      <div className="w-full h-1.5 bg-[#F6F3F2] rounded-full mt-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${styles.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* D-day 뱃지 */}
                    <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${styles.badgeBg} ${styles.badgeText}`}>
                      {item.deadlineDaysLeft <= 0
                        ? `${Math.abs(item.deadlineDaysLeft)}일 초과`
                        : `D-${item.deadlineDaysLeft}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
