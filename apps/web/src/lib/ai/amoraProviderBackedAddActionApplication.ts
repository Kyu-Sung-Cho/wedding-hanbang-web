import {
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY,
  AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY,
} from "@hanbang/shared/amora-schedule-care-follow-up";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { PersistedAiMessage } from "@/lib/ai/chatMessagePersistence";
import {
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

export const AMORA_ADD_ACTION_PROPOSAL_ORIGIN_METADATA_KEY =
  "amora_add_action_proposal_origin_v1";
export const AMORA_ADD_ACTION_PROPOSAL_ORIGIN = "ordinary_provider";
export const AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN =
  "server_authoritative_provider_backed_add_action_application";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");
const CHAT_REQUEST_KEY_RE = new RegExp(
  `^chat:${UUID_PATTERN}:${UUID_PATTERN}$`,
  "i",
);
const MAX_REQUEST_KEY_CHARS = 160;
const MAX_MESSAGE_CHARS = 2_000;
// PostgreSQL's POSIX whitespace class and JavaScript's `\s` disagree on
// these code points. Exclude them from this narrow deterministic path so the
// database and public receipt parser can never normalize one action two ways.
const SQL_JS_WHITESPACE_DRIFT_RE =
  /[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u;
const NON_BMP_RE = /[\u{10000}-\u{10ffff}]/u;
const ASCII_NON_SPACE_WHITESPACE_EDGE_RE = /^[\t-\r]|[\t-\r]$/u;
const ADD_ACTION_INPUT_KEYS = new Set([
  "title",
  "description",
  "due_date",
  "category_key",
  "priority",
  "source",
  "href",
]);
const ELIGIBILITY_PROBE_REQUEST_KEY =
  "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002";
const PENDING_ACTION_KEYS = [
  "version",
  "actionId",
  "tool",
  "input",
  "inputDigest",
  "operationKey",
  "confirmation",
  "issuedAt",
  "expiresAt",
] as const;
const APPLICATION_ROW_KEYS = [
  "outcome",
  "tool_result",
  "message_id",
  "message_created_at",
  "message_content",
  "message_metadata",
  "message_stage_tag",
  "message_specialist_type",
  "message_visibility",
  "message_reused",
] as const;
const APPLICATION_METADATA_KEYS = [
  "client_request_id",
  "client_visible_request_id",
  "in_reply_to_user_message_id",
  "confirmed_amora_action_id",
  "question_scope",
  "memory_eligible",
  "memory_enqueue_requested",
  "amora_wedding_context_revision",
  "source_amora_action_message_id",
  "toolResults",
  "toolsUsed",
  "persistence_terminal_source",
  "response_origin",
  "provider_call_count",
] as const;
const TOOL_RESULT_KEYS = [
  "toolName",
  "toolInput",
  "toolOutput",
  "success",
  "displayMessage",
] as const;
const ACTION_OUTPUT_KEYS = [
  "id",
  "title",
  "description",
  "dueDate",
  "categoryKey",
  "priority",
  "status",
  "source",
  "href",
] as const;
const FORBIDDEN_SOURCE_METADATA_KEYS = [
  "amora_first_use_promotion_id",
  "amora_first_use_action_promotion_v1",
  "amora_first_use_grounding",
  "response_origin",
  "provider_call_count",
  "persistence_terminal_source",
  AMORA_SCHEDULE_CARE_ACTION_DRAFT_METADATA_KEY,
  AMORA_SCHEDULE_CARE_FOLLOW_UP_METADATA_KEY,
] as const;

export interface AmoraProviderBackedAddActionApplicationSource {
  sourceProposalMessageId: string;
  journeyRevision: number;
  pendingAction: StoredAmoraPendingAction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength;
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function exactJsonValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => exactJsonValueEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) => Object.hasOwn(right, key)
        && exactJsonValueEqual(left[key], right[key]),
    );
}

function hasAddActionToolResult(value: unknown): boolean {
  return Array.isArray(value) && value.some(
    (entry) => isRecord(entry) && entry.toolName === "add_amora_action",
  );
}

function hasProviderBackedAddActionHrefParity(
  action: StoredAmoraPendingAction,
): boolean {
  const categoryKey = action.input.category_key;
  return !(
    (categoryKey === "mc" || categoryKey === "gift")
    && !Object.hasOwn(action.input, "href")
  );
}

