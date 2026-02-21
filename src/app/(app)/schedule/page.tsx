"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { List, Calendar } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import TimelineView from "@/components/app/schedule/TimelineView";
import CalendarView from "@/components/app/schedule/CalendarView";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const CATEGORY_KEYS = [
  "venue", "studio", "dress", "makeup", "ring",
  "hanbok", "honeymoon", "houseware", "invitation", "gift",
];

export default function SchedulePage() {
  const { journey } = useAuthStore();
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("timeline");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const progress = journey?.progress ?? {};
  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;

  // 전체 체크리스트 기준 완료 수 계산
  const { totalDone, totalItems } = CATEGORY_KEYS.reduce(
    (acc, key) => {
      const template = CHECKLIST_MAP[key];
      if (!template) return acc;
      const existing = progress[key];
      const merged = mergeChecklist(template.items, existing?.checklist);
      const { done, total } = getChecklistCounts(merged);
      return { totalDone: acc.totalDone + done, totalItems: acc.totalItems + total };
    },
    { totalDone: 0, totalItems: 0 }
  );

  const today = new Date();
  const dday = weddingDate
    ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";

  const handleCategoryClick = useCallback((key: string) => {
    setSelectedCategory(key);
  }, []);

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 상단 요약 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl p-6 border border-black/[0.04] mb-6"
      >
        <div className="flex items-center justify-between max-md:flex-col max-md:gap-4">
          <div>
            <p className="text-[12px] text-taupe-500 font-light mb-1">전체 체크리스트</p>
            <p className="text-[14px] text-noir-800">
              <span className="font-display text-[28px] font-light text-rose-500">
                {totalDone}
              </span>
              <span className="text-taupe-400 mx-1">/</span>
              <span className="font-display text-[28px] font-light text-taupe-400">
                {totalItems}
              </span>
              <span className="text-[13px] text-taupe-400 ml-2">완료</span>
            </p>
          </div>
          <div className="text-right max-md:text-left max-md:w-full">
            <div className="flex items-center gap-3 mb-2 max-md:justify-between">
              <span className="text-[12px] text-taupe-400">결혼 예정일</span>
              <span className="text-[14px] font-medium text-noir-800">{dateStr}</span>
              {dday !== null && dday > 0 && (
                <span className="text-[12px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                  D-{dday}
                </span>
              )}
            </div>
            <div className="w-[200px] max-md:w-full">
              <div className="h-3 bg-ivory-warm rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
                  style={{
                    width: `${totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-taupe-400 mt-1.5 text-right">
                {totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0}% 달성
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 탭 전환 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="flex items-center gap-2 mb-6"
      >
        <button
          onClick={() => setViewMode("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            viewMode === "timeline"
              ? "bg-[#1A1A1F] text-white shadow-sm"
              : "bg-white text-[#928980] border border-black/[0.06] hover:border-[#C4967E] hover:text-[#C4967E]"
          }`}
        >
          <List className="w-4 h-4" />
          타임라인
        </button>
        <button
          onClick={() => setViewMode("calendar")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
            viewMode === "calendar"
              ? "bg-[#1A1A1F] text-white shadow-sm"
              : "bg-white text-[#928980] border border-black/[0.06] hover:border-[#C4967E] hover:text-[#C4967E]"
          }`}
        >
          <Calendar className="w-4 h-4" />
          캘린더
        </button>
      </motion.div>

      {/* 뷰 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        {viewMode === "timeline" ? (
          <TimelineView progress={progress} onCategoryClick={handleCategoryClick} />
        ) : (
          <div className="bg-white rounded-2xl p-6 border border-black/[0.04]">
            <CalendarView
              weddingDate={weddingDate}
              progress={progress}
              onCategoryClick={handleCategoryClick}
            />
          </div>
        )}
      </motion.div>

      {/* 체크리스트 모달 */}
      <CategoryChecklistModal
        categoryKey={selectedCategory ?? ""}
        isOpen={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
      />
    </div>
  );
}
