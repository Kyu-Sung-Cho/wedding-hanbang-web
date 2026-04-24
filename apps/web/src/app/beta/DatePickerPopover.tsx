"use client";

import { useState, useRef, useEffect } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  parseISO,
  isAfter,
  isBefore,
  isValid,
  startOfDay,
} from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

interface DatePickerPopoverProps {
  /** YYYY-MM-DD 형식 */
  value: string;
  onChange: (value: string) => void;
  /** YYYY-MM-DD */
  min?: string;
  /** YYYY-MM-DD */
  max?: string;
  disabled?: boolean;
  placeholder?: string;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function DatePickerPopover({
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = "날짜를 선택해주세요",
}: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false);

  // 선택된 값 파싱
  const selectedDate = value && isValid(parseISO(value)) ? parseISO(value) : null;
  const minDate = min && isValid(parseISO(min)) ? parseISO(min) : null;
  const maxDate = max && isValid(parseISO(max)) ? parseISO(max) : null;
  const today = startOfDay(new Date());

  // 표시 중인 month — 기본값: 선택된 날짜 > 오늘 월
  // (min/max는 선택만 제한하고 네비게이션은 자유롭게)
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    if (selectedDate) return startOfMonth(selectedDate);
    return startOfMonth(new Date());
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  // 달력 grid: 현재 월 + 앞뒤 주 채움 (42칸)
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // 네비게이션은 자유 (min/max는 "선택"만 제한)
  // 단 과도한 탐색 방지: 오늘 기준 앞뒤 2년 범위
  const navMin = subMonths(today, 24);
  const navMax = addMonths(today, 24);
  const canGoPrev = isAfter(viewMonth, startOfMonth(navMin));
  const canGoNext = isBefore(viewMonth, startOfMonth(navMax));

  function isDateDisabled(d: Date): boolean {
    if (minDate && isBefore(d, minDate)) return true;
    if (maxDate && isAfter(d, maxDate)) return true;
    return false;
  }

  function handleSelect(d: Date) {
    if (isDateDisabled(d)) return;
    onChange(format(d, "yyyy-MM-dd"));
    setOpen(false);
  }

  function handleClear() {
    onChange("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 text-left bg-transparent border rounded-xl px-3.5 py-3 text-[15px] font-light transition-colors ${
          open ? "border-rose-light/60" : "border-white/15 hover:border-white/25"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={selectedDate ? "text-white" : "text-white/30"}>
          {selectedDate ? format(selectedDate, "yyyy년 M월 d일 (EEE)", { locale: ko }) : placeholder}
        </span>
        {selectedDate ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                handleClear();
              }
            }}
            className="text-white/40 hover:text-white/70 transition-colors shrink-0 cursor-pointer"
            aria-label="날짜 지우기"
          >
            <X className="w-4 h-4" />
          </span>
        ) : (
          <Calendar className="w-4 h-4 text-white/40 shrink-0" aria-hidden />
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-noir-800 border border-white/15 rounded-2xl p-4 shadow-[0_24px_60px_-10px_rgba(0,0,0,0.6)]">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => canGoPrev && setViewMonth(subMonths(viewMonth, 1))}
              disabled={!canGoPrev}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="이전 달"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="font-serif-kr text-[15px] text-white font-medium">
              {format(viewMonth, "yyyy년 M월", { locale: ko })}
            </p>
            <button
              type="button"
              onClick={() => canGoNext && setViewMonth(addMonths(viewMonth, 1))}
              disabled={!canGoNext}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="다음 달"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`text-[11px] tracking-[0.1em] text-center py-1 font-medium ${
                  i === 0 ? "text-rose-light/70" : "text-white/40"
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const selected = selectedDate && isSameDay(d, selectedDate);
              const disabledCell = isDateDisabled(d);
              const isSunday = d.getDay() === 0;
              const isToday = isSameDay(d, today);

              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => handleSelect(d)}
                  disabled={disabledCell}
                  aria-label={isToday ? `${format(d, "M월 d일")} (오늘)` : undefined}
                  className={`aspect-square rounded-lg text-[13px] font-light tabular-nums transition-colors relative ${
                    selected
                      ? "bg-rose-light text-noir-800 font-medium"
                      : disabledCell
                        ? `${isToday ? "text-white/50" : "text-white/15"} cursor-not-allowed`
                        : inMonth
                          ? `${isSunday ? "text-rose-light/80" : "text-white/80"} hover:bg-white/5 hover:text-white`
                          : "text-white/25 hover:bg-white/5"
                  } ${isToday && !selected ? "ring-1 ring-white/30" : ""}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* 도움말 */}
          <p className="mt-4 pt-3 border-t border-white/10 text-[10px] text-white/40 tracking-wide leading-relaxed">
            <span className="inline-block w-1.5 h-1.5 rounded-full ring-1 ring-white/30 align-middle mr-1.5" aria-hidden />
            오늘
            {min && max && (
              <span className="ml-3">
                선택 가능: {format(parseISO(min), "yyyy년 M월", { locale: ko })} ~ {format(parseISO(max), "yyyy년 M월", { locale: ko })}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
