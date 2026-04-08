"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import type { ProgressItem } from "@/types/database.types";

interface ScheduleEvent {
  id: string;
  date: string;
  title: string;
  memo?: string;
  categoryKey?: string;
  createdAt: string;
  updatedAt: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-[#2E7D5A]",
  in_progress: "bg-rose-500",
  not_started: "bg-taupe-400",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "시작전",
};

// 페이즈 정의 (ddayStart 기준)
interface Phase {
  label: string;
  period: string;
  dday: string;
  categories: typeof CATEGORY_CHECKLISTS;
}

function buildPhases(): Phase[] {
  const phase1 = CATEGORY_CHECKLISTS.filter((c) => c.ddayStart >= 300);
  const phase2 = CATEGORY_CHECKLISTS.filter(
    (c) => c.ddayStart >= 200 && c.ddayStart < 300
  );
  const phase3 = CATEGORY_CHECKLISTS.filter(
    (c) => c.ddayStart >= 100 && c.ddayStart < 200
  );
  const phase4 = CATEGORY_CHECKLISTS.filter((c) => c.ddayStart < 100);

  return [
    {
      label: "초기 준비",
      period: "12~10개월 전",
      dday: "D-360 ~ D-270",
      categories: phase1,
    },
    {
      label: "핵심 계약",
      period: "10~6개월 전",
      dday: "D-270 ~ D-120",
      categories: phase2,
    },
    {
      label: "세부 준비",
      period: "6~3개월 전",
      dday: "D-180 ~ D-30",
      categories: phase3,
    },
    {
      label: "마무리",
      period: "3개월 ~ D-day",
      dday: "D-90 ~ D-14",
      categories: phase4,
    },
  ].filter((p) => p.categories.length > 0);
}

interface Props {
  progress: Record<string, ProgressItem>;
  onToggleChecklistItem: (categoryKey: string, itemId: string) => Promise<void>;
  events?: ScheduleEvent[];
  onEditEvent?: (event: ScheduleEvent) => void;
  onDeleteEvent?: (eventId: string) => void;
  onAddEvent?: () => void;
}

export default function TimelineView({
  progress,
  onToggleChecklistItem,
  events = [],
  onEditEvent,
  onDeleteEvent,
  onAddEvent,
}: Props) {
  const phases = useMemo(() => buildPhases(), []);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [togglingItem, setTogglingItem] = useState<string | null>(null);

  const getCategoryData = useCallback(
    (key: string) => {
      const template = CHECKLIST_MAP[key];
      if (!template) return { done: 0, total: 0, status: "not_started" as const };
      const existing = progress[key];
      const merged = mergeChecklist(
        template.items,
        existing?.checklist,
        existing?.status
      );
      const { done, total } = getChecklistCounts(merged);
      const status = existing?.status ?? "not_started";
      return { done, total, status, merged };
    },
    [progress]
  );

  const handleToggle = useCallback(
    async (categoryKey: string, itemId: string) => {
      if (togglingItem) return;
      setTogglingItem(itemId);
      try {
        await onToggleChecklistItem(categoryKey, itemId);
      } finally {
        setTogglingItem(null);
      }
    },
    [togglingItem, onToggleChecklistItem]
  );

  return (
    <div className="relative">
      <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-rose-500 via-gold to-platinum max-md:left-[15px]" />

      {phases.map((phase, pi) => {
        const isPhaseExpanded = expandedPhase === pi;

        // 페이즈 전체 완료 수
        const phaseStats = phase.categories.reduce(
          (acc, cat) => {
            const data = getCategoryData(cat.key);
            return {
              done: acc.done + data.done,
              total: acc.total + data.total,
            };
          },
          { done: 0, total: 0 }
        );
        const allPhaseDone =
          phaseStats.total > 0 && phaseStats.done === phaseStats.total;

        return (
          <motion.div
            key={phase.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: pi * 0.08 }}
            className="relative pl-12 mb-4 max-md:pl-10"
          >
            {/* 타임라인 점 */}
            <div
              className={`absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] ${
                allPhaseDone
                  ? "border-[#2E7D5A] bg-[#2E7D5A]"
                  : phaseStats.done > 0
                  ? "border-rose-500 bg-white"
                  : "border-taupe-400 bg-white"
              } max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]`}
            />

            {/* 페이즈 카드 */}
            <div className="w-full bg-white rounded-2xl border border-black/[0.04] overflow-hidden hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-shadow">
              {/* 페이즈 헤더 */}
              <button
                onClick={() =>
                  setExpandedPhase(isPhaseExpanded ? null : pi)
                }
                className="w-full flex items-center justify-between px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[21px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                    {phase.dday}
                  </span>
                  <span className="text-[21px] font-medium text-noir-800">
                    {phase.label}
                  </span>
                  <span className="text-[21px] text-taupe-400 font-light">
                    {phase.period}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[21px] text-taupe-400">
                    {phaseStats.done}/{phaseStats.total}
                  </span>
                  {isPhaseExpanded ? (
                    <ChevronUp className="w-4 h-4 text-taupe-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-taupe-400" />
                  )}
                </div>
              </button>

              {/* 페이즈 내 카테고리들 */}
              <AnimatePresence>
                {isPhaseExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-black/[0.03] px-4 pb-4">
                      {/* 이 페이즈 카테고리에 연결된 커스텀 일정 */}
                      {(() => {
                        const phaseCatKeys = phase.categories.map(c => c.key);
                        const phaseEvents = events.filter(e => e.categoryKey && phaseCatKeys.includes(e.categoryKey));
                        if (phaseEvents.length === 0) return null;
                        return (
                          <div className="mt-3 mb-2 px-3">
                            <div className="flex items-center gap-2 mb-2">
                              <CalendarDays className="w-3.5 h-3.5 text-gold" />
                              <span className="text-[21px] text-taupe-400 font-medium">등록된 일정</span>
                            </div>
                            {phaseEvents.map(evt => (
                              <div key={evt.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-ivory-50 group">
                                <div className="w-7 h-7 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                                  <CalendarDays className="w-3.5 h-3.5 text-gold" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[21px] font-medium text-noir-800">{evt.title}</p>
                                  <p className="text-[21px] text-taupe-400">{evt.date}{evt.memo ? ` · ${evt.memo}` : ""}</p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {onEditEvent && <button onClick={() => onEditEvent(evt)} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:text-rose-500"><Pencil className="w-3 h-3" /></button>}
                                  {onDeleteEvent && <button onClick={() => onDeleteEvent(evt.id)} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {phase.categories.map((cat) => {
                        const data = getCategoryData(cat.key);
                        const isCatExpanded = expandedCategory === cat.key;
                        const Icon = ICON_MAP[cat.icon] ?? Building2;
                        const percent =
                          data.total > 0
                            ? Math.round((data.done / data.total) * 100)
                            : 0;

                        return (
                          <div key={cat.key} className="mt-3">
                            {/* 카테고리 헤더 */}
                            <button
                              onClick={() =>
                                setExpandedCategory(
                                  isCatExpanded ? null : cat.key
                                )
                              }
                              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-ivory-50 transition-colors"
                            >
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/10 to-gold/10 flex items-center justify-center flex-shrink-0">
                                <Icon className="w-4 h-4 text-rose-500" />
                              </div>

                              <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[21px] font-medium text-noir-800">
                                    {cat.label}
                                  </span>
                                  <span
                                    className={`text-[21px] px-2 py-0.5 rounded-full text-white font-medium ${
                                      STATUS_COLORS[data.status]
                                    }`}
                                  >
                                    {STATUS_LABELS[data.status]}
                                  </span>
                                </div>
                                {/* 진행률 바 */}
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-ivory-warm rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all duration-500"
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                  <span className="text-[21px] text-taupe-400 flex-shrink-0">
                                    {data.done}/{data.total}
                                  </span>
                                </div>
                              </div>

                              <div className="flex-shrink-0">
                                {isCatExpanded ? (
                                  <ChevronUp className="w-4 h-4 text-taupe-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-taupe-400" />
                                )}
                              </div>
                            </button>

                            {/* 인라인 체크리스트 */}
                            <AnimatePresence>
                              {isCatExpanded && data.merged && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="ml-11 mr-2 mt-1 mb-2 border-l-2 border-rose-500/10 pl-3">
                                    {data.merged.map((item) => (
                                      <div
                                        key={item.id}
                                        onClick={() =>
                                          handleToggle(cat.key, item.id)
                                        }
                                        className={`flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-lg cursor-pointer hover:bg-ivory-50 transition-colors ${
                                          togglingItem === item.id
                                            ? "opacity-50 pointer-events-none"
                                            : ""
                                        }`}
                                      >
                                        <div className="flex-shrink-0">
                                          {item.done ? (
                                            <div className="w-5 h-5 rounded-full bg-[#2E7D5A] flex items-center justify-center">
                                              <Check className="w-3 h-3 text-white" />
                                            </div>
                                          ) : (
                                            <div className="w-5 h-5 rounded-full border-2 border-taupe-400 hover:border-rose-500 transition-colors" />
                                          )}
                                        </div>
                                        <span
                                          className={`text-[21px] leading-snug ${
                                            item.done
                                              ? "text-taupe-400 line-through"
                                              : "text-noir-800"
                                          }`}
                                        >
                                          {item.label}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        );
      })}

      {/* 카테고리 미지정 커스텀 일정 */}
      {(() => {
        const allCatKeys = CATEGORY_CHECKLISTS.map(c => c.key);
        const uncategorized = events.filter(e => !e.categoryKey || !allCatKeys.includes(e.categoryKey));
        if (uncategorized.length === 0 && !onAddEvent) return null;
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="relative pl-12 mb-4 max-md:pl-10"
          >
            <div className="absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] border-gold bg-white max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]" />
            <div className="w-full bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-[21px] text-gold bg-gold/10 px-2.5 py-1 rounded-full font-medium">내 일정</span>
                  <span className="text-[21px] font-medium text-noir-800">직접 추가한 일정</span>
                  <span className="text-[21px] text-taupe-400">{uncategorized.length}건</span>
                </div>
                {onAddEvent && (
                  <button
                    onClick={onAddEvent}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[21px] font-medium text-rose-500 bg-rose-500/5 hover:bg-rose-500/10 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    일정 추가
                  </button>
                )}
              </div>
              {uncategorized.length > 0 && (
                <div className="border-t border-black/[0.03] px-4 pb-4">
                  {uncategorized.map(evt => (
                    <div key={evt.id} className="flex items-center gap-3 mt-3 px-3 py-2 rounded-lg hover:bg-ivory-50 group">
                      <div className="w-8 h-8 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                        <CalendarDays className="w-4 h-4 text-gold" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[21px] font-medium text-noir-800">{evt.title}</p>
                        <p className="text-[21px] text-taupe-400">{evt.date}{evt.memo ? ` · ${evt.memo}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEditEvent && <button onClick={() => onEditEvent(evt)} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:text-rose-500"><Pencil className="w-3 h-3" /></button>}
                        {onDeleteEvent && <button onClick={() => onDeleteEvent(evt.id)} className="w-6 h-6 rounded flex items-center justify-center text-taupe-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        );
      })()}
    </div>
  );
}