function hasProviderBackedAddActionTextParity(
  action: StoredAmoraPendingAction,
): boolean {
  const title = action.input.title;
  const description = action.input.description;
  const href = action.input.href;
  const hasLegacyEdgeParity = (value: string): boolean =>
    !ASCII_NON_SPACE_WHITESPACE_EDGE_RE.test(
      value.replace(/^ +| +$/gu, ""),
    );
  return typeof title === "string"
    && !SQL_JS_WHITESPACE_DRIFT_RE.test(title)
    && !NON_BMP_RE.test(title)
    && hasLegacyEdgeParity(title)
    && (
      description === undefined
      || (
        typeof description === "string"
        && !SQL_JS_WHITESPACE_DRIFT_RE.test(description)
        && !NON_BMP_RE.test(description)
        && hasLegacyEdgeParity(description)
      )
    )
    && (
      href === undefined
      || (typeof href === "string" && !NON_BMP_RE.test(href))
    );
}

function hasProviderBackedAddActionAtomicEligibility(
  action: StoredAmoraPendingAction,
): boolean {
  if (
    Object.keys(action.input).some((key) => !ADD_ACTION_INPUT_KEYS.has(key))
  ) return false;
  const dueDate = action.input.due_date;
  if (
    dueDate !== undefined
    && (typeof dueDate !== "string" || !isValidScheduleYmd(dueDate))
  ) return false;
  const operation = buildAmoraAtomicToolOperation(
    "add_amora_action",
    action.input,
    {
      coupleId: "00000000-0000-4000-8000-000000000003",
      requestKey: ELIGIBILITY_PROBE_REQUEST_KEY,
      weddingContext: {
        weddingDate: null,
        budget: 0,
        venue: null,
        progress: {},
      },
    },
    action.operationKey,
  );
  return operation.result.success === true;
}

export function shouldSealAmoraOrdinaryProviderAddActionProposal(input: {
  pendingAction: StoredAmoraPendingAction | null;
  isDurableSharedW0: boolean;
  persistenceSourceIsProvider: boolean;
  hasApprovedPendingAction: boolean;
  hasFirstUseProvenance: boolean;
  scheduleCareDraftStatus: "absent" | "invalid" | "valid";
  hasResolvedScheduleCareFollowUp: boolean;
  attachmentCount: number;
}): boolean {
  return input.isDurableSharedW0
    && input.persistenceSourceIsProvider
    && input.pendingAction?.tool === "add_amora_action"
    && hasProviderBackedAddActionHrefParity(input.pendingAction)
    && hasProviderBackedAddActionTextParity(input.pendingAction)
    && hasProviderBackedAddActionAtomicEligibility(input.pendingAction)
    && !input.hasApprovedPendingAction
    && !input.hasFirstUseProvenance
    && input.scheduleCareDraftStatus === "absent"
    && !input.hasResolvedScheduleCareFollowUp
    && input.attachmentCount === 0;
}

