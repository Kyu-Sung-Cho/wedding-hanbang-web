export const SHARED_SCHEDULE_SCOPES = [
  "confirmed_fact",
  "shared_commitment",
  "external_commitment",
] as const;

export type SharedScheduleScope = (typeof SHARED_SCHEDULE_SCOPES)[number];
export type SharedScheduleOperation = "add" | "update" | "cancel";
export type SharedScheduleApprovalPolicy = "single" | "couple";

export function isSharedScheduleScope(value: unknown): value is SharedScheduleScope {
  return SHARED_SCHEDULE_SCOPES.includes(value as SharedScheduleScope);
}

/**
 * Only an already-confirmed fact may be recorded by one member. Ambiguous new
 * plans, external commitments, edits, and cancellations require both members.
 */
export function getSharedScheduleApprovalPolicy(
  operation: SharedScheduleOperation,
  scope: unknown,
): SharedScheduleApprovalPolicy {
  return operation === "add" && scope === "confirmed_fact"
    ? "single"
    : "couple";
}
