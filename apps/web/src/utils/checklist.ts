import { CHECKLIST_MAP } from "@/constants/checklists";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";
import {
  calculatePlanningChecklistStatus,
  resolvePlanningChecklistStatus,
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

/**
 * 화면에 그릴 분야 상태. 저장된 status가 낡았을 수 있어 항목 기록이 있으면 파생한다.
 * 세 갈래의 근거는 `resolvePlanningChecklistStatus`의 주석에 있다.
 */
export function resolveStatus(
  templateItems: readonly ChecklistItem[],
  saved: { status?: string; checklist?: ChecklistItem[] } | undefined
): ProgressItem["status"] {
  return resolvePlanningChecklistStatus(templateItems, saved as never);
}

/**
 * 분야 키로 상태를 정한다. 템플릿이 없는 키(예산 전용 `reserve` 등)는 파생할 근거가
 * 없으므로 저장값을 그대로 둔다.
 */
export function resolveStatusByKey(
  key: string,
  saved: { status?: string; checklist?: ChecklistItem[] } | undefined
): ProgressItem["status"] | undefined {
  const template = CHECKLIST_MAP[key];
  if (!template) return saved?.status as ProgressItem["status"] | undefined;
  return resolveStatus(template.items, saved);
}

// 체크리스트 완료 카운트
export function getChecklistCounts(checklist: ChecklistItem[] | undefined): {
  done: number;
  total: number;
} {
  return getPlanningChecklistCounts(checklist);
}
