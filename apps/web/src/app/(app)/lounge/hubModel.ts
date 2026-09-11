import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { buildAmoraMissionModel, type MissionCategory } from "@/lib/amora/missions";
import { listCountedBudgetEntries } from "@/lib/budgetTotals";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
import { daysUntilWedding } from "@/lib/utils/weddingDate";
import { getWeeklyImminentCategories, type ImminentCategory } from "@/utils/imminentChecklist";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";

const BUDGET_KEYS = [...CATEGORY_CHECKLISTS.map(({ key }) => key), "reserve"];

export function getLoungeBudgetTotals(progress: Record<string, ProgressItem>) {
  return listCountedBudgetEntries(progress, BUDGET_KEYS).reduce((totals, entry) => {
    const budget = isValidWeddingWonAmount(entry.budget) ? entry.budget : 0;
    const spent = isValidWeddingWonAmount(entry.spent) ? entry.spent : 0;
    return {
      allocated: Number.isSafeInteger(totals.allocated + budget) ? totals.allocated + budget : totals.allocated,
      spent: Number.isSafeInteger(totals.spent + spent) ? totals.spent + spent : totals.spent,
      photoAttireMakeup: ["studio", "dress", "makeup"].includes(entry.key)
        ? totals.photoAttireMakeup + budget : totals.photoAttireMakeup,
    };
  }, { allocated: 0, spent: 0, photoAttireMakeup: 0 });
}

export type LoungePriorityItem = {
  kind: "checklist";
  category: MissionCategory;
  imminent: ImminentCategory | null;
} | {
  kind: "schedule";
  event: ScheduleEvent;
};

export function buildLoungePriorityItems(
  progress: Record<string, ProgressItem>,
  weddingDate: string | null | undefined,
  upcomingEvents: readonly ScheduleEvent[],
): LoungePriorityItem[] {
  const categories = buildAmoraMissionModel(progress, []).groups.flatMap((group) => group.categories);
  const imminent = getWeeklyImminentCategories(progress, weddingDate);
  const ongoing = categories.filter((category) => category.status === "in_progress");
  const waiting = categories.filter((category) => category.status === "not_started");
  const orderedKeys = [...new Set([...imminent.map(({ key }) => key), ...ongoing.map(({ key }) => key), ...waiting.map(({ key }) => key)])];
  const checklistLimit = upcomingEvents.length > 0 ? 4 : 5;
  const items: LoungePriorityItem[] = orderedKeys.slice(0, checklistLimit).flatMap((key) => {
    const category = categories.find((entry) => entry.key === key);
    return category ? [{ kind: "checklist" as const, category, imminent: imminent.find((entry) => entry.key === key) ?? null }] : [];
  });
  // 실제 다음 일정은 모바일 기본 세 항목에도 남긴다.
  if (upcomingEvents[0]) items.splice(Math.min(2, items.length), 0, { kind: "schedule", event: upcomingEvents[0] });
  return items;
}

export function daysUntilLoungeEvent(date: string): number | null {
  return daysUntilWedding(date);
}
