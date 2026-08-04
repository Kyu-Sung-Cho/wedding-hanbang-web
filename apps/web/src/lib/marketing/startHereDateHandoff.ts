export const START_HERE_DATE_HANDOFF_KEY = "hanbang:start-here-date:v1";

export function clearStartHereDateHandoff(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(START_HERE_DATE_HANDOFF_KEY);
  } catch {
    // 저장소 접근이 막힌 환경에서도 날짜 없는 시작 흐름은 계속 진행한다.
  }
}
