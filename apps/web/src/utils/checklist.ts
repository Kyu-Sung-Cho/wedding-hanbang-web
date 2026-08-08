import type { ChecklistItem, ProgressItem } from "@/types/database.types";

// 템플릿과 사용자가 직접 저장한 항목별 상태를 병합한다.
// 카테고리 상태만으로 개별 항목의 완료 여부를 추정하지 않는다.
export function mergeChecklist(
  template: ChecklistItem[],
  saved: ChecklistItem[] | undefined,
  _status?: ProgressItem["status"]
): ChecklistItem[] {
  // 기존 호출부와 저장 형식은 유지하되 카테고리 상태로 항목 완료를 추정하지 않는다.
  void _status;
  if (!saved || saved.length === 0) {
    return template.map((item) => ({ ...item, done: false }));
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
