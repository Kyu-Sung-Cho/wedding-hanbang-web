import type { ChecklistItem, ProgressItem } from "@/types/database.types";
import {
  calculatePlanningChecklistStatus,
  getPlanningChecklistCounts,
  mergePlanningChecklist,
  summarizePlanningChecklist,
} from "@hanbang/shared/utils";

export { summarizePlanningChecklist };

// 템플릿과 사용자가 직접 저장한 항목별 상태를 병합한다.
// 카테고리 상태만으로 개별 항목의 완료 여부를 추정하지 않는다.
export function mergeChecklist(
  template: ChecklistItem[],
  saved: ChecklistItem[] | undefined,
  _status?: ProgressItem["status"]
): ChecklistItem[] {
  // 기존 호출부와 저장 형식은 유지하되 카테고리 상태로 항목 완료를 추정하지 않는다.
  void _status;
  return mergePlanningChecklist(template, saved);
}

// 체크리스트 완료 수로 status 자동 계산
export function calculateStatus(
  checklist: ChecklistItem[]
): ProgressItem["status"] {
  return calculatePlanningChecklistStatus(checklist);
}

// 체크리스트 완료 카운트
export function getChecklistCounts(checklist: ChecklistItem[] | undefined): {
  done: number;
  total: number;
} {
  return getPlanningChecklistCounts(checklist);
}
