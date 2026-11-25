// 홈의 "먼저 알려 드릴까요?"(한 번 묻기)가 묻기 전에 세는 값. 웹 `AmoraTodayOneSlot.countPlannedSchedules` 와 같은 규칙이다.
// 오늘 이후로 예정된(취소·끝내지 않은) 일정이 하나라도 있어야 묻는다(2026-11-13 파운더 결정).
import { formatLocalDateKey } from "./dashboardExperience.mjs";
import { isActiveScheduleEvent } from "./scheduleMutation.mjs";

/**
 * @param {Record<string, unknown> | null | undefined} progress
 * @param {string} [todayKey] 기기 시각 기준 YYYY-MM-DD
 * @returns {number}
 */
export function countPlannedSchedules(progress, todayKey = formatLocalDateKey()) {
  const rawEvents = progress && typeof progress === "object" ? progress.__events : undefined;
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  return events.filter((event) => (
    isActiveScheduleEvent(event)
    && event.status !== "completed"
    && typeof event.date === "string"
    && event.date >= todayKey
  )).length;
}
