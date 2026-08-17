import type { PersistedAiMessage } from "@/lib/ai/chatMessagePersistence";
import {
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

export const AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION =
  "좋아요. 제안한 변경을 적용해 주세요.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_KEY_CHARS = 160;
const MAX_MESSAGE_CHARS = 2_000;
const SOURCE_METADATA_REQUIRED_KEYS = [
  "client_request_id",
  "client_visible_request_id",
  "in_reply_to_user_message_id",
  "question_scope",
  "memory_eligible",
  "memory_enqueue_requested",
  "amora_wedding_context_revision",
  "pending_amora_action",
  "pending_amora_action_journey_revision",
  "amora_first_use_promotion_id",
  "response_origin",
  "provider_call_count",
] as const;
const SOURCE_METADATA_OPTIONAL_KEYS = [
  "amora_couple_criterion_decision_id",
] as const;
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
const CANONICAL_ADD_ACTION_INPUT_KEYS = [
  "title",
  "description",
  "category_key",
  "priority",
  "source",
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
  "amora_first_use_promotion_id",
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

type FirstUseApplicationSource = {
  sourceProposalMessageId: string;
  promotionId: string;
  journeyRevision: number;
  pendingAction: StoredAmoraPendingAction;
};

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

function hasRequiredAndOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
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

function hasExactCanonicalAddActionInput(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
): value is Record<string, unknown> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, CANONICAL_ADD_ACTION_INPUT_KEYS)
    || typeof value.title !== "string"
    || typeof value.description !== "string"
    || value.category_key !== "general"
    || value.priority !== "medium"
    || value.source !== "chat"
  ) return false;
  return CANONICAL_ADD_ACTION_INPUT_KEYS.every(
    (key) => value[key] === expected[key],
  );
}

function matchesExactPendingAction(
  value: unknown,
  expected: StoredAmoraPendingAction,
): boolean {
  return isRecord(value)
    && hasExactKeys(value, PENDING_ACTION_KEYS)
    && value.version === expected.version
    && value.actionId === expected.actionId
    && value.tool === expected.tool
    && hasExactCanonicalAddActionInput(value.input, expected.input)
    && value.inputDigest === expected.inputDigest
    && value.operationKey === expected.operationKey
    && value.confirmation === expected.confirmation
    && value.issuedAt === expected.issuedAt
    && value.expiresAt === expected.expiresAt;
}

