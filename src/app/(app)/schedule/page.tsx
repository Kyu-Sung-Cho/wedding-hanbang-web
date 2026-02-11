"use client";

import { Suspense, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus, Calendar as CalendarIcon, List, ChevronLeft,
  ChevronRight, Check, Trash2, MapPin, Clock,
} from "lucide-react";
import { useScheduleStore } from "@/stores/scheduleStore";
import { CATEGORIES, getCategoryById } from "@/constants/categories";
import { CategoryId, ScheduleType, SCHEDULE_TYPE_CONFIG, Schedule } from "@/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" /></div>}>
      <ScheduleContent />
    </Suspense>
  );
}

function ScheduleContent() {
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category") as CategoryId | null;

  const {
    schedules,
    addSchedule,
    deleteSchedule,
    toggleComplete,
  } = useScheduleStore();

  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // 새 일정 폼
  const [newSchedule, setNewSchedule] = useState({
    title: "",
    description: "",
    categoryId: categoryFilter || ("wedding_hall" as CategoryId),
    type: "appointment" as ScheduleType,
    date: new Date().toISOString().split("T")[0],
    time: "",
    location: "",
    isAllDay: false,
  });

  // 현재 월의 날짜 계산
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  // 캘린더 날짜 배열 생성
  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [startDay, daysInMonth]);

  // 필터링된 일정
  const filteredSchedules = useMemo(() => {
    let filtered = schedules;
    if (categoryFilter) {
      filtered = filtered.filter((s) => s.categoryId === categoryFilter);
    }
    return filtered.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [schedules, categoryFilter]);

  // 날짜별 일정
  const getSchedulesForDate = (dateStr: string) =>
    filteredSchedules.filter((s) => s.date === dateStr);

  // 날짜에 일정 있는지 확인
  const hasScheduleOnDate = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return filteredSchedules.some((s) => s.date === dateStr);
  };

  // 이전/다음 월
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  // 일정 추가
  const handleAddSchedule = () => {
    if (!newSchedule.title || !newSchedule.date) return;

    addSchedule({
      title: newSchedule.title,
      description: newSchedule.description || null,
      categoryId: newSchedule.categoryId,
      type: newSchedule.type,
      date: newSchedule.date,
      time: newSchedule.time || null,
      location: newSchedule.location || null,
      isAllDay: newSchedule.isAllDay,
      reminder: { enabled: true, timings: ["1day_before"] },
    });

    setNewSchedule({
      title: "",
      description: "",
      categoryId: categoryFilter || "wedding_hall",
      type: "appointment",
      date: new Date().toISOString().split("T")[0],
      time: "",
      location: "",
      isAllDay: false,
    });
    setShowAddModal(false);
  };

  // 선택된 날짜의 일정
  const selectedDateSchedules = selectedDate
    ? getSchedulesForDate(selectedDate)
    : [];

  // 오늘 날짜
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 상단 컨트롤 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("calendar")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              viewMode === "calendar"
                ? "bg-rose-glow text-rose-500"
                : "text-taupe-500 hover:bg-ivory-100"
            }`}
          >
            <CalendarIcon className="h-4 w-4" />
            캘린더
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              viewMode === "list"
                ? "bg-rose-glow text-rose-500"
                : "text-taupe-500 hover:bg-ivory-100"
            }`}
          >
            <List className="h-4 w-4" />
            리스트
          </button>
        </div>

        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          일정 추가
        </Button>
      </div>

      {/* 카테고리 필터 표시 */}
      {categoryFilter && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-glow px-4 py-2.5">
          <span className="text-lg">
            {getCategoryById(categoryFilter)?.emoji}
          </span>
          <span className="text-sm font-medium text-rose-500">
            {getCategoryById(categoryFilter)?.name} 일정만 표시 중
          </span>
        </div>
      )}

      {viewMode === "calendar" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 캘린더 */}
          <Card padding="none" className="lg:col-span-2">
            {/* 월 선택 */}
            <div className="flex items-center justify-between border-b border-platinum px-6 py-4">
              <button
                onClick={prevMonth}
                className="rounded-lg p-1.5 text-taupe-500 hover:bg-ivory-100"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="text-base font-medium text-noir-800">
                {year}년 {month + 1}월
              </h2>
              <button
                onClick={nextMonth}
                className="rounded-lg p-1.5 text-taupe-500 hover:bg-ivory-100"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 border-b border-platinum">
              {["일", "월", "화", "수", "목", "금", "토"].map((day, i) => (
                <div
                  key={day}
                  className={`py-2 text-center text-xs font-medium ${
                    i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-taupe-500"
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, i) => {
                if (day === null) {
                  return <div key={`empty-${i}`} className="h-16 border-b border-r border-platinum" />;
                }
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                const hasSchedule = hasScheduleOnDate(day);
                const dayOfWeek = (startDay + day - 1) % 7;

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`relative h-16 border-b border-r border-platinum p-1 text-left transition-colors hover:bg-ivory-50 ${
                      isSelected ? "bg-rose-glow" : ""
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday
                          ? "bg-rose-500 font-medium text-white"
                          : dayOfWeek === 0
                          ? "text-red-400"
                          : dayOfWeek === 6
                          ? "text-blue-400"
                          : "text-noir-800"
                      }`}
                    >
                      {day}
                    </span>
                    {hasSchedule && (
                      <div className="absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-rose-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 선택된 날짜의 일정 */}
          <Card padding="none">
            <div className="border-b border-platinum px-6 py-4">
              <h3 className="text-sm font-medium text-noir-800">
                {selectedDate
                  ? new Date(selectedDate + "T00:00:00").toLocaleDateString(
                      "ko-KR",
                      { month: "long", day: "numeric", weekday: "short" }
                    )
                  : "날짜를 선택하세요"}
              </h3>
            </div>
            <div className="p-4">
              {selectedDate ? (
                selectedDateSchedules.length > 0 ? (
                  <div className="space-y-3">
                    {selectedDateSchedules.map((schedule) => (
                      <ScheduleItem
                        key={schedule.id}
                        schedule={schedule}
                        onToggle={() => toggleComplete(schedule.id)}
                        onDelete={() => deleteSchedule(schedule.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-taupe-400">
                    이 날짜에 일정이 없습니다
                  </p>
                )
              ) : (
                <p className="py-8 text-center text-sm text-taupe-400">
                  캘린더에서 날짜를 선택하세요
                </p>
              )}
            </div>
          </Card>
        </div>
      ) : (
        /* 리스트 뷰 */
        <div className="space-y-3">
          {filteredSchedules.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-taupe-400">
                등록된 일정이 없습니다
              </p>
            </Card>
          ) : (
            filteredSchedules.map((schedule) => (
              <ScheduleItem
                key={schedule.id}
                schedule={schedule}
                onToggle={() => toggleComplete(schedule.id)}
                onDelete={() => deleteSchedule(schedule.id)}
                showDate
              />
            ))
          )}
        </div>
      )}

      {/* 일정 추가 모달 */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="일정 추가"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="제목"
            value={newSchedule.title}
            onChange={(e) =>
              setNewSchedule({ ...newSchedule, title: e.target.value })
            }
            placeholder="일정 제목"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-noir-800">
                카테고리
              </label>
              <select
                value={newSchedule.categoryId}
                onChange={(e) =>
                  setNewSchedule({
                    ...newSchedule,
                    categoryId: e.target.value as CategoryId,
                  })
                }
                className="w-full rounded-xl border border-platinum bg-white px-4 py-2.5 text-sm text-noir-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.emoji} {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-noir-800">
                유형
              </label>
              <select
                value={newSchedule.type}
                onChange={(e) =>
                  setNewSchedule({
                    ...newSchedule,
                    type: e.target.value as ScheduleType,
                  })
                }
                className="w-full rounded-xl border border-platinum bg-white px-4 py-2.5 text-sm text-noir-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
              >
                {Object.entries(SCHEDULE_TYPE_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="날짜"
              type="date"
              value={newSchedule.date}
              onChange={(e) =>
                setNewSchedule({ ...newSchedule, date: e.target.value })
              }
            />
            <Input
              label="시간 (선택)"
              type="time"
              value={newSchedule.time}
              onChange={(e) =>
                setNewSchedule({ ...newSchedule, time: e.target.value })
              }
            />
          </div>

          <Input
            label="장소 (선택)"
            value={newSchedule.location}
            onChange={(e) =>
              setNewSchedule({ ...newSchedule, location: e.target.value })
            }
            placeholder="장소"
          />

          <Input
            label="설명 (선택)"
            value={newSchedule.description}
            onChange={(e) =>
              setNewSchedule({ ...newSchedule, description: e.target.value })
            }
            placeholder="메모"
          />

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              취소
            </Button>
            <Button onClick={handleAddSchedule}>추가</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// 일정 아이템 컴포넌트
function ScheduleItem({
  schedule,
  onToggle,
  onDelete,
  showDate = false,
}: {
  schedule: Schedule;
  onToggle: () => void;
  onDelete: () => void;
  showDate?: boolean;
}) {
  const config = SCHEDULE_TYPE_CONFIG[schedule.type];
  const category = getCategoryById(schedule.categoryId);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
        schedule.isCompleted
          ? "border-green-200 bg-green-50/50"
          : "border-platinum bg-white hover:bg-ivory-50"
      }`}
    >
      <button
        onClick={onToggle}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          schedule.isCompleted
            ? "border-green-500 bg-green-500 text-white"
            : "border-taupe-400 hover:border-rose-500"
        }`}
      >
        {schedule.isCompleted && <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: config.color }}
          >
            {config.label}
          </span>
          {category && (
            <span className="text-xs text-taupe-400">
              {category.emoji} {category.name}
            </span>
          )}
        </div>
        <p
          className={`mt-1 text-sm font-medium ${
            schedule.isCompleted
              ? "text-taupe-400 line-through"
              : "text-noir-800"
          }`}
        >
          {schedule.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-taupe-400">
          {showDate && (
            <span className="flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              {new Date(schedule.date + "T00:00:00").toLocaleDateString("ko-KR", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {schedule.time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {schedule.time}
            </span>
          )}
          {schedule.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {schedule.location}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        className="rounded p-1 text-taupe-400 transition-colors hover:bg-ivory-200 hover:text-red-500"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
