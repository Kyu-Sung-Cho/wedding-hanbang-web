import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";

export const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
  // 화면의 쉬운 설명을 결정 범위로 오인하지 않도록 AI 문맥에는 원명칭을 쓴다.
  yedan: "예단",
  pyebaek: "폐백",
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  completed: "완료",
};
