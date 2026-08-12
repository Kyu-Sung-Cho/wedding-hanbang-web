import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { CHECKLIST_CATEGORY_LABELS } from "@hanbang/shared/constants";

export const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
};

/** 준비 상태·체크리스트·일정·행동 카드에서 쓰는 27개 전체 여정 라벨. */
export const CHECKLIST_LABELS: Record<string, string> = {
  ...CHECKLIST_CATEGORY_LABELS,
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  completed: "완료",
};