export function parseAmoraFirstUseActionApplicationSource(input: {
  sourceMessage: {
    id: string;
    content: string;
    metadata: unknown;
    createdAt: string;
  } | null;
  confirmedActionId: unknown;
  availableTools: readonly AiToolDefinition[];
  expectedJourneyRevision: number | null;
  expectedCriterionDecisionId: string | null | undefined;
  now: number;
  allowExpired?: boolean;
}): FirstUseApplicationSource | null {
  const source = input.sourceMessage;
  if (
    input.expectedJourneyRevision === null
    || !source
    || !UUID_RE.test(source.id)
    || !isRecord(source.metadata)
  ) return null;

  const metadata = source.metadata;
  if (
    !hasRequiredAndOptionalKeys(
      metadata,
      SOURCE_METADATA_REQUIRED_KEYS,
      SOURCE_METADATA_OPTIONAL_KEYS,
    )
    || !isBoundedString(metadata.client_request_id, MAX_REQUEST_KEY_CHARS)
    || !isBoundedString(metadata.client_visible_request_id, MAX_REQUEST_KEY_CHARS)
    || typeof metadata.in_reply_to_user_message_id !== "string"
    || !UUID_RE.test(metadata.in_reply_to_user_message_id)
    || metadata.question_scope !== "W0_wedding_core"
    || metadata.memory_eligible !== false
    || metadata.memory_enqueue_requested !== false
    || !isSafeRevision(metadata.amora_wedding_context_revision)
    || metadata.amora_wedding_context_revision !== input.expectedJourneyRevision
    || metadata.pending_amora_action_journey_revision
      !== input.expectedJourneyRevision
    || typeof metadata.amora_first_use_promotion_id !== "string"
    || !UUID_RE.test(metadata.amora_first_use_promotion_id)
    || metadata.response_origin
      !== "server_authoritative_first_use_promotion"
    || metadata.provider_call_count !== 0
  ) return null;

  const storedAction = metadata.pending_amora_action;
  const storedActionInput = isRecord(storedAction)
    && isRecord(storedAction.input)
      ? storedAction.input
      : null;
  if (
    !isRecord(storedAction)
    || !hasExactKeys(storedAction, PENDING_ACTION_KEYS)
    || storedAction.tool !== "add_amora_action"
    || !storedActionInput
    || !hasExactCanonicalAddActionInput(storedActionInput, storedActionInput)
  ) return null;
  const addActionTool = input.availableTools.find(
    (candidate) => candidate.name === "add_amora_action",
  );
  if (!addActionTool) return null;
  const pendingAction = resolveAmoraPendingAction({
    value: storedAction,
    confirmedActionId: input.confirmedActionId,
    allowedTools: [{
      ...addActionTool,
      input_schema: {
        ...addActionTool.input_schema,
        "x-amora-bound-input": storedActionInput,
      },
    }],
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
    !pendingAction
    || !matchesExactPendingAction(storedAction, pendingAction)
    || source.content !== pendingAction.confirmation
  ) return null;

  if (input.expectedCriterionDecisionId === undefined) {
    const storedCriterionDecisionId =
      metadata.amora_couple_criterion_decision_id;
    if (
      storedCriterionDecisionId !== undefined
      && (
        typeof storedCriterionDecisionId !== "string"
        || !UUID_RE.test(storedCriterionDecisionId)
      )
    ) return null;
  } else if (input.expectedCriterionDecisionId === null) {
    if (Object.hasOwn(metadata, "amora_couple_criterion_decision_id")) {
      return null;
    }
  } else if (
    metadata.amora_couple_criterion_decision_id
      !== input.expectedCriterionDecisionId
  ) return null;

  const sourceCreatedAtMs = Date.parse(source.createdAt);
  if (
    !Number.isFinite(sourceCreatedAtMs)
    || Math.abs(sourceCreatedAtMs - pendingAction.issuedAt) > 5_000
  ) return null;

  return {
    sourceProposalMessageId: source.id,
    promotionId: metadata.amora_first_use_promotion_id,
    journeyRevision: metadata.amora_wedding_context_revision,
    pendingAction,
  };
}

export function requiresStrictAmoraFirstUseApplicationReplay(
  metadata: unknown,
): boolean {
  if (!isRecord(metadata)) return false;
  if (
    metadata.response_origin
      === "server_authoritative_first_use_action_application"
  ) return true;
  if (hasExactKeys(metadata, APPLICATION_METADATA_KEYS)) return true;
  const toolResults = Array.isArray(metadata.toolResults)
    ? metadata.toolResults
    : [];
  return typeof metadata.confirmed_amora_action_id === "string"
    && typeof metadata.amora_first_use_promotion_id === "string"
    && toolResults.some((result) =>
      isRecord(result) && result.toolName === "add_amora_action"
    );
}

function parseCanonicalToolResult(input: {
  value: unknown;
  expectedAction: StoredAmoraPendingAction;
  expectedChatRequestKey: string;
}): Record<string, unknown> | null {
  const value = input.value;
  if (
    !isRecord(value)
    || !hasExactKeys(value, TOOL_RESULT_KEYS)
    || value.toolName !== "add_amora_action"
    || value.success !== true
    || !hasExactCanonicalAddActionInput(
      value.toolInput,
      input.expectedAction.input,
    )
    || !isRecord(value.toolOutput)
    || !hasExactKeys(value.toolOutput, ["action"])
    || !isRecord(value.toolOutput.action)
  ) return null;

  const action = value.toolOutput.action;
  const title = input.expectedAction.input.title;
  const description = input.expectedAction.input.description;
  const requestUuid = input.expectedChatRequestKey.match(
    /:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )?.[1];
  const expectedActionId = requestUuid
    ? `act_${requestUuid.replace(/-/g, "").toLowerCase()}_${input.expectedAction.operationKey.slice(0, 24)}`
    : null;
  if (
    !hasExactKeys(action, ACTION_OUTPUT_KEYS)
    || expectedActionId === null
    || action.id !== expectedActionId
    || action.title !== title
    || action.description !== description
    || action.dueDate !== null
    || action.categoryKey !== null
    || action.priority !== "medium"
    || action.status !== "open"
    || action.source !== "chat"
    || action.href !== "/wedding/lounge"
  ) return null;
  const expectedDisplayMessage =
    `"${String(title)}"을 아모라 행동 카드로 저장했어요.`;
  if (value.displayMessage !== expectedDisplayMessage) return null;
  return value;
}

function matchesToolResult(
  left: Record<string, unknown>,
  right: unknown,
): boolean {
  if (!isRecord(right)) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseAmoraFirstUseDeterministicApplication(input: {
  value: unknown;
  expectedChatRequestKey: string;
  expectedVisibleRequestKey: string;
  expectedConfirmationMessageId: string;
  expectedPendingAction: StoredAmoraPendingAction;
  expectedJourneyRevision: number;
  expectedPromotionId: string;
}): PersistedAiMessage | null {
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

  const toolResult = parseCanonicalToolResult({
    value: row.tool_result,
    expectedAction: input.expectedPendingAction,
    expectedChatRequestKey: input.expectedChatRequestKey,
  });
  const metadata = row.message_metadata;
  if (
    !toolResult
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
    || metadata.amora_first_use_promotion_id !== input.expectedPromotionId
    || !Array.isArray(metadata.toolResults)
    || metadata.toolResults.length !== 1
    || !matchesToolResult(toolResult, metadata.toolResults[0])
    || !Array.isArray(metadata.toolsUsed)
    || metadata.toolsUsed.length !== 1
    || metadata.toolsUsed[0] !== "add_amora_action"
    || metadata.persistence_terminal_source !== "server_mutation_receipts"
    || metadata.response_origin
      !== "server_authoritative_first_use_action_application"
    || metadata.provider_call_count !== 0
    || row.message_content !== toolResult.displayMessage
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

export function parsePersistedAmoraFirstUseDeterministicApplication(input: {
  message: PersistedAiMessage;
  expectedChatRequestKey: string;
  expectedVisibleRequestKey: string;
  expectedConfirmationMessageId: string;
  expectedPendingAction: StoredAmoraPendingAction;
  expectedJourneyRevision: number;
  expectedPromotionId: string;
}): PersistedAiMessage | null {
  const metadata = input.message.metadata;
  const toolResult = isRecord(metadata)
    && Array.isArray(metadata.toolResults)
    && metadata.toolResults.length === 1
      ? metadata.toolResults[0]
      : null;
  return parseAmoraFirstUseDeterministicApplication({
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
    expectedPendingAction: input.expectedPendingAction,
    expectedJourneyRevision: input.expectedJourneyRevision,
    expectedPromotionId: input.expectedPromotionId,
  });
}
