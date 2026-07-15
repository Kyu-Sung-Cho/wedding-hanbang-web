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
  hasScheduledEvent: boolean;
}

function hasStartedCategory(item: ProgressItem | undefined): boolean {
  if (!item) return false;
  if (item.status === "in_progress" || item.status === "completed") return true;
  return item.checklist?.some((checklistItem) => checklistItem.done) === true;
}

/** 사용자가 직접 시작했지만 날짜는 아직 등록하지 않은 준비 항목. */
export function getImminentCategories(
  progress: Record<string, ProgressItem>,
  events: ScheduleEvent[] = []
): ImminentCategory[] {
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    if (!hasStartedCategory(item)) continue;
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    if (status === "completed") continue;

    const scheduledEvent = findCategoryScheduleEvent(events, cat.key, cat.label);
    if (scheduledEvent) continue;

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
      hasScheduledEvent: false,
    });
  }

  return result;
}

/** 사용자가 완료로 기록한 준비 항목. */
export function getCompletedImminentCategories(
  progress: Record<string, ProgressItem>
): ImminentCategory[] {
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    if (status !== "completed") continue;

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
      hasScheduledEvent: false,
    });
  }
  return result;
}
