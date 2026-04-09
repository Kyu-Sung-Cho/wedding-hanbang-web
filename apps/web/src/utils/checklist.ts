import type { ChecklistItem, ProgressItem } from "@/types/database.types";

// 템플릿과 저장된 체크리스트 병합
// status를 전달하면 체크리스트 데이터가 없을 때 status에 맞게 done 값 설정
export function mergeChecklist(
  template: ChecklistItem[],
  saved: ChecklistItem[] | undefined,
  status?: ProgressItem["status"]
): ChecklistItem[] {
  if (!saved || saved.length === 0) {
    // 체크리스트 데이터가 없으면 기존 status 기반으로 초기화
    if (status === "completed") {
      return template.map((item) => ({ ...item, done: true }));
    }
    if (status === "in_progress") {
      // 진행중이면 앞쪽 절반을 완료 처리
      const halfDone = Math.ceil(template.length / 2);
      return template.map((item, i) => ({ ...item, done: i < halfDone }));
    }
    // not_started → 전부 false
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
