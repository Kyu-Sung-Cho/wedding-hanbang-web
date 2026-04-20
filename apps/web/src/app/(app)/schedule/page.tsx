"use client";

import { useState, useCallback, useMemo } from "react";
import { List, Calendar, Plus, Pencil, Trash2, CalendarDays } from "lucide-react";
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
  const dateStr = weddingDate
    ? `${weddingDate.getFullYear()}년 ${weddingDate.getMonth() + 1}월 ${weddingDate.getDate()}일`
    : "날짜 미정";

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
    <div className="max-w-[900px] mx-auto bg-[#FAFAF8]">
      {/* 페이지 타이틀 */}
      <div className="mb-8 animate-fade-in">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#B5ADA3] mb-2">Atelier · Schedule</p>
        <h1 className="font-serif-kr text-[32px] font-light text-[#1A1A1F]">일정 관리</h1>
        <p className="text-[13px] text-[#504444] mt-1 font-light">결혼식까지의 모든 준비 일정을 한 곳에서 관리하세요.</p>
      </div>

      {/* 상단 요약 카드 */}
      <div
        className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 mb-6 animate-fade-in"
      >
        <div className="flex items-center justify-between max-md:flex-col max-md:gap-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#B5ADA3] mb-2">전체 체크리스트</p>
            <p className="text-[14px] text-[#504444]">
              <span className="font-serif-kr text-4xl font-light text-[#1A1A1F]">
                {totalDone}
              </span>
              <span className="text-[#B5ADA3] mx-1.5 font-serif-kr text-[24px] font-light">/</span>
              <span className="font-serif-kr text-[28px] font-light text-[#B5ADA3]">
                {totalItems}
              </span>
              <span className="text-[12px] text-[#B5ADA3] ml-2 uppercase tracking-widest">완료</span>
            </p>
          </div>
          <div className="text-right max-md:text-left max-md:w-full">
            <div className="flex items-center gap-3 mb-3 max-md:justify-between">
              <span className="text-[11px] uppercase tracking-widest text-[#B5ADA3]">결혼 예정일</span>
              <span className="font-serif-kr text-[15px] font-normal text-[#1A1A1F]">{dateStr}</span>
              {dday !== null && (
                <span className="text-[11px] text-white bg-[#795252] px-3 py-1 rounded-full font-medium">
                  {dday > 0 ? `D-${dday}` : dday === 0 ? "D-Day" : `D+${Math.abs(dday)}`}
                </span>
              )}
            </div>
            <div className="w-[240px] max-md:w-full">
              <div className="h-2 bg-[#F6F3F2] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] text-[#B5ADA3] mt-1.5 text-right">
                {progressPct}% 달성
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 임박 체크리스트 */}
      <ImminentAlerts
        items={imminentCategories}
        onCategoryClick={handleCategoryClick}
      />

      {/* 다가오는 일정 */}
      {upcomingEvents.length > 0 && (
        <div
          className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6 overflow-hidden animate-fade-in"
        >
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#795252]" />
              <h3 className="font-serif-kr text-[16px] font-light text-[#1A1A1F]">다가오는 일정</h3>
              <span className="text-[11px] text-[#B5ADA3]">{upcomingEvents.length}건</span>
            </div>
            <button
              onClick={handleAddEventQuick}
              className="flex items-center gap-1 text-[11px] text-[#795252] hover:text-[#946a6a] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              일정 추가
            </button>
          </div>
          <div className="divide-y divide-[#F6F3F2]">
            {upcomingEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 px-6 py-3.5 hover:bg-[#FAFAF8] transition-colors group"
              >
                {/* 날짜 */}
                <div className="flex-shrink-0 w-[60px] text-center">
                  <p className="font-serif-kr text-[15px] font-normal text-[#1A1A1F]">
                    {formatEventDate(evt.date).split(" ")[0]}
                  </p>
                  <p className="text-[10px] text-[#B5ADA3]">
                    {formatEventDate(evt.date).split(" ")[1]}
                  </p>
                </div>
                {/* 구분선 */}
                <div className="w-[3px] h-10 rounded-full bg-[#795252]/30 flex-shrink-0" />
                {/* 내용 */}
                <div className="flex-1 min-w-0">
                  <p className="font-serif-kr text-[14px] text-[#1A1A1F] font-normal truncate">
                    {evt.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {evt.memo && (
                      <p className="text-[11px] text-[#504444] truncate">{evt.memo}</p>
                    )}
                    {evt.categoryKey && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#795252]/10 text-[#795252] flex-shrink-0">
                        {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                      </span>
                    )}
                  </div>
                </div>
                {/* D-day */}
                <span className="text-[11px] text-[#B5ADA3] flex-shrink-0">
                  {getDaysUntil(evt.date)}
                </span>
                {/* 편집/삭제 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {pendingDeleteId === evt.id ? (
                    <>
                      <button
                        onClick={() => { handleDeleteEvent(evt.id); setPendingDeleteId(null); }}
                        className="px-2 py-1 rounded-lg text-[10px] font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        삭제
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="px-2 py-1 rounded-lg text-[10px] font-medium bg-[#F6F3F2] text-[#504444] hover:bg-[#EFEBEA] transition-colors"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEditEvent(evt)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#F6F3F2] hover:text-[#795252] transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(evt.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-red-50 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 탭 전환 + 일정 추가 */}
      <div
        className="flex items-center justify-between mb-6 animate-fade-in"
      >
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-1">
          <button
            onClick={() => setViewMode("timeline")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              viewMode === "timeline"
                ? "bg-[#795252] text-white"
                : "text-[#504444] hover:bg-[#F6F3F2]"
            }`}
          >
            <List className="w-4 h-4" />
            타임라인
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              viewMode === "calendar"
                ? "bg-[#795252] text-white"
                : "text-[#504444] hover:bg-[#F6F3F2]"
            }`}
          >
            <Calendar className="w-4 h-4" />
            캘린더
          </button>
        </div>
        <button
          onClick={handleAddEventQuick}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[#795252] hover:bg-[#946a6a] transition-colors shadow-[0_4px_16px_rgb(121,82,82,0.2)]"
        >
          <Plus className="w-4 h-4" />
          일정 추가
        </button>
      </div>

      {/* 뷰 */}
      <div className="animate-fade-in">
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
          <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
            <CalendarView
              weddingDate={weddingDate}
              progress={progress}
              events={events}
              onCategoryClick={handleCategoryClick}
              onAddEvent={handleAddEvent}
              onEditEvent={handleEditEvent}
            />
          </div>
        )}
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
  );
}
