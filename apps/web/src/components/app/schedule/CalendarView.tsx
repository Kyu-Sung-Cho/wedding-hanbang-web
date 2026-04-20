"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  subDays,
} from "date-fns";
import { ko } from "date-fns/locale";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오",
  dress: "드레스/턱시도", makeup: "메이크업", ring: "예물(반지)",
  hanbok: "한복", yedan: "예단", honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)", housing: "신혼집", invitation: "청첩장",
  snap: "본식스냅/영상", shoes: "웨딩구두", bouquet: "부케/꽃장식",
  gift: "답례품", mc: "사회/축가", ham: "함", pyebaek: "폐백",
};

interface Milestone {
  date: Date;
  categoryKey: string;
  label: string;
  type: "start" | "deadline";
  status: ProgressItem["status"];
}

interface Props {
  weddingDate: Date | null;
  progress: Record<string, ProgressItem>;
  events: ScheduleEvent[];
  onCategoryClick: (key: string) => void;
  onAddEvent: (date: string) => void;
  onEditEvent: (event: ScheduleEvent) => void;
}

export default function CalendarView({
  weddingDate,
  progress,
  events,
  onCategoryClick,
  onAddEvent,
  onEditEvent,
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // hydration-safe: today는 클라이언트에서만 설정
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);

  // 마일스톤 계산
  const milestones = useMemo(() => {
    if (!weddingDate) return [];

    const result: Milestone[] = [];

    for (const cat of CATEGORY_CHECKLISTS) {
      const item = progress[cat.key];
      const status: ProgressItem["status"] = (item?.status as ProgressItem["status"]) ?? "not_started";

      const startDate = subDays(weddingDate, cat.ddayStart);
      result.push({
        date: startDate,
        categoryKey: cat.key,
        label: `${cat.label} 준비 시작`,
        type: "start",
        status,
      });

      const deadlineDate = subDays(weddingDate, cat.ddayDeadline);
      result.push({
        date: deadlineDate,
        categoryKey: cat.key,
        label: `${cat.label} 완료 권장`,
        type: "deadline",
        status,
      });
    }

    return result;
  }, [weddingDate, progress]);

  // 현재 월의 날짜들
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  // 특정 날짜의 마일스톤
  const getMilestonesForDate = (date: Date) =>
    milestones.filter((m) => isSameDay(m.date, date));

  // 특정 날짜의 이벤트
  const getEventsForDate = (date: Date) =>
    events.filter((e) => e.date === format(date, "yyyy-MM-dd"));

  // 선택된 날짜의 마일스톤 & 이벤트
  const selectedMilestones = selectedDate ? getMilestonesForDate(selectedDate) : [];
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const statusColor = (status: ProgressItem["status"]) => {
    switch (status) {
      case "completed":
        return "bg-[#2E7D5A]";
      case "in_progress":
        return "bg-[#C4967E]";
      default:
        return "bg-[#B5ADA3]";
    }
  };

  return (
    <div>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="w-9 h-9 rounded-xl border border-black/[0.06] flex items-center justify-center text-[#928980] hover:border-[#C4967E] hover:text-[#C4967E] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-[16px] font-medium text-[#1A1A1F]">
          {format(currentMonth, "yyyy년 M월", { locale: ko })}
        </h3>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="w-9 h-9 rounded-xl border border-black/[0.06] flex items-center justify-center text-[#928980] hover:border-[#C4967E] hover:text-[#C4967E] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className={`text-center text-[11px] font-medium py-1.5 ${
              day === "일" ? "text-red-400" : day === "토" ? "text-blue-400" : "text-[#928980]"
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 캘린더 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const inMonth = isSameMonth(day, currentMonth);
          const isToday = today ? isSameDay(day, today) : false;
          const isWedding = weddingDate && isSameDay(day, weddingDate);
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const dayMilestones = getMilestonesForDate(day);
          const dayEvents = getEventsForDate(day);
          const dayNum = day.getDay();

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(isSelected ? null : day)}
              className={`relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 text-[13px] transition-all ${
                !inMonth
                  ? "text-[#B5ADA3]/40"
                  : isWedding
                  ? "bg-gradient-to-br from-[#C4967E] to-[#C9A96E] text-white font-medium shadow-md"
                  : isSelected
                  ? "bg-[#795252] text-white font-medium"
                  : isToday
                  ? "bg-[#C4967E]/10 text-[#C4967E] font-medium ring-1 ring-[#C4967E]/30"
                  : dayNum === 0
                  ? "text-red-400 hover:bg-[#FDFCFA]"
                  : dayNum === 6
                  ? "text-blue-400 hover:bg-[#FDFCFA]"
                  : "text-[#1A1A1F] hover:bg-[#FDFCFA]"
              }`}
            >
              <span>{format(day, "d")}</span>
              {/* 마일스톤 + 이벤트 점 */}
              {inMonth && (dayMilestones.length > 0 || dayEvents.length > 0) && (
                <div className="flex gap-0.5">
                  {dayMilestones.slice(0, 2).map((m, i) => (
                    <div
                      key={`m${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isWedding || isSelected ? "bg-white/60" : statusColor(m.status)
                      }`}
                    />
                  ))}
                  {dayEvents.slice(0, 2).map((_, i) => (
                    <div
                      key={`e${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isWedding || isSelected ? "bg-white/60" : "bg-[#C9A96E]"
                      }`}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div className="flex items-center gap-4 mt-4 px-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E]" />
          <span className="text-[11px] text-[#928980]">결혼식</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#2E7D5A]" />
          <span className="text-[11px] text-[#928980]">완료</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#C4967E]" />
          <span className="text-[11px] text-[#928980]">진행중</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#B5ADA3]" />
          <span className="text-[11px] text-[#928980]">미시작</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#C9A96E]" />
          <span className="text-[11px] text-[#928980]">내 일정</span>
        </div>
      </div>

      {/* 선택된 날짜 상세 */}
      <AnimatePresence>
        {selectedDate && (selectedMilestones.length > 0 || selectedEvents.length > 0 || true) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden"
          >
            <div className="bg-[#FDFCFA] rounded-2xl border border-black/[0.04] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] text-[#928980]">
                  {format(selectedDate, "M월 d일 (EEEE)", { locale: ko })}
                </p>
                <button
                  onClick={() =>
                    onAddEvent(format(selectedDate, "yyyy-MM-dd"))
                  }
                  className="flex items-center gap-1 text-[11px] text-[#C4967E] hover:text-[#9A6B62] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  일정 추가
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {/* 마일스톤 */}
                {selectedMilestones.map((m, i) => (
                  <button
                    key={`m${i}`}
                    onClick={() => onCategoryClick(m.categoryKey)}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-black/[0.04] hover:border-[#C4967E]/30 transition-colors text-left"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(m.status)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1A1A1F] font-medium">{m.label}</p>
                      <p className="text-[11px] text-[#928980]">
                        {m.type === "start" ? "준비 시작 권장일" : "완료 권장일"}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full text-white font-medium ${statusColor(m.status)}`}
                    >
                      {m.status === "completed"
                        ? "완료"
                        : m.status === "in_progress"
                        ? "진행중"
                        : "미시작"}
                    </span>
                  </button>
                ))}

                {/* 이벤트 */}
                {selectedEvents.map((evt) => (
                  <button
                    key={evt.id}
                    onClick={() => onEditEvent(evt)}
                    className="flex items-center gap-3 p-3 bg-white rounded-xl border border-black/[0.04] hover:border-[#C9A96E]/30 transition-colors text-left"
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#C9A96E]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1A1A1F] font-medium">{evt.title}</p>
                      {evt.memo && (
                        <p className="text-[11px] text-[#928980] truncate">{evt.memo}</p>
                      )}
                    </div>
                    {evt.categoryKey && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C9A96E]/10 text-[#C9A96E] font-medium">
                        {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                      </span>
                    )}
                  </button>
                ))}

                {/* 빈 날짜 */}
                {selectedMilestones.length === 0 && selectedEvents.length === 0 && (
                  <p className="text-[12px] text-[#B5ADA3] text-center py-4">
                    이 날짜에 등록된 일정이 없습니다
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 결혼식 날짜 없을 때 안내 */}
      {!weddingDate && (
        <div className="mt-6 text-center py-8">
          <p className="text-[14px] text-[#928980]">
            결혼 예정일을 설정하면 D-day 기준 일정이 캘린더에 표시됩니다
          </p>
          <p className="text-[12px] text-[#B5ADA3] mt-1">
            설정 페이지에서 결혼 날짜를 입력하세요
          </p>
        </div>
      )}
    </div>
  );
}
