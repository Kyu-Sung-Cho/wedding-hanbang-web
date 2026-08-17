import {
  matchesAmoraFirstUsePendingAction,
  type AmoraFirstUsePromotionValidation,
} from "@/lib/ai/amoraFirstUsePromotionBinding";
import {
  resolveAmoraPendingAction,
  type StoredAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { PersistedAiMessage } from "@/lib/ai/chatMessagePersistence";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_METADATA_KEYS = [
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
const OPTIONAL_METADATA_KEYS = [
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

function hasExactDeterministicMetadataKeys(
  value: Record<string, unknown>,
): boolean {
  const allowed = new Set<string>([
    ...REQUIRED_METADATA_KEYS,
    ...OPTIONAL_METADATA_KEYS,
  ]);
  return REQUIRED_METADATA_KEYS.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function makeBoundAddActionTool(
  availableTools: readonly AiToolDefinition[],
  binding: AmoraFirstUsePromotionValidation,
): AiToolDefinition | null {
  const tool = availableTools.find(
    (candidate) => candidate.name === "add_amora_action",
  );
  if (!tool) return null;
  return {
    ...tool,
    input_schema: {
      ...tool.input_schema,
      "x-amora-bound-input": binding.canonicalAddActionInput,
    },
  };
}

function parsePendingAction(input: {
  value: unknown;
  binding: AmoraFirstUsePromotionValidation;
  availableTools: readonly AiToolDefinition[];
  now: number;
}): StoredAmoraPendingAction | null {
  if (
    !isRecord(input.value)
    || !hasExactKeys(input.value, PENDING_ACTION_KEYS)
    || typeof input.value.actionId !== "string"
    || typeof input.value.issuedAt !== "number"
    || !Number.isSafeInteger(input.value.issuedAt)
  ) return null;
  const boundTool = makeBoundAddActionTool(
    input.availableTools,
    input.binding,
  );
  if (!boundTool) return null;
  const resolved = resolveAmoraPendingAction({
    value: input.value,
    confirmedActionId: input.value.actionId,
    allowedTools: [boundTool],
    now: Math.max(input.now, input.value.issuedAt),
  });
  return resolved && matchesAmoraFirstUsePendingAction(resolved, input.binding)
    ? resolved
    : null;
}

export function parseAmoraFirstUseDeterministicProposal(input: {
  value: unknown;
  binding: AmoraFirstUsePromotionValidation;
  availableTools: readonly AiToolDefinition[];
  expectedChatRequestKey: string;
  expectedVisibleRequestKey: string;
  expectedSharedUserMessageId: string;
  expectedJourneyRevision: number;
  expectedCriterionDecisionId: string | null;
  now: number;
}): PersistedAiMessage | null {
  if (!Array.isArray(input.value) || input.value.length !== 1) return null;
  const row = input.value[0];
  const outcomeMatchesReplay = isRecord(row) && (
    (row.outcome === "persisted" && row.message_reused === false)
    || (row.outcome === "replayed" && row.message_reused === true)
  );
  if (
    !isRecord(row)
    || !outcomeMatchesReplay
    || typeof row.message_id !== "string"
    || !UUID_RE.test(row.message_id)
    || typeof row.message_created_at !== "string"
    || row.message_created_at.length > 64
    || !Number.isFinite(Date.parse(row.message_created_at))
    || typeof row.message_content !== "string"
    || !row.message_content.trim()
    || row.message_content.length > 2_000
    || !isRecord(row.message_metadata)
    || row.message_stage_tag !== null
    || row.message_specialist_type !== "general"
    || row.message_visibility !== "shared"
    || typeof row.message_reused !== "boolean"
  ) return null;

  const metadata = row.message_metadata;
  if (
    !hasExactDeterministicMetadataKeys(metadata)
    || metadata.client_request_id !== input.expectedChatRequestKey
    || metadata.client_visible_request_id !== input.expectedVisibleRequestKey
    || metadata.in_reply_to_user_message_id
      !== input.expectedSharedUserMessageId
    || metadata.question_scope !== "W0_wedding_core"
    || metadata.memory_eligible !== false
    || metadata.memory_enqueue_requested !== false
    || metadata.amora_wedding_context_revision
      !== input.expectedJourneyRevision
    || metadata.pending_amora_action_journey_revision
      !== input.expectedJourneyRevision
    || metadata.amora_first_use_promotion_id
      !== input.binding.promotionId
    || metadata.response_origin
      !== "server_authoritative_first_use_promotion"
    || metadata.provider_call_count !== 0
  ) return null;

  if (input.expectedCriterionDecisionId === null) {
    if (Object.hasOwn(metadata, "amora_couple_criterion_decision_id")) {
      return null;
    }
  } else if (
    metadata.amora_couple_criterion_decision_id
      !== input.expectedCriterionDecisionId
  ) return null;

  const pendingAction = parsePendingAction({
    value: metadata.pending_amora_action,
    binding: input.binding,
    availableTools: input.availableTools,
    now: input.now,
  });
  const messageCreatedAtMs = Date.parse(row.message_created_at);
  if (
    !pendingAction
    || row.message_content !== pendingAction.confirmation
    || Math.abs(messageCreatedAtMs - pendingAction.issuedAt) > 5_000
  ) {
    return null;
  }

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
