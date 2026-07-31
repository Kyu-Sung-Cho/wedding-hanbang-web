export interface PendingAmoraAction {
  version: 2;
  actionId: string;
  tool: string;
  input: Record<string, unknown>;
  inputDigest: string;
  operationKey: string;
  confirmation: string;
  issuedAt: number;
  expiresAt: number;
}

export type PendingActionDisabledReason = "busy" | "expired" | "not_latest" | null;

interface PendingActionMessageBoundary {
  sender_type?: unknown;
  visibility?: unknown;
  metadata?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
// Native MVP currently renders only short-lived, reversible one-member
// confirmations. Two-member decisions use the web approval/withdrawal UI.
const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
const MOBILE_SINGLE_APPROVAL_TOOLS = new Set([
  "update_task_status",
  "update_category_budget",
  "add_custom_category",
  "add_schedule_event",
  "update_schedule_event",
  "toggle_checklist_item",
  "add_amora_action",
  "log_wedding_event",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maxLength;
}

function validEpochMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Fails closed at the persisted-message boundary; visible prose is never authority. */
export function getPendingAmoraAction(
  message: PendingActionMessageBoundary,
): PendingAmoraAction | null {
  if (message.sender_type !== "ai" || message.visibility !== "shared") return null;
  if (!isPlainRecord(message.metadata)) return null;
  const value = message.metadata.pending_amora_action;
  if (!isPlainRecord(value)) return null;
  if (
    value.version !== 2
    || !isBoundedText(value.actionId, 36)
    || !UUID_PATTERN.test(value.actionId)
    || !isBoundedText(value.tool, 120)
    || !MOBILE_SINGLE_APPROVAL_TOOLS.has(value.tool)
    || !isPlainRecord(value.input)
    || typeof value.inputDigest !== "string"
    || !SHA256_HEX_PATTERN.test(value.inputDigest)
    || typeof value.operationKey !== "string"
    || !SHA256_HEX_PATTERN.test(value.operationKey)
    || !isBoundedText(value.confirmation, 2_000)
    || !validEpochMilliseconds(value.issuedAt)
    || !validEpochMilliseconds(value.expiresAt)
    || value.expiresAt - value.issuedAt !== PENDING_ACTION_TTL_MS
  ) return null;

  return value as unknown as PendingAmoraAction;
}

export function getPendingActionDisabledReason(
  action: PendingAmoraAction,
  nowMs: number,
  isLatest: boolean,
  busy: boolean,
): PendingActionDisabledReason {
  if (!Number.isFinite(nowMs) || action.issuedAt > nowMs || nowMs >= action.expiresAt) return "expired";
  if (!isLatest) return "not_latest";
  if (busy) return "busy";
  return null;
}
