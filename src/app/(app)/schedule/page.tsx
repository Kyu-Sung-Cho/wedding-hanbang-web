"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { List, Calendar } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "@/utils/checklist";
import { getEvents } from "@/utils/scheduleEvents";
import TimelineView from "@/components/app/schedule/TimelineView";
import CalendarView from "@/components/app/schedule/CalendarView";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import EventFormModal from "@/components/app/schedule/EventFormModal";
import type { ScheduleEvent, ProgressItem } from "@/types/database.types";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const CATEGORY_KEYS = [
  "venue", "studio", "dress", "makeup", "ring",
  "hanbok", "honeymoon", "houseware", "invitation", "gift",
];

export default function SchedulePage() {
  const { journey, updateJourney } = useAuthStore();
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("timeline");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 이벤트 CRUD 상태
  const [eventFormMode, setEventFormMode] = useState<"add" | "edit" | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDateForAdd, setSelectedDateForAdd] = useState<string | null>(null);

  const progress = (journey?.progress ?? {}) as Record<string, ProgressItem>;
  const weddingDate = journey?.wedding_date ? new Date(journey.wedding_date) : null;

  // 이벤트 목록
  const events = getEvents(progress as Record<string, unknown>);

  // 전체 체크리스트 기준 완료 수 계산
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

  // 캘린더 이벤트 CRUD
  const handleAddEvent = useCallback((date: string) => {
    setSelectedDateForAdd(date);
    setEditingEvent(null);
    setEventFormMode("add");
  }, []);

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
        // 수정
        const updatedEvents = currentEvents.map((e) =>
          e.id === editingEvent.id
            ? { ...e, ...data, updatedAt: new Date().toISOString() }
            : e
        );
        await updateJourney({
          progress: { ...progress, __events: updatedEvents } as unknown as Record<string, ProgressItem>,
        });
      } else {
        // 추가
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
          <TimelineView
            progress={progress}
            onToggleChecklistItem={handleToggleChecklistItem}
          />
        ) : (
          <div className="bg-white rounded-2xl p-6 border border-black/[0.04]">
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
      </motion.div>

      {/* 체크리스트 모달 (캘린더에서 카테고리 클릭 시) */}
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
