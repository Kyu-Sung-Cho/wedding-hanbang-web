import { getSharedScheduleApprovalPolicy } from "./sharedSchedule";

export type AmoraActionApprovalPolicy = "single" | "couple" | "blocked";

export const SINGLE_APPROVAL_PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
export const COUPLE_APPROVAL_PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;

const COUPLE_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "update_budget",
  "update_wedding_date",
  "update_venue",
  "apply_budget_plan",
  // `log_wedding_event`는 이름이 "기록"이지만 `add_schedule_event`와 **같은 공유 일정
  // 배열**(`progress.__events`)에 쓴다. 그런데 한 사람 승인이었어서, 같은 결과를 두
  // 경로로 만들 수 있었고 어느 쪽을 쓸지는 모델이 정했다. 상견례·예식장 방문처럼 둘이
  // 함께 가는 자리가 합의 없이 공유 캘린더에 박히는데, 지우려면
  // (`cancel_schedule_event`) 오히려 두 사람 확인이 필요했다 — 넣기는 혼자, 빼기는
  // 둘이라는 비대칭이었다.
  //
  // 이 도구의 입력에는 일정 성격을 담을 자리가 없다(`moment_type`·`date`·`title`·
  // `memo`뿐이고 DB가 그 키 집합을 엄격히 강제한다). 성격을 모르면 더 조심하는 쪽으로
  // 간다. 이미 지난 일을 혼자 기록하는 길은 그대로 남아 있다 —
  // `add_schedule_event`에 `schedule_scope: "confirmed_fact"`를 주면 된다. 그 도구는
  // 성격을 명시적으로 받고, 성격을 밝힌 요청만 한 사람 승인을 얻는다.
  "log_wedding_event",
]);

const SINGLE_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "update_task_status",
  "toggle_checklist_item",
  "add_amora_action",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Canonical web/mobile approval policy. Unknown mutations stay blocked so a
 * newly introduced tool cannot silently inherit a one-person confirmation.
 */
export function getAmoraActionApprovalPolicy(
  toolName: string,
  input?: unknown,
): AmoraActionApprovalPolicy {
  if (COUPLE_APPROVAL_TOOLS.has(toolName)) return "couple";

  if (toolName === "add_schedule_event") {
    const scheduleScope = isRecord(input) ? input.schedule_scope : undefined;
    return getSharedScheduleApprovalPolicy("add", scheduleScope);
  }

  if (toolName === "update_schedule_event") return "couple";

  if (
    toolName === "cancel_schedule_event"
    || toolName === "restore_schedule_event"
  ) {
    return "couple";
  }

  if (
    toolName === "update_category_budget"
    || toolName === "add_custom_category"
  ) {
    return isRecord(input)
      && Object.prototype.hasOwnProperty.call(input, "budget")
      ? "couple"
      : "single";
  }

  if (SINGLE_APPROVAL_TOOLS.has(toolName)) return "single";
  return "blocked";
}

export function getAmoraPendingActionTtlMs(
  toolName: string,
  input?: unknown,
): number {
  return getAmoraActionApprovalPolicy(toolName, input) === "couple"
    ? COUPLE_APPROVAL_PENDING_ACTION_TTL_MS
    : SINGLE_APPROVAL_PENDING_ACTION_TTL_MS;
}
