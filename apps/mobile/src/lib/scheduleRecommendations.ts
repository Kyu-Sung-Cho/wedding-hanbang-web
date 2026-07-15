export interface ScheduleChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ScheduleChecklistCategory {
  key: string;
  label: string;
  items: ScheduleChecklistItem[];
}

export interface StartedScheduleAction {
  categoryKey: string;
  categoryLabel: string;
  nextItemLabel: string;
  percent: number;
}

type JourneyProgress = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCategoryProgress(progress: JourneyProgress, categoryKey: string) {
  const value = progress[categoryKey];
  return isRecord(value) ? value : undefined;
}

export function hasExplicitlyStartedCategory(
  category: ScheduleChecklistCategory,
  progress: JourneyProgress,
): boolean {
  if (category.items.some((item) => item.done)) return true;

  const saved = getCategoryProgress(progress, category.key);
  if (!saved) return false;
  if (saved.status === "in_progress" || saved.status === "completed") return true;

  if (Array.isArray(saved.checklist)) {
    const hasDoneItem = saved.checklist.some(
      (item) => isRecord(item) && item.done === true,
    );
    if (hasDoneItem) return true;
  }

  const itemIds = new Set(category.items.map((item) => item.id));
  return Object.entries(saved).some(([key, value]) => itemIds.has(key) && value === true);
}

function isCompletedCategory(
  category: ScheduleChecklistCategory,
  progress: JourneyProgress,
): boolean {
  const saved = getCategoryProgress(progress, category.key);
  if (saved?.status === "completed") return true;
  return category.items.length > 0 && category.items.every((item) => item.done);
}

export function getStartedScheduleActions(
  categories: ScheduleChecklistCategory[],
  progress: JourneyProgress,
  limit = 3,
): StartedScheduleAction[] {
  return categories
    .filter(
      (category) =>
        hasExplicitlyStartedCategory(category, progress) &&
        !isCompletedCategory(category, progress),
    )
    .map((category) => {
      const done = category.items.filter((item) => item.done).length;
      const total = category.items.length;
      return {
        categoryKey: category.key,
        categoryLabel: category.label,
        nextItemLabel:
          category.items.find((item) => !item.done)?.label ??
          `${category.label} 체크리스트 확인`,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.percent - a.percent)
    .slice(0, Math.max(0, limit));
}

export function partitionScheduleCategories(
  categories: ScheduleChecklistCategory[],
  progress: JourneyProgress,
): {
  started: ScheduleChecklistCategory[];
  optional: ScheduleChecklistCategory[];
} {
  const started: ScheduleChecklistCategory[] = [];
  const optional: ScheduleChecklistCategory[] = [];

  for (const category of categories) {
    (hasExplicitlyStartedCategory(category, progress) ? started : optional).push(category);
  }

  return { started, optional };
}
