import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import type { ProgressItem } from "@/types/database.types";

export interface ImminentCategory {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  doneCount: number;
  totalCount: number;
  deadlineDaysLeft: number;
  urgency: "overdue" | "urgent" | "soon";
}

/**
 * D-day 기준 임박 카테고리 계산
 * 마감일 = weddingDate - ddayDeadline (결혼식 N일 전까지 완료 권장)
 * 필터: status !== "completed" && 마감일까지 60일 이내
 */
export function getImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: Date | null
): ImminentCategory[] {
  if (!weddingDate) return [];

  const now = new Date();
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    const status: ProgressItem["status"] = item?.status ?? "not_started";
    if (status === "completed") continue;

    // 마감일 = 결혼일 - ddayDeadline일
    const deadlineDate = new Date(weddingDate);
    deadlineDate.setDate(deadlineDate.getDate() - cat.ddayDeadline);

    const daysLeft = Math.ceil(
      (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
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
      urgency,
    });
  }

  // 가장 급한 것 먼저
  result.sort((a, b) => a.deadlineDaysLeft - b.deadlineDaysLeft);

  return result;
}
