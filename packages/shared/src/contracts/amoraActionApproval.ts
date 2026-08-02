import { getSharedScheduleApprovalPolicy } from "./sharedSchedule";

export type AmoraActionApprovalPolicy = "single" | "couple" | "blocked";

export const SINGLE_APPROVAL_PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
export const COUPLE_APPROVAL_PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;

const COUPLE_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "update_budget",
  "update_wedding_date",
  "update_venue",
  "apply_budget_plan",
]);

const SINGLE_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "update_task_status",
  "toggle_checklist_item",
  "add_amora_action",
  "log_wedding_event",
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
