// Keep the mutation boundary provider-agnostic and client-safe. Both the
// server execution ledger and the chat UI synchronization must use this one
// source of truth so a newly added mutating tool cannot silently skip refresh.
export const IDEMPOTENT_ASSIGNMENT_TOOLS = [
  "update_budget",
  "update_wedding_date",
  "update_task_status",
  "update_venue",
  "update_category_budget",
  "apply_budget_plan",
  "delete_category",
  "reset_category",
  "update_schedule_event",
  "delete_schedule_event",
  "toggle_checklist_item",
  "update_amora_action",
  "cancel_booking",
] as const;

export const CREATE_OR_APPEND_TOOLS = [
  "add_custom_category",
  "add_schedule_event",
  "add_amora_action",
  "log_wedding_event",
  "create_booking",
] as const;

export const MUTATING_TOOL_NAMES = [
  ...IDEMPOTENT_ASSIGNMENT_TOOLS,
  ...CREATE_OR_APPEND_TOOLS,
] as const;

const MUTATING_TOOLS = new Set<string>(MUTATING_TOOL_NAMES);

export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName);
}
