import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts, resolveStatus } from "@/utils/checklist";
import {
  findCategoryScheduleEvent,
  getEvents,
  getScheduleEventStatus,
} from "@/utils/scheduleEvents";
import type { ProgressItem, ScheduleEvent } from "@/types/database.types";

export interface ImminentCategory {
  key: string;
  label: string;
  icon: string;
  status: ProgressItem["status"];
  doneCount: number;
  totalCount: number;
  deadlineDaysLeft: number;
  hasScheduledEvent: boolean;
  urgency: "overdue" | "urgent" | "soon";
}

/**
 * D-day 기준 임박 카테고리 계산
 * 마감일 = weddingDate - ddayDeadline (결혼식 N일 전까지 완료 권장)
 * 필터: status !== "completed" && 마감일까지 60일 이내
 */
export function getImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: Date | null,
  events: ScheduleEvent[] = []
): ImminentCategory[] {
  if (!weddingDate) return [];

  const now = new Date();
  // 남은 일수는 "날짜 차이"여야 한다. 벽시계 시각으로 빼면 오전 시간대에만
  // 하루가 더 붙어, 같은 화면의 다른 위젯(lifecycle.ts)과 하루씩 어긋났다.
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    // 저장값을 그대로 믿으면 항목이 늘었을 때 그 분야가 통째로 알림에서 빠진다 —
    // 새 항목이 마감을 넘겨도 아무 말도 안 하게 된다. 항목 기록이 있으면 파생한다.
    const status: ProgressItem["status"] = resolveStatus(cat.items, item, cat.defaultStatus);
    // 완료했거나 "해당 없음"으로 끈 항목은 마감 알림에서 제외한다.
    if (status === "completed" || status === "not_applicable") continue;

    const scheduledEvent = findCategoryScheduleEvent(events, cat.key, cat.label);

    // 마감일 = 결혼일 - ddayDeadline일
    const deadlineDate = new Date(weddingDate);
    deadlineDate.setDate(deadlineDate.getDate() - cat.ddayDeadline);
    deadlineDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.round(
      (deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 60일 이내만 표시
    if (daysLeft > 60) continue;

    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);

    let urgency: ImminentCategory["urgency"];
    if (daysLeft <= 0) urgency = "overdue";
    else if (daysLeft <= 30) urgency = "urgent";
    else urgency = "soon";

    result.push({
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status,
      doneCount: done,
      totalCount: total,
      deadlineDaysLeft: daysLeft,
      hasScheduledEvent: Boolean(scheduledEvent),
      urgency,
    });
  }

  // 가장 급한 것 먼저
  result.sort((a, b) => a.deadlineDaysLeft - b.deadlineDaysLeft);

  return result;
}

/** 라운지 주차 카드가 "곧 확인할 분야"로 고르는 개수. */
export const WEEKLY_IMMINENT_LIMIT = 3;

/**
 * 라운지 주차 카드가 고르는 "곧 확인할 분야".
 *
 * 이름을 붙여 밖으로 뺀 이유가 있다. 이 목록은 주차 카드에만 필요한 것이 아니라
 * **같은 화면 아래쪽의 「놓치기 쉬운 항목」이 무엇을 빼야 하는지**를 정한다.
 * 두 곳이 각자 계산하면 정렬 기준이 조금만 달라져도 같은 분야가 한 화면에
 * 두 번 나오고, 그게 실제로 있던 일이다 — 두 블록이 문구까지 같았다
 * (`기본 확인 시점까지 N일`).
 *
 * 그래서 고르는 곳은 여기 한 곳이다. 주차 카드도, 라운지 목록도 이 함수를 부른다.
 */
export function getWeeklyImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: string | null | undefined,
): ImminentCategory[] {
  const parsed = weddingDate ? new Date(weddingDate) : null;
  const validWedding = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const events = getEvents(progress as Record<string, unknown>).filter(
    (event) => getScheduleEventStatus(event) !== "cancelled",
  );
  return getImminentCategories(progress, validWedding, events).slice(
    0,
    WEEKLY_IMMINENT_LIMIT,
  );
}

/**
 * 완료된 임박 카테고리 계산
 * 마감일 60일 이내이면서 status === "completed"인 카테고리
 */
export function getCompletedImminentCategories(
  progress: Record<string, ProgressItem>,
  weddingDate: Date | null
): ImminentCategory[] {
  if (!weddingDate) return [];

  const now = new Date();
  // 남은 일수는 "날짜 차이"여야 한다. 벽시계 시각으로 빼면 오전 시간대에만
  // 하루가 더 붙어, 같은 화면의 다른 위젯(lifecycle.ts)과 하루씩 어긋났다.
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const result: ImminentCategory[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const item = progress[cat.key];
    // 위 루프와 같은 기준을 써야 한 분야가 "임박"과 "완료" 양쪽에 동시에 들거나
    // 양쪽에서 동시에 빠지는 일이 없다.
    const status: ProgressItem["status"] = resolveStatus(cat.items, item, cat.defaultStatus);
    if (status !== "completed") continue;

    const deadlineDate = new Date(weddingDate);
    deadlineDate.setDate(deadlineDate.getDate() - cat.ddayDeadline);
    deadlineDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.round(
      (deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysLeft > 60) continue;

    const template = CHECKLIST_MAP[cat.key];
    const merged = template
      ? mergeChecklist(template.items, item?.checklist, status)
      : [];
    const { done, total } = getChecklistCounts(merged);

    result.push({
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      status,
      doneCount: done,
      totalCount: total,
      deadlineDaysLeft: daysLeft,
      hasScheduledEvent: false,
      urgency: daysLeft <= 0 ? "overdue" : daysLeft <= 30 ? "urgent" : "soon",
    });
  }

  result.sort((a, b) => a.deadlineDaysLeft - b.deadlineDaysLeft);
  return result;
}
