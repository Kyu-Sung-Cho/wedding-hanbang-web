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
  general: "일반",
  etiquette: "결혼 예절 참고",
};

interface Props {
  weddingDate: Date | null;
  events: ScheduleEvent[];
  onAddEvent: (date: string) => void;
  onEditEvent: (event: ScheduleEvent) => void;
  assigneeContext?: ScheduleEventAssigneeContext;
}

const WEDDING_DAY_COLOR = "bg-[var(--amora-rose)]";
const PERSONAL_EVENT_COLOR = "bg-[var(--amora-accent)]";
const PERSONAL_EVENT_SOFT_COLOR = "bg-[var(--amora-accent)]/10";
const PERSONAL_EVENT_TEXT_COLOR = "text-[var(--amora-accent)]";

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
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="tap-area flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--amora-warm)] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-low)]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="planning-display text-[16px] text-[var(--amora-ink)] lg:text-[14px]">
          {format(currentMonth, "yyyy년 M월", { locale: ko })}
        </h3>
        <button
          type="button"
          aria-label="다음 달"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="tap-area flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--amora-warm)] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-low)]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className={`py-1.5 text-center text-[9.5px] font-medium ${
              day === "일" ? "text-[var(--amora-rose-deep)]" : day === "토" ? "text-[var(--amora-accent)]" : "text-[var(--amora-muted)]"
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 캘린더 그리드 */}
      <div className="grid grid-cols-7">
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
              type="button"
              aria-label={`${format(day, "yyyy년 M월 d일 EEEE", { locale: ko })}${isWedding ? ", 결혼식" : ""}${dayEvents.length ? `, 등록 일정 ${dayEvents.length}건` : ""}`}
              aria-pressed={Boolean(isSelected)}
              aria-current={isToday ? "date" : undefined}
              onClick={() => setSelectedDate(isSelected ? null : day)}
              className={`no-min-tap relative flex h-11 flex-col items-center justify-center gap-0.5 border-t border-[var(--amora-line)] text-[12px] transition-colors lg:h-[32px] lg:text-[10.5px] ${
                isSelected
                  ? "rounded-lg bg-[var(--amora-ink)] text-white"
                  : isToday
                  ? "rounded-lg bg-[var(--amora-warm)] text-[var(--amora-rose-deep)] ring-1 ring-inset ring-[var(--amora-rose)]"
                  : !inMonth
                  ? "text-[var(--amora-muted)]/45"
                  : dayNum === 0
                  ? "text-[var(--amora-rose-deep)] hover:bg-[var(--amora-warm)]"
                  : dayNum === 6
                  ? "text-[var(--amora-accent)] hover:bg-[var(--amora-warm)]"
                  : "text-[var(--amora-ink)] hover:bg-[var(--amora-warm)]"
              }`}
            >
              <span>{format(day, "d")}</span>
              {/* 실제 등록 일정 점 */}
              {inMonth && (isWedding || dayEvents.length > 0) && (
                <div aria-hidden="true" className="absolute bottom-1 flex gap-0.5">
                  {isWedding && <span className={`h-1 w-1 rounded-full ${isSelected ? "bg-white" : WEDDING_DAY_COLOR}`} />}
                  {dayEvents.slice(0, 2).map((event, i) => (
                    <div
                      key={`e${i}`}
                      className={`h-1 w-1 rounded-full ${
                        isSelected
                          ? "bg-white/70"
                          : getScheduleEventStatus(event) === "completed"
                            ? "bg-[var(--amora-sage)]"
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${WEDDING_DAY_COLOR}`} />
          <span className="text-[10px] text-[var(--amora-muted)]">결혼식</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${PERSONAL_EVENT_COLOR}`} />
          <span className="text-[10px] text-[var(--amora-muted)]">등록 일정</span>
        </div>
      </div>

      {/* 선택된 날짜 상세 */}
      {selectedDate && (
        <div
          className="mt-4 border-t border-[var(--amora-line)] pt-4 animate-fade-in"
        >
          <div className="rounded-xl bg-[var(--amora-warm)] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-[var(--amora-ink)]">
                {format(selectedDate, "M월 d일 (EEEE)", { locale: ko })}
              </p>
              <button
                onClick={() =>
                  onAddEvent(format(selectedDate, "yyyy-MM-dd"))
                }
                className="tap-area flex items-center gap-1 rounded-full border border-[var(--amora-line)] bg-white px-2 py-1 text-[10.5px] text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-low)]"
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
                    className="w-full rounded-lg border border-[var(--amora-line)] bg-white p-3 text-left transition-colors hover:border-[var(--amora-rose)]"
                  >
                    <div className="flex items-start gap-2">
                      <div className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${PERSONAL_EVENT_COLOR}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p
                            className={`text-[12px] font-semibold ${
                              isCompleted
                                ? "text-[var(--amora-sage)] line-through"
                                : "text-[var(--hb-text-strong)]"
                            }`}
                          >
                            {evt.title}
                          </p>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${
                                isCompleted
                                  ? "bg-[var(--amora-sage-pale)] text-[var(--amora-soft)]"
                                  : `${PERSONAL_EVENT_SOFT_COLOR} ${PERSONAL_EVENT_TEXT_COLOR}`
                              }`}
                            >
                              {isCompleted ? "완료" : "예정"}
                            </span>
                            {evt.categoryKey && (
                              <span className={`shrink-0 text-[9px] px-2 py-0.5 rounded-full ${PERSONAL_EVENT_SOFT_COLOR} ${PERSONAL_EVENT_TEXT_COLOR} font-medium`}>
                                {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-1.5 text-[10.5px] text-[var(--hb-text-body)]">
                          담당 · {getScheduleEventAssigneeLabel(
                            evt.assignee,
                            assigneeContext,
                          )}
                        </p>
                        {evt.time && (
                          <p className="mt-1 text-[10.5px] text-[var(--hb-text-body)]">
                            시간 · {evt.time}
                          </p>
                        )}
                        {evt.completionCriteria && (
                          <div className="mt-2 rounded-lg border border-[var(--amora-sage-pale)] bg-[var(--amora-sage-pale)]/40 px-3 py-2">
                            <p className="mb-1 text-[11px] font-semibold text-[var(--amora-soft)]">
                              완료 기준
                            </p>
                            <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.65] text-[var(--amora-soft)]">
                              {evt.completionCriteria}
                            </p>
                          </div>
                        )}
                        {shouldShowMemo && (
                          <div className="mt-2 rounded-lg border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3 py-2">
                            <p className="mb-1 text-[11px] font-semibold text-[var(--amora-rose-deep)]">
                              메모
                            </p>
                            <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.65] text-[var(--hb-text-body)]">
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
                <p className="py-3 text-center text-[11px] text-[var(--amora-muted)]">
                  이 날짜에 등록된 일정이 없습니다
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 달력에 그릴 것이 없을 때 — 왜 비었는지 말해 준다.
          예전에는 `!weddingDate` 일 때만 띄웠다. 그런데 예식일이 있어도 등록한 일정이
          0 건이면 격자만 덩그러니 남는다. 운영 54 커플 중 절반 넘게가 그 상태다.
          예식일이 멀면 「날짜를 정할 항목」도 비어(창이 60일) 화면에 단서가 하나도
          없어진다. 문구는 이미 있던 것을 그대로 쓴다. */}
      {(!weddingDate || activeEvents.length === 0) && (
        <div className="mt-4 rounded-lg bg-[var(--amora-warm)] px-3 py-3 text-center">
          <p className="text-[11px] leading-[1.7] text-[var(--amora-soft)]">
            날짜를 정한 일정만 캘린더에 표시됩니다
          </p>
          <p className="mt-1 text-[10px] leading-[1.7] text-[var(--amora-muted)]">
            위의 일정 추가 버튼으로 실제 날짜를 등록해 주세요
          </p>
        </div>
      )}
    </div>
  );
}
