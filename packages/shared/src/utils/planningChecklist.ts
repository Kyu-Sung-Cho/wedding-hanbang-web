export type PlanningChecklistStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_applicable";

export interface PlanningChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PlanningChecklistProgress {
  status?: PlanningChecklistStatus;
  checklist?: PlanningChecklistItem[];
}

export interface PlanningChecklistTemplateLike {
  key: string;
  items: PlanningChecklistItem[];
}

/**
 * 템플릿의 안정적인 순서를 유지하면서 이전 버전·직접 추가 항목도 잃지 않는다.
 * 알 수 없는 저장 항목은 마지막에 붙여 round-trip 저장 시에도 보존한다.
 */
export function mergePlanningChecklist<T extends PlanningChecklistItem>(
  template: readonly T[],
  saved: readonly T[] | undefined,
): T[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return template.map((item) => ({ ...item, done: false }));
  }

  const savedById = new Map<string, T>();
  for (const item of saved) {
    if (!savedById.has(item.id)) savedById.set(item.id, item);
  }
  const templateIds = new Set(template.map((item) => item.id));
  const merged = template.map((item) => {
    const savedItem = savedById.get(item.id);
    return {
      ...(savedItem ?? {}),
      ...item,
      done: savedItem?.done ?? false,
    } as T;
  });

  const appendedIds = new Set<string>();
  for (const item of saved) {
    if (!templateIds.has(item.id) && !appendedIds.has(item.id)) {
      merged.push({ ...item });
      appendedIds.add(item.id);
    }
  }
  return merged;
}

export function calculatePlanningChecklistStatus(
  checklist: readonly PlanningChecklistItem[],
): Exclude<PlanningChecklistStatus, "not_applicable"> {
  if (checklist.length === 0 || checklist.every((item) => !item.done)) {
    return "not_started";
  }
  if (checklist.every((item) => item.done)) return "completed";
  return "in_progress";
}

export function getPlanningChecklistCounts(
  checklist: readonly PlanningChecklistItem[] | undefined,
): { done: number; total: number } {
  if (!checklist || checklist.length === 0) return { done: 0, total: 0 };
  return {
    done: checklist.filter((item) => item.done).length,
    total: checklist.length,
  };
}

/** 웹·모바일·아모라가 공유하는 단일 진행률 계약. */
export function summarizePlanningChecklist(
  templates: readonly PlanningChecklistTemplateLike[],
  progress: Readonly<Record<string, PlanningChecklistProgress | undefined>>,
): {
  done: number;
  total: number;
  percent: number;
  skippedCategories: number;
  completedCategories: number;
  applicableCategories: number;
} {
  let done = 0;
  let total = 0;
  let skippedCategories = 0;
  let completedCategories = 0;
  let applicableCategories = 0;

  for (const template of templates) {
    const saved = progress[template.key];
    if (saved?.status === "not_applicable") {
      skippedCategories += 1;
      continue;
    }

    applicableCategories += 1;
    const merged = mergePlanningChecklist(template.items, saved?.checklist);
    const counts = getPlanningChecklistCounts(merged);
    done += counts.done;
    total += counts.total;
    if (counts.total > 0 && counts.done === counts.total) completedCategories += 1;
  }

  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    skippedCategories,
    completedCategories,
    applicableCategories,
  };
}
