import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";

export const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  completed: "완료",
};
