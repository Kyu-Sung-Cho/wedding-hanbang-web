"use client";

import { useState, useCallback, useMemo } from "react";
import { List, Calendar, Plus, Pencil, Trash2, CalendarDays, Sparkles } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";
import { getImminentCategories } from "@/utils/imminentChecklist";
import TimelineView from "@/components/app/schedule/TimelineView";
import CalendarView from "@/components/app/schedule/CalendarView";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import ImminentAlerts from "@/components/app/schedule/ImminentAlerts";
import EventFormModal from "@/components/app/schedule/EventFormModal";
import type { ScheduleEvent, ProgressItem } from "@/types/database.types";

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
};

export default function SchedulePage() {
  const { journey, updateJourney } = useAuthStore();
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("timeline");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 이벤트 CRUD 상태
  const [eventFormMode, setEventFormMode] = useState<"add" | "edit" | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDateForAdd, setSelectedDateForAdd] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;
  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;

  // 이벤트 목록
  const events = getEvents(progress as Record<string, unknown>);

  // 다가오는 일정
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = useMemo(() => {
    return events
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [events, todayStr]);

  // 임박 카테고리
  const imminentCategories = useMemo(
    () => getImminentCategories(progress, weddingDate),
    [progress, weddingDate]
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

      const template = CHECKLIST_MAP[categoryKey];
      if (!template) return;

      const existing = progress[categoryKey];
      const merged = mergeChecklist(
        template.items,
        existing?.checklist,
        existing?.status
      );
      const updated = merged.map((c) =>
        c.id === itemId ? { ...c, done: !c.done } : c
      );
      const newStatus = calculateStatus(updated);
      const newProgress: Record<string, ProgressItem> = {
        ...progress,
        [categoryKey]: {
          ...(existing ?? { category: categoryKey }),
          category: categoryKey,
          status: newStatus,
          checklist: updated,
        },
      };

      await updateJourney({ progress: newProgress });
    },
    [journey, progress, updateJourney]
  );

  // 이벤트 CRUD
  const handleAddEvent = useCallback((date: string) => {
    setSelectedDateForAdd(date);
    setEditingEvent(null);
    setEventFormMode("add");
  }, []);

  const handleAddEventQuick = useCallback(() => {
    setSelectedDateForAdd(todayStr);
    setEditingEvent(null);
    setEventFormMode("add");
  }, [todayStr]);

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

      if (eventFormMode === "edit" && editingEvent) {
        const updatedEvents = currentEvents.map((e) =>
          e.id === editingEvent.id
            ? { ...e, ...data, updatedAt: new Date().toISOString() }
            : e
        );
        await updateJourney({
          progress: { ...progress, __events: updatedEvents } as unknown as Record<string, ProgressItem>,
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
        await updateJourney({
          progress: { ...progress, __events: [...currentEvents, newEvent] } as unknown as Record<string, ProgressItem>,
        });
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

      await updateJourney({
        progress: { ...progress, __events: filtered } as unknown as Record<string, ProgressItem>,
      });

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
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-10">
        {/* Hero Banner */}
        <section className="relative rounded-2xl overflow-hidden aspect-[16/5] mb-8 animate-fade-in">
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(circle at 25% 50%, rgba(201, 169, 110, 0.35) 0%, transparent 55%),
                radial-gradient(circle at 75% 50%, rgba(121, 82, 82, 0.3) 0%, transparent 55%),
                linear-gradient(135deg, #f6f3f2 0%, #fcf9f8 50%, #dee6c4 100%)
              `,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-transparent" />
          <div className="relative h-full flex items-center px-10 lg:px-16">
            <div>
              <p className="text-xs tracking-widest uppercase text-[#795252] mb-3 font-medium">
                SCHEDULE
              </p>
              <h1 className="font-serif-kr text-5xl lg:text-6xl text-[#1b1c1c] mb-4 leading-tight">
                일정 관리
              </h1>
              <p className="text-xl text-[#504444] font-light italic">
                결혼식까지의 여정을 한눈에
              </p>
            </div>
          </div>
        </section>

        {/* 3-column Stat Row */}
        <div className="grid md:grid-cols-3 gap-6 mb-8 animate-fade-in">
          {/* D-day */}
          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
            <Sparkles className="absolute top-6 right-6 w-6 h-6 text-[#C9A96E]/30" />
            <p className="text-xs tracking-widest uppercase text-[#795252] mb-4 font-medium">
              D-DAY
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {dday !== null ? (dday >= 0 ? dday : `+${Math.abs(dday)}`) : "—"}
            </p>
            <p className="text-base text-[#504444]">
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
          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <p className="text-xs tracking-widest uppercase text-[#5a6147] mb-4 font-medium">
              PROGRESS
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {progressPct}%
            </p>
            <div className="w-full h-2 bg-[#f6f3f2] rounded-full overflow-hidden mt-4">
              <div
                className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-base text-[#504444] mt-2">
              {totalDone}/{totalItems} 완료
            </p>
          </div>

          {/* Upcoming count */}
          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <p className="text-xs tracking-widest uppercase text-[#C9A96E] mb-4 font-medium">
              UPCOMING
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {upcomingEvents.length}
            </p>
            <p className="text-base text-[#504444]">다가오는 일정</p>
          </div>
        </div>

        {/* Main content: left view + right sidebar */}
        <div className="grid lg:grid-cols-3 gap-8 animate-fade-in">
          {/* Left: View toggle + Timeline/Calendar (2 cols) */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            {/* View toggle header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-[#e4e2e1]">
              <div className="inline-flex bg-[#f6f3f2] rounded-xl p-1">
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-5 py-2.5 rounded-lg text-base font-medium transition-colors ${
                    viewMode === "timeline"
                      ? "bg-white text-[#1b1c1c] shadow-sm"
                      : "text-[#504444]"
                  }`}
                >
                  <List className="inline w-5 h-5 mr-2" />
                  타임라인
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={`px-5 py-2.5 rounded-lg text-base font-medium transition-colors ${
                    viewMode === "calendar"
                      ? "bg-white text-[#1b1c1c] shadow-sm"
                      : "text-[#504444]"
                  }`}
                >
                  <Calendar className="inline w-5 h-5 mr-2" />
                  캘린더
                </button>
              </div>
              <button
                onClick={handleAddEventQuick}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all"
              >
                <Plus className="w-5 h-5" />
                일정 추가
              </button>
            </div>

            {/* Timeline or Calendar content */}
            <div className="p-8">
              {viewMode === "timeline" ? (
                <TimelineView
                  progress={progress}
                  onToggleChecklistItem={handleToggleChecklistItem}
                  events={events}
                  onEditEvent={handleEditEvent}
                  onDeleteEvent={handleDeleteEvent}
                  onAddEvent={handleAddEventQuick}
                />
              ) : (
                <CalendarView
                  weddingDate={weddingDate}
                  progress={progress}
                  events={events}
                  onCategoryClick={handleCategoryClick}
                  onAddEvent={handleAddEvent}
                  onEditEvent={handleEditEvent}
                />
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-6">
            {/* Imminent Alerts */}
            {imminentCategories.length > 0 && (
              <div className="bg-white rounded-2xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <h3 className="font-serif-kr text-2xl text-[#1b1c1c] mb-5">
                  긴급 확인
                </h3>
                <ImminentAlerts
                  items={imminentCategories}
                  onCategoryClick={handleCategoryClick}
                />
              </div>
            )}

            {/* Upcoming Events */}
            <div className="bg-white rounded-2xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-serif-kr text-2xl text-[#1b1c1c]">
                  다가오는 일정
                </h3>
                <button
                  onClick={handleAddEventQuick}
                  className="flex items-center gap-1 text-sm text-[#795252] hover:text-[#946a6a] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  추가
                </button>
              </div>

              {upcomingEvents.length === 0 ? (
                <p className="text-base text-[#504444]">예정된 일정이 없어요</p>
              ) : (
                <div className="space-y-3">
                  {upcomingEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex items-center gap-4 p-4 rounded-xl hover:bg-[#f6f3f2] transition-colors group"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[#dee6c4]/40 flex items-center justify-center shrink-0">
                        <CalendarDays className="w-6 h-6 text-[#5a6147]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium text-[#1b1c1c] truncate">
                          {evt.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm text-[#504444] truncate">
                            {formatEventDate(evt.date)}
                          </p>
                          {evt.categoryKey && (
                            <span className="text-xs px-2 py-0.5 rounded bg-[#795252]/10 text-[#795252] flex-shrink-0">
                              {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#795252]/10 text-[#795252] text-sm font-medium">
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
