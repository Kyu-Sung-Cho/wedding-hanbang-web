"use client";

import { useState, useCallback, useMemo } from "react";
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
import {
  findCategoryScheduleEvent,
  getScheduleEventAssigneeLabel,
  getScheduleEventStatus,
  sanitizeUserFacingScheduleMemo,
  type ScheduleEventAssigneeContext,
} from "@/utils/scheduleEvents";
import type { ChecklistItem, ProgressItem, ScheduleEvent } from "@/types/database.types";

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
  completed: "bg-sage-500",
  in_progress: "bg-[#795252]",
  not_started: "bg-[#B5ADA3]",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "시작전",
};

// 페이즈 정의
interface Phase {
  label: string;
  period: string;
  dday: string;
  categories: typeof CATEGORY_CHECKLISTS;
}

const PHASE_DEFINITIONS = [
  { label: "준비 시작", matches: (days: number) => days >= 300 },
  { label: "주요 항목 정하기", matches: (days: number) => days >= 200 && days < 300 },
  { label: "세부 준비", matches: (days: number) => days >= 100 && days < 200 },
  { label: "마무리 준비", matches: (days: number) => days < 100 },
] as const;

function formatPhaseRange(categories: typeof CATEGORY_CHECKLISTS) {
  const startDays = categories.map((category) => category.ddayStart);
  const earliest = Math.max(...startDays);
  const latest = Math.min(...startDays);
  const earliestMonths = Math.round(earliest / 30);
  const latestMonths = Math.round(latest / 30);

  return {
    dday: earliest === latest ? `D-${earliest}` : `D-${earliest} ~ D-${latest}`,
    period:
      earliestMonths === latestMonths
        ? `약 ${earliestMonths}개월 전`
        : `약 ${earliestMonths}~${latestMonths}개월 전`,
  };
}

export function buildPhases(): Phase[] {
  return PHASE_DEFINITIONS.flatMap(({ label, matches }) => {
    const categories = CATEGORY_CHECKLISTS.filter((category) =>
      matches(category.ddayStart),
    );
    if (categories.length === 0) return [];

    return [{ label, categories, ...formatPhaseRange(categories) }];
  });
}

interface Props {
  progress: Record<string, ProgressItem>;
  onToggleChecklistItem: (categoryKey: string, item: ChecklistItem) => Promise<void>;
  events?: ScheduleEvent[];
  onEditEvent?: (event: ScheduleEvent) => void;
  onDeleteEvent?: (eventId: string) => Promise<void> | void;
  onAddEvent?: () => void;
  assigneeContext?: ScheduleEventAssigneeContext;
}

function formatShortDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function TimelineView({
  progress,
  onToggleChecklistItem,
  events = [],
  onEditEvent,
  onDeleteEvent,
  onAddEvent,
  assigneeContext = {},
}: Props) {
  const phases = useMemo(() => buildPhases(), []);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [togglingItem, setTogglingItem] = useState<string | null>(null);
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState("");

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
      const hasItemProgress = Boolean(existing?.checklist?.length);
      return { done, total, status, merged, hasItemProgress };
    },
    [progress]
  );

  const handleToggle = useCallback(
    async (categoryKey: string, item: ChecklistItem) => {
      if (togglingItem) return;
      setTogglingItem(item.id);
      setOperationError("");
      try {
        await onToggleChecklistItem(categoryKey, item);
      } catch {
        setOperationError(
          "체크리스트를 저장하지 못했어요. 최신 화면을 다시 불러온 뒤 다시 시도해 주세요.",
        );
      } finally {
        setTogglingItem(null);
      }
    },
    [togglingItem, onToggleChecklistItem]
  );

  const confirmDeleteEvent = useCallback(
    async (eventId: string) => {
      if (!onDeleteEvent || deletingEventId) return;
      setDeletingEventId(eventId);
      setOperationError("");
      try {
        await onDeleteEvent(eventId);
        setPendingDeleteEventId(null);
      } catch {
        setOperationError(
          "일정을 삭제하지 못했어요. 최신 화면을 다시 불러온 뒤 다시 시도해 주세요.",
        );
      } finally {
        setDeletingEventId(null);
      }
    },
    [deletingEventId, onDeleteEvent],
  );

  return (
    <>
      <p className="mb-3 rounded-[12px] border border-[#eadfc9]/70 bg-[#fffdf7] px-4 py-3 text-[12px] leading-5 text-[#626b69]">
        D-day 구간은 준비 순서를 정리하기 위한 기본 제안입니다. 실제 계약서와 업체·가족과 정한 날짜를
        먼저 따르세요.
      </p>
      {operationError && (
        <p
          role="alert"
          className="mb-3 rounded-[12px] border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-[12px] leading-5 text-[#8C3E3E]"
        >
          {operationError}
        </p>
      )}
      <div className="relative">
        <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-[#795252] max-md:left-[15px]" />

      {phases.map((phase, pi) => {
        const isPhaseExpanded = expandedPhase === pi;

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
          <div
            key={phase.label}
            className="relative mb-3 pl-9 animate-fade-in sm:pl-10"
          >
            {/* 타임라인 점 */}
            <div
              className={`absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] ${
                allPhaseDone
                  ? "border-sage-500 bg-sage-500"
                  : phaseStats.done > 0
                  ? "border-[#795252] bg-white"
                  : "border-[#B5ADA3] bg-white"
                } max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]`}
            />

            {/* 페이즈 카드 */}
            <div className="w-full overflow-hidden rounded-[14px] border border-[#eadfc9]/70 bg-white shadow-[0_6px_18px_rgba(8,22,38,0.03)] transition-shadow hover:shadow-[0_8px_24px_rgba(8,22,38,0.055)]">
              {/* 페이즈 헤더 */}
              <button
                onClick={() =>
                  setExpandedPhase(isPhaseExpanded ? null : pi)
                }
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded-full bg-[#f7f3ec] px-2.5 py-1 text-[12px] font-semibold text-[#36534E]">
                    {phase.dday}
                  </span>
                  <span className="min-w-0 text-[15px] font-semibold text-[#071629] sm:text-[16px]">
                    {phase.label}
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-[#7a8290]">
                    기본 제안 · {phase.period}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] font-medium text-[#7a8290]">
                    {phaseStats.done}/{phaseStats.total}
                  </span>
                  {isPhaseExpanded ? (
                    <ChevronUp className="w-5 h-5 text-[#B5ADA3]" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-[#B5ADA3]" />
                  )}
                </div>
              </button>

              {/* 페이즈 내 카테고리들 */}
              {isPhaseExpanded && (
                <div
                  className="overflow-hidden"
                >
                  <div className="border-t border-[#F6F3F2] px-4 pb-4">
                    {phase.categories.map((cat) => {
                      const data = getCategoryData(cat.key);
                      const isCatExpanded = expandedCategory === cat.key;
                      const Icon = ICON_MAP[cat.icon] ?? Building2;
                      const scheduledEvent = findCategoryScheduleEvent(events, cat.key, cat.label);
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
                            className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[#FAFAF8] sm:px-3"
                          >
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#f7f3ec]">
                              <Icon className="h-4 w-4 text-[#36534E]" />
                            </div>

                            <div className="flex-1 min-w-0 text-left">
                              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="min-w-0 text-[14px] font-semibold text-[#071629]">
                                  {cat.label}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${
                                    STATUS_COLORS[data.status]
                                  }`}
                                >
                                  {data.hasItemProgress || data.status === "not_started"
                                    ? STATUS_LABELS[data.status]
                                    : `${STATUS_LABELS[data.status]}으로 입력`}
                                </span>
                                {scheduledEvent && (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#36534E]/10 px-2 py-0.5 text-[11px] font-semibold text-[#36534E]">
                                    <CalendarDays className="h-3 w-3" />
                                    {getScheduleEventStatus(scheduledEvent) === "completed"
                                      ? "완료"
                                      : `일정 ${formatShortDate(scheduledEvent.date)}`}
                                  </span>
                                )}
                                {scheduledEvent && (
                                  <span className="max-w-full truncate rounded-full bg-[#f7f3ec] px-2 py-0.5 text-[11px] font-semibold text-[#5d6879]">
                                    {getScheduleEventAssigneeLabel(
                                      scheduledEvent.assignee,
                                      assigneeContext,
                                    )}
                                  </span>
                                )}
                              </div>
                              {data.hasItemProgress || data.status === "not_started" ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#efe6d7]">
                                    <div
                                      className="h-full rounded-full bg-[#36534E] transition-all duration-500"
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                  <span className="flex-shrink-0 text-[12px] font-medium text-[#7a8290]">
                                    {data.done}/{data.total}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[12px] font-medium text-[#7a8290]">
                                  세부 항목 확인 전
                                </span>
                              )}
                            </div>

                            <div className="flex-shrink-0">
                              {isCatExpanded ? (
                                <ChevronUp className="w-5 h-5 text-[#B5ADA3]" />
                              ) : (
                                <ChevronDown className="w-5 h-5 text-[#B5ADA3]" />
                              )}
                            </div>
                          </button>

                          {/* 인라인 체크리스트 */}
                          {isCatExpanded && data.merged && (
                            <div
                              className="overflow-hidden"
                            >
                              <div className="mb-2 ml-10 mr-1 mt-1 border-l-2 border-[#36534E]/15 pl-3 sm:ml-12">
                                {scheduledEvent?.completionCriteria && (
                                  <p className="mb-2 rounded-lg bg-[#f7faf6] px-3 py-2 text-[12px] font-medium leading-5 text-[#526056]">
                                    완료 기준 · {scheduledEvent.completionCriteria}
                                  </p>
                                )}
                                {data.merged.map((item) => (
                                  <div
                                    key={item.id}
                                    onClick={() =>
                                      handleToggle(cat.key, item)
                                    }
                                    className={`-mx-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#FAFAF8] ${
                                      togglingItem === item.id
                                        ? "opacity-50 pointer-events-none"
                                        : ""
                                    }`}
                                  >
                                    <div className="flex-shrink-0">
                                      {item.done ? (
                                        <div className="flex h-5 w-5 rounded-full bg-[#36534E] items-center justify-center">
                                          <Check className="w-4 h-4 text-white" />
                                        </div>
                                      ) : (
                                        <div className="h-5 w-5 rounded-full border-2 border-[#B5ADA3] transition-colors hover:border-[#36534E]" />
                                      )}
                                    </div>
                                    <span
                                      className={`text-[14px] leading-snug ${
                                        item.done
                                          ? "text-[#B5ADA3] line-through"
                                          : "text-[#504444]"
                                      }`}
                                    >
                                      {item.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 카테고리 미지정 커스텀 일정 */}
      {(() => {
        const allCatKeys = CATEGORY_CHECKLISTS.map(c => c.key);
        const uncategorized = events.filter(e => !e.categoryKey || !allCatKeys.includes(e.categoryKey));
        if (uncategorized.length === 0 && !onAddEvent) return null;
        return (
          <div
            className="relative pl-12 mb-4 max-md:pl-10 animate-fade-in"
          >
            <div className="absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] border-[#C9A96E] bg-white max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]" />
            <div className="w-full bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center justify-between px-6 py-5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#C9A96E] bg-[#C9A96E]/10 px-2.5 py-1 rounded-full font-medium">내 일정</span>
                  <span className="font-serif-kr text-[18px] font-light text-[#1A1A1F]">직접 추가한 일정</span>
                  <span className="text-sm text-[#B5ADA3]">{uncategorized.length}건</span>
                </div>
                {onAddEvent && (
                  <button
                    onClick={onAddEvent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[#795252] bg-[#795252]/5 hover:bg-[#795252]/10 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    일정 추가
                  </button>
                )}
              </div>
              {uncategorized.length > 0 && (
                <div className="border-t border-[#F6F3F2] px-4 pb-4">
                  {uncategorized.map(evt => (
                    <div key={evt.id} className="flex items-center gap-3 mt-3 px-3 py-2.5 rounded-lg hover:bg-[#FAFAF8] group">
                      <div className="w-10 h-10 rounded-xl bg-[#C9A96E]/10 flex items-center justify-center flex-shrink-0">
                        <CalendarDays className="w-5 h-5 text-[#C9A96E]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p
                            className={`font-serif-kr text-base font-normal ${
                              getScheduleEventStatus(evt) === "completed"
                                ? "text-[#6D806E] line-through"
                                : "text-[#1A1A1F]"
                            }`}
                          >
                            {evt.title}
                          </p>
                          <span className="rounded-full bg-[#f7f3ec] px-2 py-0.5 text-[11px] font-semibold text-[#5d6879]">
                            {getScheduleEventStatus(evt) === "completed"
                              ? "완료"
                              : "예정"}
                          </span>
                          <span className="max-w-full truncate rounded-full bg-[#f7f3ec] px-2 py-0.5 text-[11px] font-semibold text-[#5d6879]">
                            {getScheduleEventAssigneeLabel(
                              evt.assignee,
                              assigneeContext,
                            )}
                          </span>
                        </div>
                        <p className="text-sm text-[#7a8290]">
                          {evt.date}
                          {sanitizeUserFacingScheduleMemo(evt.memo)
                            ? ` · ${sanitizeUserFacingScheduleMemo(evt.memo)}`
                            : ""}
                        </p>
                        {evt.completionCriteria && (
                          <p className="mt-1 text-[12px] font-medium leading-5 text-[#526056]">
                            완료 기준 · {evt.completionCriteria}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {pendingDeleteEventId === evt.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void confirmDeleteEvent(evt.id)}
                              disabled={Boolean(deletingEventId)}
                              className="rounded-md bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                            >
                              {deletingEventId === evt.id ? "삭제 중..." : "삭제 확인"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteEventId(null)}
                              disabled={Boolean(deletingEventId)}
                              className="rounded-md bg-[#f6f3f2] px-2 py-1 text-xs font-medium text-[#504444] hover:bg-[#EFEBEA] disabled:opacity-50"
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            {onEditEvent && (
                              <button
                                type="button"
                                aria-label={`${evt.title} 일정 수정`}
                                onClick={() => onEditEvent(evt)}
                                className="w-7 h-7 rounded flex items-center justify-center text-[#B5ADA3] hover:text-[#795252]"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {onDeleteEvent && (
                              <button
                                type="button"
                                aria-label={`${evt.title} 일정 삭제`}
                                onClick={() => setPendingDeleteEventId(evt.id)}
                                className="w-7 h-7 rounded flex items-center justify-center text-[#B5ADA3] hover:text-red-400"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </div>
    </>
  );
}
