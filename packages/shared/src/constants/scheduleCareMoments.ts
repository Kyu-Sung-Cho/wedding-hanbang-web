import type { PlanningCategoryKey } from "./weddingPlanning";

/**
 * 사용자가 일정에서 직접 선택할 수 있는 아모라 케어 모먼트.
 * 예식일 기준 자동 모먼트는 별도로 계산하므로 임의 일정에 붙이지 않는다.
 */
export const SCHEDULE_CARE_MOMENT_OPTIONS = [
  { value: "family_greeting", label: "한쪽 가족에게 첫인사" },
  { value: "sanggyeonrye", label: "양쪽 부모님이 함께 만나는 자리" },
  { value: "venue_tour", label: "결혼식장 방문" },
  { value: "dress_tour", label: "드레스 매장 방문" },
  { value: "studio_shoot", label: "스튜디오 촬영" },
  { value: "dress_fitting", label: "드레스 수선·최종 확인" },
  { value: "invitation_meeting", label: "초대장 전달 모임" },
  { value: "first_holiday", label: "결혼 후 첫 명절" },
] as const;

export type ScheduleCareMomentType =
  (typeof SCHEDULE_CARE_MOMENT_OPTIONS)[number]["value"];

export type ScheduleCareCategoryKey = PlanningCategoryKey | "general";

const SCHEDULE_CARE_MOMENT_CATEGORY_KEYS: Readonly<
  Record<ScheduleCareMomentType, ScheduleCareCategoryKey>
> = {
  family_greeting: "meeting",
  sanggyeonrye: "meeting",
  venue_tour: "venue",
  dress_tour: "dress",
  studio_shoot: "studio",
  dress_fitting: "dress",
  invitation_meeting: "invitation",
  first_holiday: "general",
};

export function isScheduleCareMomentType(
  value: unknown,
): value is ScheduleCareMomentType {
  return typeof value === "string"
    && SCHEDULE_CARE_MOMENT_OPTIONS.some((option) => option.value === value);
}

export function getCanonicalCategoryKeyForMoment(
  value: unknown,
): ScheduleCareCategoryKey | null {
  return isScheduleCareMomentType(value)
    ? SCHEDULE_CARE_MOMENT_CATEGORY_KEYS[value]
    : null;
}
