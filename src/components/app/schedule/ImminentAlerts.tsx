"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
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

// 앱 디자인 시스템에 맞춘 urgency 스타일
// overdue: rose-600(진한 로즈) / urgent: rose-500 / soon: gold
const URGENCY_STYLES: Record<string, {
  iconBox: string;
  iconColor: string;
  bar: string;
  badgeText: string;
  badgeBg: string;
}> = {
  overdue: {
    iconBox: "bg-[#9A6B62]/10 border-[#9A6B62]/20",
    iconColor: "text-[#9A6B62]",
    bar: "bg-[#9A6B62]",
    badgeText: "text-white",
    badgeBg: "bg-[#9A6B62]",
  },
  urgent: {
    iconBox: "bg-[#C4967E]/10 border-[#C4967E]/20",
    iconColor: "text-[#C4967E]",
    bar: "bg-[#C4967E]",
    badgeText: "text-white",
    badgeBg: "bg-[#C4967E]",
  },
  soon: {
    iconBox: "bg-[#C9A96E]/10 border-[#C9A96E]/20",
    iconColor: "text-[#C9A96E]",
    bar: "bg-[#C9A96E]",
    badgeText: "text-white",
    badgeBg: "bg-[#C9A96E]",
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.02 }}
      className="bg-white rounded-2xl border border-black/[0.04] mb-6 overflow-hidden"
    >
      {/* 헤더 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 border-b border-black/[0.03] hover:bg-ivory-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#C4967E]" />
          <span className="text-[25px] font-medium text-noir-800">임박 체크리스트</span>
          <span className="text-[23px] text-taupe-400">{items.length}건</span>
          {overdueCount > 0 && (
            <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#9A6B62] text-white font-medium">
              {overdueCount} 초과
            </span>
          )}
          {urgentCount > 0 && (
            <span className="text-[25px] px-2 py-0.5 rounded-full bg-[#C4967E]/80 text-white font-medium">
              {urgentCount} 긴급
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-taupe-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-taupe-400" />
        )}
      </button>

      {/* 항목 목록 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-black/[0.02]">
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
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-ivory-50 transition-colors text-left group"
                  >
                    {/* 아이콘 */}
                    <div className={`w-8 h-8 rounded-lg ${styles.iconBox} border flex items-center justify-center flex-shrink-0`}>
                      <IconComp className={`w-4 h-4 ${styles.iconColor}`} />
                    </div>

                    {/* 카테고리 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[25px] font-medium text-noir-800">{item.label}</span>
                        <span className="text-[23px] text-taupe-400">
                          {item.doneCount}/{item.totalCount}
                        </span>
                      </div>
                      {/* 진행률 바 */}
                      <div className="w-full h-1.5 bg-ivory-warm rounded-full mt-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${styles.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* D-day 뱃지 */}
                    <span className={`text-[25px] px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${styles.badgeBg} ${styles.badgeText}`}>
                      {item.deadlineDaysLeft <= 0
                        ? `${Math.abs(item.deadlineDaysLeft)}일 초과`
                        : `D-${item.deadlineDaysLeft}`}
                    </span>

                    {/* 화살표 */}
                    <ChevronRight className="w-3.5 h-3.5 text-taupe-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
