import type { ChecklistItem, ProgressItem } from "@/types/database.types";

// 템플릿과 저장된 체크리스트 병합
export function mergeChecklist(
  template: ChecklistItem[],
  saved: ChecklistItem[] | undefined
): ChecklistItem[] {
  if (!saved || saved.length === 0) {
    return template.map((item) => ({ ...item }));
  }

  const savedMap = new Map(saved.map((s) => [s.id, s]));
  return template.map((t) => ({
    ...t,
    done: savedMap.get(t.id)?.done ?? false,
  }));
}

// 체크리스트 완료 수로 status 자동 계산
export function calculateStatus(
  checklist: ChecklistItem[]
): ProgressItem["status"] {
  const doneCount = checklist.filter((c) => c.done).length;
  if (doneCount === 0) return "not_started";
  if (doneCount === checklist.length) return "completed";
  return "in_progress";
}

// 체크리스트 완료 카운트
export function getChecklistCounts(checklist: ChecklistItem[] | undefined): {
  done: number;
  total: number;
} {
  if (!checklist || checklist.length === 0) return { done: 0, total: 0 };
  return {
    done: checklist.filter((c) => c.done).length,
    total: checklist.length,
  };
}