export function parseAmoraProviderBackedAddActionApplicationSource(input: {
  sourceMessage: {
    id: string;
    content: string;
    metadata: unknown;
    createdAt: string;
  } | null;
  confirmedActionId: unknown;
  availableTools: readonly AiToolDefinition[];
  expectedJourneyRevision: number | null;
  now: number;
  allowExpired?: boolean;
}): AmoraProviderBackedAddActionApplicationSource | null {
  const source = input.sourceMessage;
  if (
    input.expectedJourneyRevision === null
    || !source
    || !UUID_RE.test(source.id)
    || !isBoundedString(source.content, MAX_MESSAGE_CHARS)
    || !Number.isFinite(Date.parse(source.createdAt))
    || !isRecord(source.metadata)
  ) return null;

  const metadata = source.metadata;
  if (
    metadata[AMORA_ADD_ACTION_PROPOSAL_ORIGIN_METADATA_KEY]
      !== AMORA_ADD_ACTION_PROPOSAL_ORIGIN
    || FORBIDDEN_SOURCE_METADATA_KEYS.some((key) => Object.hasOwn(metadata, key))
    || !isBoundedString(metadata.client_request_id, MAX_REQUEST_KEY_CHARS)
    || !CHAT_REQUEST_KEY_RE.test(metadata.client_request_id)
    || typeof metadata.in_reply_to_user_message_id !== "string"
    || !UUID_RE.test(metadata.in_reply_to_user_message_id)
    || metadata.question_scope !== "W0_wedding_core"
    || !isSafeRevision(metadata.amora_wedding_context_revision)
    || metadata.amora_wedding_context_revision !== input.expectedJourneyRevision
    || metadata.pending_amora_action_journey_revision
      !== input.expectedJourneyRevision
  ) return null;

  const storedAction = metadata.pending_amora_action;
  if (!isRecord(storedAction) || !hasExactKeys(storedAction, PENDING_ACTION_KEYS)) {
    return null;
  }
  const resolvedAction = resolveAmoraPendingAction({
    value: storedAction,
    confirmedActionId: input.confirmedActionId,
    allowedTools: input.availableTools,
    now: input.allowExpired
      && typeof storedAction.issuedAt === "number"
      && typeof storedAction.expiresAt === "number"
        ? Math.max(
            storedAction.issuedAt,
            Math.min(input.now, storedAction.expiresAt - 1),
          )
        : input.now,
  });
  if (
    !resolvedAction
    || resolvedAction.tool !== "add_amora_action"
    || !hasProviderBackedAddActionHrefParity(resolvedAction)
    || !hasProviderBackedAddActionTextParity(resolvedAction)
    || !hasProviderBackedAddActionAtomicEligibility(resolvedAction)
    || !exactJsonValueEqual(storedAction, resolvedAction)
    || source.content !== resolvedAction.confirmation
  ) return null;

  return {
    sourceProposalMessageId: source.id,
    journeyRevision: input.expectedJourneyRevision,
    pendingAction: resolvedAction,
  };
}

export function requiresStrictAmoraProviderBackedAddActionApplicationReplay(
  metadata: unknown,
): boolean {
  if (!isRecord(metadata)) return false;
  if (
    metadata.response_origin
      === AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN
    || Object.hasOwn(metadata, "source_amora_action_message_id")
    || hasExactKeys(metadata, APPLICATION_METADATA_KEYS)
  ) return true;
  return Object.hasOwn(metadata, "provider_call_count")
    && metadata.provider_call_count === 0
    && typeof metadata.confirmed_amora_action_id === "string"
    && !Object.hasOwn(metadata, "amora_first_use_promotion_id")
    && hasAddActionToolResult(metadata.toolResults);
}

function expectedCanonicalToolResult(input: {
  action: StoredAmoraPendingAction;
  chatRequestKey: string;
  coupleId: string;
}): Record<string, unknown> | null {
  const operation = buildAmoraAtomicToolOperation(
    "add_amora_action",
    input.action.input,
    {
      coupleId: input.coupleId,
      requestKey: input.chatRequestKey,
      weddingContext: {
        weddingDate: null,
        budget: 0,
        venue: null,
        progress: {},
      },
    },
    input.action.operationKey,
  );
  const result = operation.result;
  if (
    result.success !== true
    || !isRecord(result.toolOutput)
    || !hasExactKeys(result.toolOutput, ["action"])
    || !isRecord(result.toolOutput.action)
    || !hasExactKeys(result.toolOutput.action, ACTION_OUTPUT_KEYS)
  ) return null;
  return result as unknown as Record<string, unknown>;
}

