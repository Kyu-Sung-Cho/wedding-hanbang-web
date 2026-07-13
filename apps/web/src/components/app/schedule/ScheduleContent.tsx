"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { List, Calendar, Plus, Pencil, Trash2, CalendarDays, Sparkles, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "@/utils/checklist";
import { findCategoryScheduleEvent, getEvents, upsertCategoryEvent } from "@/utils/scheduleEvents";
import { getImminentCategories } from "@/utils/imminentChecklist";
import TimelineView from "@/components/app/schedule/TimelineView";
import CalendarView from "@/components/app/schedule/CalendarView";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import ImminentAlerts from "@/components/app/schedule/ImminentAlerts";
import EventFormModal from "@/components/app/schedule/EventFormModal";
import { weddingPath } from "@/lib/weddingPaths";
import type { ChecklistItem, ScheduleEvent, ProgressItem } from "@/types/database.types";
import { formatLocalDateOnly, parseLocalDateOnly } from "@hanbang/shared";

const CATEGORY_KEYS = [
  "meeting", "venue", "studio", "dress", "makeup", "ring",
  "hanbok", "yedan", "honeymoon", "houseware", "housing",
  "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
];

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례", venue: "예식장", studio: "스튜디오",
  dress: "드레스/턱시도", makeup: "메이크업", ring: "예물(반지)",
  hanbok: "한복", yedan: "예단", honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)", housing: "신혼집", invitation: "청첩장",
  snap: "본식스냅/영상", shoes: "웨딩구두", bouquet: "부케/꽃장식",
  gift: "답례품", mc: "사회/축가", ham: "함", pyebaek: "폐백",
  etiquette: "예절가이드",
};

interface PendingChecklistSchedule {
  categoryKey: string;
  itemId: string;
  itemLabel: string;
  categoryLabel: string;
  existingEvent?: ScheduleEvent;
}

function buildChecklistProgress(
  baseProgress: Record<string, unknown>,
  categoryKey: string,
  itemId: string,
  nextDone?: boolean
): Record<string, unknown> {
  const template = CHECKLIST_MAP[categoryKey];
  if (!template) return baseProgress;

  const existing = baseProgress[categoryKey] as ProgressItem | undefined;
  const merged = mergeChecklist(
    template.items,
    existing?.checklist,
    existing?.status
  );
  const current = merged.find((item) => item.id === itemId);
  if (!current) return baseProgress;

  const updated = merged.map((item) =>
    item.id === itemId
      ? { ...item, done: nextDone ?? !item.done }
      : item
  );
  const newStatus = calculateStatus(updated);

  return {
    ...baseProgress,
    [categoryKey]: {
      ...(existing ?? { category: categoryKey }),
      category: categoryKey,
      status: newStatus,
      checklist: updated,
    },
  };
}

interface ScheduleContentProps {
  /** 패널/오버레이 안에서 렌더되는지 여부. true면 풀스크린 chrome 제거. */
  embedded?: boolean;
}

