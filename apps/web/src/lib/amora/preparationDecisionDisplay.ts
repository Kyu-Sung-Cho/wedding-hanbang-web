import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";

type DecisionDisplayInput = {
  title: string;
  source: string | null;
  decision_type: string;
  metadata: Record<string, unknown> | null;
  chosen_value?: unknown;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 저장된 작업 종류와 전후 상태로 당시의 이력만 표시한다. 제목에서 현재 상태를 추정하지 않는다. */
export function preparationScheduleRecordLabel(row: DecisionDisplayInput): string {
  const value = object(row.chosen_value);
  const metadata = row.metadata;
  if (row.source !== "schedule" || !metadata || value?.schemaVersion !== 1) return "일정 기록";
  const kind = metadata.origin === "couple_plan_change_request" ? value.mutationKind
    : metadata.origin === "amora_shared_action" ? value.operation : null;
  if ((kind !== "cancel" && kind !== "restore") || metadata.mutationKind !== kind) return "일정 기록";
  const before = object(value.before); const after = object(value.after);
  if (typeof value.eventId !== "string" || !value.eventId || before?.id !== value.eventId || after?.id !== value.eventId
    || (metadata.eventId !== undefined && metadata.eventId !== value.eventId)) return "일정 기록";
  if (kind === "cancel" && (before.status === "planned" || before.status === "completed") && after.status === "cancelled") return "일정 취소 기록";
  if (kind === "restore" && before.status === "cancelled" && after.status === "planned") return "일정 복원 기록";
  return "일정 기록";
}

const PAYER_LABELS: Readonly<Record<string, string>> = {
  couple: "두 사람", bride_parents: "예비 신부 가족", groom_parents: "예비 신랑 가족",
  both_parents: "두 가족", bride: "예비 신부", groom: "예비 신랑",
};
function amount(value: unknown): string | null {
  return value === null ? "미정" : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${value}원` : null;
}

/** 생성된 예산 요약 전체와 구조화된 후값이 맞을 때만 고정 항목명을 표시한다. 원문은 변경하지 않는다. */
export function preparationLegacyBudgetTitle(row: DecisionDisplayInput): string | null {
  const value = object(row.chosen_value);
  if (row.source !== "manual" || row.decision_type !== "decided" || row.metadata?.origin !== "couple_plan_change_request"
    || value?.schemaVersion !== 1) return null;
  const patch = object(object(value.changes)?.progress_patch);
  if (!patch) return null;
  const result: string[] = [];
  for (const segment of row.title.split(" · ")) {
    const match = /^([a-z][a-z0-9_]*) (예산|지출|부담): (.+) → (.+)$/u.exec(segment);
    if (!match) return null;
    const [, key, field, before, after] = match;
    const entry = object(patch[key]);
    if (!Object.hasOwn(PLANNING_CATEGORY_LABELS, key) || !entry || entry.category !== key
      || Object.hasOwn(entry, "label") || Object.hasOwn(entry, "name")) return null;
    if (field === "부담") {
      const expected = entry.payer === null ? "미정" : typeof entry.payer === "string" && Object.hasOwn(PAYER_LABELS, entry.payer) ? PAYER_LABELS[entry.payer] : null;
      if (!expected || after !== expected || (before !== "미정" && !Object.values(PAYER_LABELS).includes(before))) return null;
    } else {
      if (after !== amount(entry[field === "예산" ? "budget" : "spent"]) || !/^(?:미정|(?:0|[1-9][0-9]*)원)$/u.test(before)) return null;
    }
    result.push(`${PLANNING_CATEGORY_LABELS[key as keyof typeof PLANNING_CATEGORY_LABELS]} ${field}: ${before} → ${after}`);
  }
  return result.join(" · ");
}