export function parseAmoraProviderBackedAddActionApplication(input: {
  value: unknown;
  expectedChatRequestKey: string;
  expectedVisibleRequestKey: string;
  expectedConfirmationMessageId: string;
  expectedSourceMessageId: string;
  expectedPendingAction: StoredAmoraPendingAction;
  expectedJourneyRevision: number;
  expectedCoupleId: string;
}): PersistedAiMessage | null {
  if (!hasProviderBackedAddActionHrefParity(input.expectedPendingAction)) {
    return null;
  }
  if (!hasProviderBackedAddActionTextParity(input.expectedPendingAction)) {
    return null;
  }
  if (!hasProviderBackedAddActionAtomicEligibility(input.expectedPendingAction)) {
    return null;
  }
  if (!Array.isArray(input.value) || input.value.length !== 1) return null;
  const row = input.value[0];
  if (
    !isRecord(row)
    || !hasExactKeys(row, APPLICATION_ROW_KEYS)
    || !(
      (row.outcome === "persisted" && row.message_reused === false)
      || (row.outcome === "replayed" && row.message_reused === true)
    )
    || typeof row.message_id !== "string"
    || !UUID_RE.test(row.message_id)
    || typeof row.message_created_at !== "string"
    || row.message_created_at.length > 64
    || !Number.isFinite(Date.parse(row.message_created_at))
    || !isBoundedString(row.message_content, MAX_MESSAGE_CHARS)
    || !isRecord(row.message_metadata)
    || row.message_stage_tag !== null
    || row.message_specialist_type !== "general"
    || row.message_visibility !== "shared"
  ) return null;

  const expectedToolResult = expectedCanonicalToolResult({
    action: input.expectedPendingAction,
    chatRequestKey: input.expectedChatRequestKey,
    coupleId: input.expectedCoupleId,
  });
  const metadata = row.message_metadata;
  if (
    !expectedToolResult
    || !isRecord(row.tool_result)
    || !hasExactKeys(row.tool_result, TOOL_RESULT_KEYS)
    || !exactJsonValueEqual(row.tool_result, expectedToolResult)
    || !hasExactKeys(metadata, APPLICATION_METADATA_KEYS)
    || metadata.client_request_id !== input.expectedChatRequestKey
    || metadata.client_visible_request_id !== input.expectedVisibleRequestKey
    || metadata.in_reply_to_user_message_id
      !== input.expectedConfirmationMessageId
    || metadata.confirmed_amora_action_id
      !== input.expectedPendingAction.actionId
    || metadata.question_scope !== "W0_wedding_core"
    || metadata.memory_eligible !== false
    || metadata.memory_enqueue_requested !== false
    || metadata.amora_wedding_context_revision
      !== input.expectedJourneyRevision
    || metadata.source_amora_action_message_id
      !== input.expectedSourceMessageId
    || !Array.isArray(metadata.toolResults)
    || metadata.toolResults.length !== 1
    || !exactJsonValueEqual(metadata.toolResults[0], expectedToolResult)
    || !Array.isArray(metadata.toolsUsed)
    || metadata.toolsUsed.length !== 1
    || metadata.toolsUsed[0] !== "add_amora_action"
    || metadata.persistence_terminal_source !== "server_mutation_receipts"
    || metadata.response_origin
      !== AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN
    || metadata.provider_call_count !== 0
    || row.message_content !== expectedToolResult.displayMessage
  ) return null;

  return {
    id: row.message_id,
    createdAt: row.message_created_at,
    content: row.message_content,
    metadata,
    stageTag: null,
    specialistType: "general",
    visibility: "shared",
    reused: row.message_reused,
  };
}

export function parsePersistedAmoraProviderBackedAddActionApplication(input: {
  message: PersistedAiMessage;
  expectedChatRequestKey: string;
  expectedVisibleRequestKey: string;
  expectedConfirmationMessageId: string;
  expectedSourceMessageId: string;
  expectedPendingAction: StoredAmoraPendingAction;
  expectedJourneyRevision: number;
  expectedCoupleId: string;
}): PersistedAiMessage | null {
  const metadata = input.message.metadata;
  const toolResult = isRecord(metadata)
    && Array.isArray(metadata.toolResults)
    && metadata.toolResults.length === 1
      ? metadata.toolResults[0]
      : null;
  return parseAmoraProviderBackedAddActionApplication({
    value: [{
      outcome: input.message.reused ? "replayed" : "persisted",
      tool_result: toolResult,
      message_id: input.message.id,
      message_created_at: input.message.createdAt,
      message_content: input.message.content,
      message_metadata: metadata,
      message_stage_tag: input.message.stageTag,
      message_specialist_type: input.message.specialistType,
      message_visibility: input.message.visibility,
      message_reused: input.message.reused,
    }],
    expectedChatRequestKey: input.expectedChatRequestKey,
    expectedVisibleRequestKey: input.expectedVisibleRequestKey,
    expectedConfirmationMessageId: input.expectedConfirmationMessageId,
    expectedSourceMessageId: input.expectedSourceMessageId,
    expectedPendingAction: input.expectedPendingAction,
    expectedJourneyRevision: input.expectedJourneyRevision,
    expectedCoupleId: input.expectedCoupleId,
  });
}