export default function ScheduleContent({ embedded = false }: ScheduleContentProps = {}) {
  const { journey, updateJourney } = useAuthStore();
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("timeline");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 이벤트 CRUD 상태
  const [eventFormMode, setEventFormMode] = useState<"add" | "edit" | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDateForAdd, setSelectedDateForAdd] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingChecklistSchedule, setPendingChecklistSchedule] =
    useState<PendingChecklistSchedule | null>(null);

  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress]
  );
  const weddingDateValue = journey?.wedding_date;
  const weddingDate = useMemo(
    () => (weddingDateValue ? parseLocalDateOnly(weddingDateValue) : null),
    [weddingDateValue]
  );

  // 이벤트 목록
  const events = useMemo(() => getEvents(progress as Record<string, unknown>), [progress]);

  // 다가오는 일정
  const todayStr = formatLocalDateOnly(new Date());
  const upcomingEvents = useMemo(() => {
    return events
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [events, todayStr]);

  // 임박 카테고리
  const imminentCategories = useMemo(
    () => getImminentCategories(progress, weddingDate, events),
    [progress, weddingDate, events]
  );

  // 전체 체크리스트 완료 수
  const { totalDone, totalItems } = CATEGORY_KEYS.reduce(
    (acc, key) => {
      const template = CHECKLIST_MAP[key];
      if (!template) return acc;
      const existing = progress[key];
      const merged = mergeChecklist(template.items, existing?.checklist, existing?.status);
      const { done, total } = getChecklistCounts(merged);
      return { totalDone: acc.totalDone + done, totalItems: acc.totalItems + total };
    },
    { totalDone: 0, totalItems: 0 }
  );

  const today = new Date();
  const dday = weddingDate
    ? Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const handleCategoryClick = useCallback((key: string) => {
    setSelectedCategory(key);
  }, []);

  // 타임라인 인라인 체크리스트 토글
  const handleToggleChecklistItem = useCallback(
    async (categoryKey: string, itemId: string) => {
      if (!journey) return;

      const newProgress = buildChecklistProgress(
        progress as unknown as Record<string, unknown>,
        categoryKey,
        itemId
      );

      await updateJourney({ progress: newProgress as unknown as Record<string, ProgressItem> });
    },
    [journey, progress, updateJourney]
  );

  const handleChecklistItemClick = useCallback(
    async (categoryKey: string, item: ChecklistItem) => {
      if (item.done) {
        await handleToggleChecklistItem(categoryKey, item.id);
        return;
      }

      const categoryLabel = CATEGORY_LABELS[categoryKey] ?? categoryKey;
      const existingEvent = findCategoryScheduleEvent(events, categoryKey, categoryLabel);
      setPendingChecklistSchedule({
        categoryKey,
        itemId: item.id,
        itemLabel: item.label,
        categoryLabel,
        existingEvent,
      });
    },
    [events, handleToggleChecklistItem]
  );

  const completeChecklistWithSchedule = useCallback(
    async (data: { date?: string; memo?: string }) => {
      if (!journey || !pendingChecklistSchedule) return;

      let nextProgress = progress as unknown as Record<string, unknown>;

      if (data.date) {
        const upserted = upsertCategoryEvent(
          nextProgress,
          {
            date: data.date,
            title: pendingChecklistSchedule.categoryLabel,
            memo: data.memo?.trim() || pendingChecklistSchedule.itemLabel,
            categoryKey: pendingChecklistSchedule.categoryKey,
          },
          pendingChecklistSchedule.categoryLabel
        );
        nextProgress = upserted.newProgress;
      }

      nextProgress = buildChecklistProgress(
        nextProgress,
        pendingChecklistSchedule.categoryKey,
        pendingChecklistSchedule.itemId,
        true
      );

      await updateJourney({ progress: nextProgress as unknown as Record<string, ProgressItem> });
      setPendingChecklistSchedule(null);
    },
    [journey, pendingChecklistSchedule, progress, updateJourney]
  );

  // 이벤트 CRUD
  const handleAddEvent = useCallback((date: string) => {
    setSelectedDateForAdd(date);
    setEditingEvent(null);
    setEventFormMode("add");
  }, []);

  const handleAddEventQuick = useCallback(() => {
    setSelectedDateForAdd(null);
    setEditingEvent(null);
    setEventFormMode("add");
  }, []);

  // 대시보드에서 ?new=1 진입 시 자동으로 일정 추가 모달 오픈 (단 1회)
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (searchParams.get("new") === "1") {
      autoOpenedRef.current = true;
      const timer = window.setTimeout(() => {
        handleAddEventQuick();
      }, 0);
      // URL에서 query 제거 (모달 닫고 새로고침해도 다시 안 열리도록)
      router.replace(weddingPath("/schedule"));
      return () => window.clearTimeout(timer);
    }
  }, [searchParams, router, handleAddEventQuick]);

  const handleEditEvent = useCallback((event: ScheduleEvent) => {
    setEditingEvent(event);
    setSelectedDateForAdd(null);
    setEventFormMode("edit");
  }, []);

  const handleSaveEvent = useCallback(
    async (data: { date: string; title: string; memo?: string; categoryKey?: string }) => {
      if (!journey) return;

      const progressObj = progress as Record<string, unknown>;
      const currentEvents = getEvents(progressObj);
      let saved = false;

      if (eventFormMode === "edit" && editingEvent) {
        const updatedEvents = currentEvents.map((e) =>
          e.id === editingEvent.id
            ? { ...e, ...data, updatedAt: new Date().toISOString() }
            : e
        );
        saved = await updateJourney({
          progress: { ...progress, __events: updatedEvents } as unknown as Record<string, ProgressItem>,
        });
      } else if (data.categoryKey && data.categoryKey !== "general") {
        const { newProgress } = upsertCategoryEvent(
          progressObj,
          data,
          CATEGORY_LABELS[data.categoryKey]
        );
        saved = await updateJourney({
          progress: newProgress as unknown as Record<string, ProgressItem>,
        });
      } else {
        const now = new Date().toISOString();
        const newEvent: ScheduleEvent = {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          date: data.date,
          title: data.title,
          memo: data.memo,
          categoryKey: data.categoryKey,
          createdAt: now,
          updatedAt: now,
        };
        saved = await updateJourney({
          progress: { ...progress, __events: [...currentEvents, newEvent] } as unknown as Record<string, ProgressItem>,
        });
      }

      if (!saved) {
        throw new Error("일정을 저장하지 못했습니다. 입력한 내용은 그대로 두었으니 다시 시도해주세요.");
      }

      setEventFormMode(null);
      setEditingEvent(null);
      setSelectedDateForAdd(null);
    },
    [journey, progress, eventFormMode, editingEvent, updateJourney]
  );

  const handleDeleteEvent = useCallback(
    async (eventId: string) => {
      if (!journey) return;

      const progressObj = progress as Record<string, unknown>;
      const currentEvents = getEvents(progressObj);
      const filtered = currentEvents.filter((e) => e.id !== eventId);

      const deleted = await updateJourney({
        progress: { ...progress, __events: filtered } as unknown as Record<string, ProgressItem>,
      });

      if (!deleted) {
        throw new Error("일정을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }

      setEventFormMode(null);
      setEditingEvent(null);
    },
    [journey, progress, updateJourney]
  );

  // 날짜 포맷
  function formatEventDate(dateString: string): string {
    const d = new Date(dateString + "T00:00:00");
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
  }

  // D-day
  function getDaysUntil(dateString: string): string {
    const diff = Math.ceil(
      (new Date(dateString + "T00:00:00").getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (diff === 0) return "오늘";
    if (diff === 1) return "내일";
    if (diff < 0) return `${Math.abs(diff)}일 전`;
    return `${diff}일 후`;
  }

  const progressPct = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;

  return (
    <div className={embedded ? "bg-[#fcf9f8]" : ""}>
      <div
        className={
          embedded
            ? "max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-6 sm:py-8 md:py-10"
            : "space-y-4"
        }
      >
        {/* 3-column Stat Row */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 animate-fade-in">
          {/* D-day */}
          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
            <Sparkles className="absolute right-4 top-4 h-5 w-5 text-[#36534E]/25" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              D-DAY
            </p>
            <p className="mt-3 font-serif-kr text-[30px] font-medium leading-none text-[#071629] sm:text-[32px] lg:text-[34px]">
              {dday !== null ? (dday >= 0 ? dday : `+${Math.abs(dday)}`) : "—"}
            </p>
            <p className="mt-3 text-[13px] font-medium text-[#5d6879]">
              {dday === null
                ? "날짜 미정"
                : dday > 0
                ? "일 남음"
                : dday === 0
                ? "결혼식 당일"
                : "일 지남"}
            </p>
          </div>

          {/* Progress */}
          <div className="rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              PROGRESS
            </p>
            <p className="mt-3 font-serif-kr text-[30px] font-medium leading-none text-[#071629] sm:text-[32px] lg:text-[34px]">
              {progressPct}%
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
              <div
                className="h-full rounded-full bg-[#36534E] transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] font-medium text-[#5d6879]">
              {totalDone}/{totalItems} 완료
            </p>
          </div>

          {/* Upcoming count */}
          <div className="rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              UPCOMING
            </p>
            <p className="mt-3 font-serif-kr text-[30px] font-medium leading-none text-[#071629] sm:text-[32px] lg:text-[34px]">
              {upcomingEvents.length}
            </p>
            <p className="mt-3 text-[13px] font-medium text-[#5d6879]">다가오는 일정</p>
          </div>
        </div>

        {/* Main content: left view + right sidebar */}
        <div className="grid grid-cols-1 gap-4 animate-fade-in xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
          {/* Left: View toggle + Timeline/Calendar (2 cols) */}
          <div className="overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)]">
            {/* View toggle header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadfc9] px-4 py-3 md:px-5">
              <div className="inline-flex rounded-[14px] bg-[#f7f3ec] p-1">
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`inline-flex items-center rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                    viewMode === "timeline"
                      ? "bg-white text-[#071629] shadow-sm"
                      : "text-[#5d6879]"
                  }`}
                >
                  <List className="mr-1.5 h-4 w-4" />
                  타임라인
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={`inline-flex items-center rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                    viewMode === "calendar"
                      ? "bg-white text-[#071629] shadow-sm"
                      : "text-[#5d6879]"
                  }`}
                >
                  <Calendar className="mr-1.5 h-4 w-4" />
                  캘린더
                </button>
              </div>
              <button
                onClick={handleAddEventQuick}
                className="inline-flex items-center gap-2 rounded-full bg-[#36534E] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)] transition-colors hover:bg-[#2d4642]"
              >
                <Plus className="h-4 w-4" />
                일정 추가
              </button>
            </div>

            {/* Timeline or Calendar content */}
            <div className="p-3 sm:p-4 md:p-5">
              {viewMode === "timeline" ? (
                <TimelineView
                  progress={progress}
                  onToggleChecklistItem={handleChecklistItemClick}
                  events={events}
                  onEditEvent={handleEditEvent}
                  onDeleteEvent={handleDeleteEvent}
                  onAddEvent={handleAddEventQuick}
                />
              ) : (
                <CalendarView
                  weddingDate={weddingDate}
                  events={events}
                  onAddEvent={handleAddEvent}
                  onEditEvent={handleEditEvent}
                />
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="grid self-start gap-4 lg:grid-cols-2 xl:grid-cols-1">
            {/* Imminent Alerts */}
            {imminentCategories.length > 0 && (
              <div className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
                <h3 className="mb-3 font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">
                  긴급 확인
                </h3>
                <ImminentAlerts
                  items={imminentCategories}
                  onCategoryClick={handleCategoryClick}
                />
              </div>
            )}

            {/* Upcoming Events */}
            <div className="rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] md:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629]">
                  다가오는 일정
                </h3>
                <button
                  onClick={handleAddEventQuick}
                  className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#36534E] transition-colors hover:text-[#2d4642]"
                >
                  <Plus className="w-4 h-4" />
                  추가
                </button>
              </div>

              {upcomingEvents.length === 0 ? (
                <p className="text-[14px] font-medium text-[#5d6879]">예정된 일정이 없어요</p>
              ) : (
                <div className="space-y-3">
                  {upcomingEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="group flex items-start gap-3 rounded-[14px] border border-[#eadfc9]/70 bg-[#fffdf7] p-3 transition-colors hover:bg-white"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#36534E] shadow-[0_4px_12px_rgba(8,22,38,0.04)]">
                        <CalendarDays className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#071629]">
                          {evt.title}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="text-[12px] font-medium text-[#5d6879]">
                            {formatEventDate(evt.date)}
                          </p>
                          {evt.categoryKey && (
                            <span className="max-w-full truncate rounded-full bg-[#f7f3ec] px-2 py-0.5 text-[11px] font-semibold text-[#36534E]">
                              {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="inline-flex items-center rounded-full bg-[#f7f3ec] px-2.5 py-1 text-[12px] font-semibold text-[#36534E]">
                          {getDaysUntil(evt.date)}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {pendingDeleteId === evt.id ? (
                            <>
                              <button
                                onClick={() => {
                                  handleDeleteEvent(evt.id);
                                  setPendingDeleteId(null);
                                }}
                                className="px-2 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                              >
                                삭제
                              </button>
                              <button
                                onClick={() => setPendingDeleteId(null)}
                                className="px-2 py-1 rounded-md text-xs font-medium bg-[#f6f3f2] text-[#504444] hover:bg-[#EFEBEA] transition-colors"
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEditEvent(evt)}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-[#d4c2c2] hover:bg-[#f6f3f2] hover:text-[#795252] transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setPendingDeleteId(evt.id)}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-[#d4c2c2] hover:bg-red-50 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 체크리스트 모달 */}
        <CategoryChecklistModal
          categoryKey={selectedCategory ?? ""}
          isOpen={!!selectedCategory}
          onClose={() => setSelectedCategory(null)}
        />

        <ChecklistSchedulePrompt
          pending={pendingChecklistSchedule}
          onClose={() => setPendingChecklistSchedule(null)}
          onComplete={completeChecklistWithSchedule}
        />

        {/* 이벤트 추가/수정 모달 */}
        <EventFormModal
          isOpen={eventFormMode !== null}
          mode={eventFormMode ?? "add"}
          event={editingEvent}
          defaultDate={selectedDateForAdd}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? () => handleDeleteEvent(editingEvent.id) : undefined}
          onClose={() => {
            setEventFormMode(null);
            setEditingEvent(null);
            setSelectedDateForAdd(null);
          }}
        />
      </div>
    </div>
  );
}

function ChecklistSchedulePrompt({
  pending,
  onClose,
  onComplete,
}: {
  pending: PendingChecklistSchedule | null;
  onClose: () => void;
  onComplete: (data: { date?: string; memo?: string }) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pending) return;
    setDate(pending.existingEvent?.date ?? "");
    setMemo(pending.existingEvent?.memo ?? pending.itemLabel);
  }, [pending]);

  if (!pending) return null;

  const saveWithDate = async () => {
    if (!date || saving) return;
    setSaving(true);
    try {
      await onComplete({ date, memo });
    } finally {
      setSaving(false);
    }
  };

  const completeOnly = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onComplete({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 animate-fade-in bg-[#1A1A1F]/40 backdrop-blur-sm"
      />
      <section className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-[540px] overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white shadow-[0_24px_70px_rgba(6,26,52,0.2)] animate-fade-in">
        <div className="flex items-start justify-between gap-4 border-b border-[#eadfc9] bg-[#fffdf7] px-6 py-5">
          <div>
            <p className="text-[12px] font-semibold text-[#36534E]">
              체크리스트 일정 연결
            </p>
            <h3 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">
              {pending.categoryLabel} 날짜도 정할까요?
            </h3>
            <p className="mt-2 text-[13px] font-medium leading-[1.6] text-[#5d6879]">
              {pending.itemLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8f857b] transition-colors hover:bg-[#f7f3ec]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-[#6d625a]">
              날짜
            </label>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-xl border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-[15px] font-medium text-[#071629] outline-none transition-all focus:border-[#36534E] focus:bg-white focus:ring-2 focus:ring-[#36534E]/15"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-[#6d625a]">
              메모
            </label>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-[14px] font-medium leading-[1.65] text-[#071629] outline-none transition-all focus:border-[#36534E] focus:bg-white focus:ring-2 focus:ring-[#36534E]/15"
            />
          </div>
          {pending.existingEvent && (
            <p className="rounded-xl bg-[#36534E]/10 px-4 py-3 text-[13px] font-medium leading-[1.55] text-[#36534E]">
              이미 등록된 {pending.categoryLabel} 일정이 있어요. 저장하면 새로 만들지 않고 기존 일정 날짜를 바꿉니다.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#eadfc9] bg-[#fffdf7] px-6 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={completeOnly}
            disabled={saving}
            className="rounded-full border border-[#eadfc9] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec] disabled:opacity-50"
          >
            날짜 없이 완료
          </button>
          <button
            type="button"
            onClick={saveWithDate}
            disabled={saving || !date}
            className="rounded-full bg-[#36534E] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2d4642] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending.existingEvent ? "일정 수정하고 완료" : "일정 저장하고 완료"}
          </button>
        </div>
      </section>
    </>
  );
}
