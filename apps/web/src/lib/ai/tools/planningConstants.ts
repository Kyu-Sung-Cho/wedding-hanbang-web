import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";

/**
 * **모델 문맥 전용** 분야 이름.
 *
 * 화면의 쉬운 설명을 결정 범위로 오인하지 않도록 AI 문맥에는 원명칭을 쓴다.
 * 사용자에게 보이는 확인 카드·영수증·변경 영향에는 아래 `SCREEN_CATEGORY_LABELS` 를 쓴다
 * (2026-09-15: 카드에 "예단" 이 찍히는데 예산 화면에는 "두 가족에게 드릴 선물" 이라
 * 같은 항목인지 사용자가 알 수 없었다).
 */
export const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
  yedan: "예단",
  pyebaek: "폐백",
};

/**
 * 사용자에게 보이는 분야 이름. 예산·일정 화면과 같은 정본(`PLANNING_CATEGORY_LABELS`)이다.
 * 키 집합은 `CATEGORY_LABELS` 와 같아서 "고정 분야인가" 판정은 어느 쪽으로 해도 같다.
 */
export const SCREEN_CATEGORY_LABELS: Readonly<Record<string, string>> = PLANNING_CATEGORY_LABELS;

export const STATUS_LABELS: Record<string, string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  completed: "완료",
};
