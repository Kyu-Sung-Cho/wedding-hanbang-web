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
} from "date-fns";
import { ko } from "date-fns/locale";
import type { ScheduleEvent } from "@/types/database.types";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  getScheduleEventAssigneeLabel,
  getScheduleEventStatus,
  sanitizeUserFacingScheduleMemo,
  type ScheduleEventAssigneeContext,
} from "@/utils/scheduleEvents";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
  etiquette: "결혼 예절 참고",
};

interface Props {
  weddingDate: Date | null;
  events: ScheduleEvent[];
  onAddEvent: (date: string) => void;
  onEditEvent: (event: ScheduleEvent) => void;
  assigneeContext?: ScheduleEventAssigneeContext;
}

const WEDDING_DAY_COLOR = "bg-gradient-to-br from-[#B07834] to-[#D0A15F]";
const PERSONAL_EVENT_COLOR = "bg-[#5E748C]";
const PERSONAL_EVENT_SOFT_COLOR = "bg-[#5E748C]/10";
const PERSONAL_EVENT_TEXT_COLOR = "text-[#5E748C]";

export default function CalendarView({
  weddingDate,
  events,
  onAddEvent,
  onEditEvent,
  assigneeContext = {},
}: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setToday(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 현재 월의 날짜들
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  const activeEvents = events.filter(
    (event) => getScheduleEventStatus(event) !== "cancelled",
  );
  const getEventsForDate = (date: Date) =>
    activeEvents.filter((e) => e.date === format(date, "yyyy-MM-dd"));

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

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
              {/* 실제 등록 일정 점 */}
              {inMonth && dayEvents.length > 0 && (
                <div className="flex gap-0.5">
                  {dayEvents.slice(0, 2).map((event, i) => (
                    <div
                      key={`e${i}`}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isWedding || isSelected
                          ? "bg-white/70"
                          : getScheduleEventStatus(event) === "completed"
                            ? "bg-[#6D806E]"
                            : PERSONAL_EVENT_COLOR
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
          <div className={`w-3 h-3 rounded-full ${PERSONAL_EVENT_COLOR}`} />
          <span className="text-sm text-[#635b51]">등록 일정</span>
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
              {/* 이벤트 */}
              {selectedEvents.map((evt) => {
                const memoText = sanitizeUserFacingScheduleMemo(evt.memo)?.trim();
                const shouldShowMemo =
                  Boolean(memoText) && memoText !== evt.title.trim();
                const isCompleted = getScheduleEventStatus(evt) === "completed";

                return (
                  <button
                    key={evt.id}
                    onClick={() => onEditEvent(evt)}
                    className="w-full rounded-xl bg-white p-3.5 text-left transition-shadow hover:shadow-[0_4px_16px_rgb(0,0,0,0.04)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-2 w-2.5 h-2.5 rounded-full flex-shrink-0 ${PERSONAL_EVENT_COLOR}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p
                            className={`font-serif-kr text-base font-normal ${
                              isCompleted
                                ? "text-[#6D806E] line-through"
                                : "text-[#1A1A1F]"
                            }`}
                          >
                            {evt.title}
                          </p>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-medium ${
                                isCompleted
                                  ? "bg-[#C7D1C2]/45 text-[#4F6451]"
                                  : `${PERSONAL_EVENT_SOFT_COLOR} ${PERSONAL_EVENT_TEXT_COLOR}`
                              }`}
                            >
                              {isCompleted ? "완료" : "예정"}
                            </span>
                            {evt.categoryKey && (
                              <span className={`shrink-0 text-sm px-2 py-0.5 rounded-full ${PERSONAL_EVENT_SOFT_COLOR} ${PERSONAL_EVENT_TEXT_COLOR} font-medium`}>
                                {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-1.5 text-[12px] font-medium text-[#5d6879]">
                          담당 · {getScheduleEventAssigneeLabel(
                            evt.assignee,
                            assigneeContext,
                          )}
                        </p>
                        {evt.time && (
                          <p className="mt-1 text-[12px] font-medium text-[#5d6879]">
                            시간 · {evt.time}
                          </p>
                        )}
                        {evt.completionCriteria && (
                          <div className="mt-2 rounded-lg border border-[#d8e1d5] bg-[#f7faf6] px-3 py-2">
                            <p className="mb-1 text-[11px] font-semibold text-[#4F6451]">
                              완료 기준
                            </p>
                            <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-[1.65] text-[#526056]">
                              {evt.completionCriteria}
                            </p>
                          </div>
                        )}
                        {shouldShowMemo && (
                          <div className="mt-2 rounded-lg border border-[#eadfc9]/70 bg-[#fffdf8] px-3 py-2">
                            <p className="mb-1 text-[11px] font-semibold text-[#795252]">
                              메모
                            </p>
                            <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-[1.65] text-[#635b51]">
                              {memoText}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* 빈 날짜 */}
              {selectedEvents.length === 0 && (
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
            날짜를 정한 일정만 캘린더에 표시됩니다
          </p>
          <p className="text-base text-[#B5ADA3] mt-1">
            위의 일정 추가 버튼으로 실제 날짜를 등록해 주세요
          </p>
        </div>
      )}
    </div>
  );
}
