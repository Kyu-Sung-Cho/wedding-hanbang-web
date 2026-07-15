type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * wedding_journeys.progress의 실제 체크리스트 완료율을 계산한다.
 * category/status/updated_at 같은 메타데이터는 작업 수에 포함하지 않는다.
 */
export interface JourneyProgressCounts {
  done: number;
  total: number;
  categoryCount: number;
}

/**
 * Counts only categories the couple actually started or completed.
 * Template-only `not_started` rows must not turn optional customs into required work.
 */
export function getJourneyProgressCounts(progress: UnknownRecord): JourneyProgressCounts {
  let total = 0;
  let done = 0;
  let categoryCount = 0;

  for (const [key, value] of Object.entries(progress)) {
    if (key.startsWith("__") || !isRecord(value)) continue;
    if (value.status === "not_applicable") continue;

    if (Array.isArray(value.checklist)) {
      const checklist = value.checklist.filter(isRecord);
      const hasCompletedItem = checklist.some((item) => item.done === true);
      const isStarted = value.status === "in_progress" || value.status === "completed" || hasCompletedItem;
      if (!isStarted) continue;

      categoryCount += 1;
      for (const item of checklist) {
        total += 1;
        if (item.done === true) done += 1;
      }
      continue;
    }

    // 이전 플랫 boolean 저장 형식은 읽기 호환만 유지한다.
    const booleanItems = Object.values(value).filter((itemValue): itemValue is boolean => typeof itemValue === "boolean");
    const hasCompletedItem = booleanItems.some(Boolean);
    const isStarted = value.status === "in_progress" || value.status === "completed" || hasCompletedItem;
    if (booleanItems.length > 0 && isStarted) {
      categoryCount += 1;
      for (const itemValue of booleanItems) {
        total += 1;
        if (itemValue) done += 1;
      }
      continue;
    }

    if (value.status === "in_progress" || value.status === "completed") {
      categoryCount += 1;
      total += 1;
      if (value.status === "completed") done += 1;
    }
  }

  return { done, total, categoryCount };
}

export function calculateJourneyProgressPercent(progress: UnknownRecord): number {
  const { done, total } = getJourneyProgressCounts(progress);
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
