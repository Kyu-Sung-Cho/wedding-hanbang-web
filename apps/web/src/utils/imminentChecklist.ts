import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import { findCategoryScheduleEvent } from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";

export interface ImminentCategory {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  doneCount: number;
  totalCount: number;
  deadlineDaysLeft: number;
  hasScheduledEvent: boolean;
  urgency: "overdue" | "urgent" | "soon";
}

/**
 * D-day 기준 임박 카테고리 계산
 * 마감일 = weddingDate - ddayDeadline (결혼식 N일 전까지 완료 권장)
 * 필터: status !== "completed" && 마감일까지 60일 이내
 */
export function getImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: Date | null,
  events: ScheduleEvent[] = []
): ImminentCategory[] {
  if (!weddingDate) return [];

  const now = new Date();
  // 남은 일수는 "날짜 차이"여야 한다. 벽시계 시각으로 빼면 오전 시간대에만
  // 하루가 더 붙어, 같은 화면의 다른 위젯(lifecycle.ts)과 하루씩 어긋났다.
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    if (status === "completed") continue;

    const scheduledEvent = findCategoryScheduleEvent(events, cat.key, cat.label);
    if (scheduledEvent) continue;

    // 마감일 = 결혼일 - ddayDeadline일
    const deadlineDate = new Date(weddingDate);
    deadlineDate.setDate(deadlineDate.getDate() - cat.ddayDeadline);
    deadlineDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.round(
      (deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 60일 이내만 표시
    if (daysLeft > 60) continue;

    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);

    let urgency: ImminentCategory["urgency"];
    if (daysLeft <= 0) urgency = "overdue";
    else if (daysLeft <= 30) urgency = "urgent";
    else urgency = "soon";

    result.push({
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status,
      doneCount: done,
      totalCount: total,
      deadlineDaysLeft: daysLeft,
      hasScheduledEvent: false,
      urgency,
    });
  }

  // 가장 급한 것 먼저
  result.sort((a, b) => a.deadlineDaysLeft - b.deadlineDaysLeft);

  return result;
}

/**
 * 완료된 임박 카테고리 계산
 * 마감일 60일 이내이면서 status === "completed"인 카테고리
 */
export function getCompletedImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: Date | null
): ImminentCategory[] {
  if (!weddingDate) return [];

  const now = new Date();
  // 남은 일수는 "날짜 차이"여야 한다. 벽시계 시각으로 빼면 오전 시간대에만
  // 하루가 더 붙어, 같은 화면의 다른 위젯(lifecycle.ts)과 하루씩 어긋났다.
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    if (status !== "completed") continue;

    const deadlineDate = new Date(weddingDate);
    deadlineDate.setDate(deadlineDate.getDate() - cat.ddayDeadline);
    deadlineDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.round(
      (deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysLeft > 60) continue;

    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);

    result.push({
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status,
      doneCount: done,
      totalCount: total,
      deadlineDaysLeft: daysLeft,
      hasScheduledEvent: false,
      urgency: daysLeft <= 0 ? "overdue" : daysLeft <= 30 ? "urgent" : "soon",
    });
  }

  result.sort((a, b) => a.deadlineDaysLeft - b.deadlineDaysLeft);
  return result;
}
