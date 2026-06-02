"use client";

import { useState, useMemo, useEffect } from "react";
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

const CALENDAR_STATUS_COLORS: Record<ProgressItem["status"], string> = {
  completed: "bg-[#36534E]",
  in_progress: "bg-[#B88746]",
  not_started: "bg-[#B9B0A4]",
};

const WEDDING_DAY_COLOR = "bg-gradient-to-br from-[#B07834] to-[#D0A15F]";
const PERSONAL_EVENT_COLOR = "bg-[#5E748C]";
const PERSONAL_EVENT_SOFT_COLOR = "bg-[#5E748C]/10";
const PERSONAL_EVENT_TEXT_COLOR = "text-[#5E748C]";

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

  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setToday(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 마일스톤
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

  const getMilestonesForDate = (date: Date) =>
    milestones.filter((m) => isSameDay(m.date, date));

  const getEventsForDate = (date: Date) =>
    events.filter((e) => e.date === format(date, "yyyy-MM-dd"));

  const selectedMilestones = selectedDate ? getMilestonesForDate(selectedDate) : [];
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const statusColor = (status: ProgressItem["status"]) => {
    return CALENDAR_STATUS_COLORS[status] ?? CALENDAR_STATUS_COLORS.not_started;
  };

  return (
    <div>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="w-9 h-9 rounded-xl bg-[#F6F3F2] flex items-center justify-center text-[#504444] hover:bg-[#795252] hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="font-serif-kr text-[20px] font-light text-[#1A1A1F]">
          {format(currentMonth, "yyyy년 M월", { locale: ko })}
        </h3>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="w-9 h-9 rounded-xl bg-[#F6F3F2] flex items-center justify-center text-[#504444] hover:bg-[#795252] hover:text-white transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className={`text-center text-sm uppercase tracking-widest font-medium py-1.5 ${
              day === "일" ? "text-red-400" : day === "토" ? "text-blue-400" : "text-[#B5ADA3]"
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
              className={`relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 text-[15px] transition-all ${
                !inMonth
                  ? "text-[#B5ADA3]/40"
                  : isWedding
                  ? `${WEDDING_DAY_COLOR} text-white font-medium shadow-md`
                  : isSelected
                  ? "bg-[#795252] text-white font-medium"
                  : isToday
                  ? "ring-2 ring-[#795252] bg-white text-[#795252] font-medium"
                  : dayNum === 0
                  ? "text-red-400 hover:bg-[#FAFAF8]"
                  : dayNum === 6
                  ? "text-blue-400 hover:bg-[#FAFAF8]"
                  : "text-[#1A1A1F] hover:bg-[#FAFAF8]"
              }`}
            >
              <span className={isToday || isWedding || isSelected ? "font-serif-kr" : "font-serif-kr font-light"}>
                {format(day, "d")}
              </span>
              {/* 이벤트/마일스톤 점 */}
              {inMonth && (dayMilestones.length > 0 || dayEvents.length > 0) && (
                <div className="flex gap-0.5">
                  {dayMilestones.slice(0, 2).map((m, i) => (
                    <div
                      key={`m${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isWedding || isSelected ? "bg-white/70" : statusColor(m.status)
                      }`}
                    />
                  ))}
                  {dayEvents.slice(0, 2).map((_, i) => (
                    <div
                      key={`e${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isWedding || isSelected ? "bg-white/70" : PERSONAL_EVENT_COLOR
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
      <div className="flex items-center gap-4 mt-5 px-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-full ${WEDDING_DAY_COLOR}`} />
          <span className="text-sm text-[#635b51]">결혼식</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-full ${CALENDAR_STATUS_COLORS.completed}`} />
          <span className="text-sm text-[#635b51]">완료</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-full ${CALENDAR_STATUS_COLORS.in_progress}`} />
          <span className="text-sm text-[#635b51]">진행중</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-full ${CALENDAR_STATUS_COLORS.not_started}`} />
          <span className="text-sm text-[#635b51]">미시작</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-3 h-3 rounded-full ${PERSONAL_EVENT_COLOR}`} />
          <span className="text-sm text-[#635b51]">내 일정</span>
        </div>
      </div>

      {/* 선택된 날짜 상세 */}
      {selectedDate && (
        <div
          className="mt-5 overflow-hidden animate-fade-in"
        >
          <div className="bg-[#F6F3F2] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="font-serif-kr text-[17px] font-normal text-[#1A1A1F]">
                {format(selectedDate, "M월 d일 (EEEE)", { locale: ko })}
              </p>
              <button
                onClick={() =>
                  onAddEvent(format(selectedDate, "yyyy-MM-dd"))
                }
                className="flex items-center gap-1.5 text-sm text-[#795252] hover:text-[#946a6a] transition-colors"
              >
                <Plus className="w-4 h-4" />
                일정 추가
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {/* 마일스톤 */}
              {selectedMilestones.map((m, i) => (
                <button
                  key={`m${i}`}
                  onClick={() => onCategoryClick(m.categoryKey)}
                  className="flex items-center gap-3 p-3 bg-white rounded-xl hover:shadow-[0_4px_16px_rgb(0,0,0,0.04)] transition-shadow text-left"
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(m.status)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif-kr text-base text-[#1A1A1F] font-normal">{m.label}</p>
                    <p className="text-sm text-[#B5ADA3]">
                      {m.type === "start" ? "준비 시작 권장일" : "완료 권장일"}
                    </p>
                  </div>
                  <span
                    className={`text-sm px-2 py-0.5 rounded-full text-white font-medium ${statusColor(m.status)}`}
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
                  className="flex items-center gap-3 p-3 bg-white rounded-xl hover:shadow-[0_4px_16px_rgb(0,0,0,0.04)] transition-shadow text-left"
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PERSONAL_EVENT_COLOR}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif-kr text-base text-[#1A1A1F] font-normal">{evt.title}</p>
                    {evt.memo && (
                      <p className="text-sm text-[#B5ADA3] truncate">{evt.memo}</p>
                    )}
                  </div>
                  {evt.categoryKey && (
                    <span className={`text-sm px-2 py-0.5 rounded-full ${PERSONAL_EVENT_SOFT_COLOR} ${PERSONAL_EVENT_TEXT_COLOR} font-medium`}>
                      {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                    </span>
                  )}
                </button>
              ))}

              {/* 빈 날짜 */}
              {selectedMilestones.length === 0 && selectedEvents.length === 0 && (
                <p className="text-base text-[#B5ADA3] text-center py-4">
                  이 날짜에 등록된 일정이 없습니다
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 결혼식 날짜 없을 때 */}
      {!weddingDate && (
        <div className="mt-6 text-center py-8">
          <p className="text-[17px] text-[#504444]">
            결혼 예정일을 설정하면 D-day 기준 일정이 캘린더에 표시됩니다
          </p>
          <p className="text-base text-[#B5ADA3] mt-1">
            설정 페이지에서 결혼 날짜를 입력하세요
          </p>
        </div>
      )}
    </div>
  );
}
