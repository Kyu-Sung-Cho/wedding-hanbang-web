export const USER_RESEARCH_COHORT_TOTAL = 50;
export const USER_RESEARCH_COHORT_CODE = "research-2026-h2";
// Internal compatibility alias for the existing preregistration counter.
export const BETA_TOTAL = USER_RESEARCH_COHORT_TOTAL;
export const BETA_COUNTER_MIN = 10;

export const USER_RESEARCH_COHORT_BENEFITS = [
  "아모라 상담 · 견적 체크리스트 우선 체험",
  "예산 · 일정 · 커플 준비 흐름 함께 검증",
  "불편 사항과 필요한 기능을 개선에 직접 반영",
  "사용자 연구 운영 변경 사항을 이메일로 안내",
] as const;

export const USER_RESEARCH_COHORT_CONDITIONS = [
  "2026년 7~12월 결혼 예정 또는 예식일 미정",
  "신부 · 신랑 모두 참여 가능",
  "주 1회 짧은 피드백",
] as const;

export function shouldShowBetaCounter(count: number): boolean {
  return count >= BETA_COUNTER_MIN;
}
