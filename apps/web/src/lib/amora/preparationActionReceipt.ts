import {
  AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION,
  parseAmoraFirstUseActionApplicationSource,
  parseAmoraFirstUseDeterministicApplication,
} from "@/lib/ai/amoraFirstUseDeterministicApplication";
import {
  AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN,
  parseAmoraProviderBackedAddActionApplication,
  parseAmoraProviderBackedAddActionApplicationSource,
} from "@/lib/ai/amoraProviderBackedAddActionApplication";
import type { StoredAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");
const CHAT_REQUEST_KEY_RE = new RegExp(
  `^chat:(${UUID_PATTERN}):(${UUID_PATTERN})$`,
  "i",
);
const ACTION_ID_RE = /^[0-9A-Za-z_-]{1,200}$/u;
const TOPIC_KEYS = new Set([
  "meeting", "venue", "studio", "dress", "makeup", "ring", "hanbok",
  "yedan", "honeymoon", "houseware", "housing", "invitation", "snap",
  "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
]);
const FIRST_USE_APPLICATION_ORIGIN =
  "server_authoritative_first_use_action_application";

type DbMessage = {
  id: string;
  couple_id: string;
  sender_id: string | null;
  sender_type: string;
  sender_role?: string | null;
  role: string;
  content: string;
  metadata: unknown;
  visibility: string;
  stage_tag?: string | null;
  specialist_type?: string | null;
  created_at: string;
};

type FirstUseBinding = {
  proposal_message_id: string;
  couple_id: string;
  action_id: string;
  promotion_id: string;
  proposal_journey_revision: number;
};

type ToolExecution = {
  couple_id: string;
  request_key: string;
  operation_key: string;
  tool_name: string;
  input_digest: string;
  status: string;
  result: unknown;
  pending_action_id: string | null;
  pending_action_journey_revision: number | null;
};

export type PreparationActionReceiptEntry = {
  receiptMessageId: string;
  actionId: string;
  topicKey: string | null;
  title: string;
  displayMessage: string;
  appliedAt: string;
  scope: "couple_shared";
  canOpenAction: true;
};

export type PreparationActionReceiptCandidate = {
  coupleId: string;
  receiptMessage: DbMessage;
  sourceMessage: DbMessage | null;
  confirmationMessage: DbMessage | null;
  firstUseBinding: FirstUseBinding | null;
  execution: ToolExecution | null;
  nowMs: number;
};

export type PreparationActionReceiptBoundary = {
  appliedAt: string;
  receiptMessageId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isCanonicalSharedAiMessage(
  value: DbMessage | null,
  coupleId: string,
): value is DbMessage {
  return value !== null
    && UUID_RE.test(value.id)
    && value.couple_id === coupleId
    && value.sender_id === null
    && value.sender_type === "ai"
    && (value.sender_role === undefined || value.sender_role === null)
    && value.role === "assistant"
    && typeof value.content === "string"
    && value.content.length >= 1
    && value.content.length <= 2_000
    && isRecord(value.metadata)
    && value.visibility === "shared"
    && (value.stage_tag === undefined || value.stage_tag === null)
    && (value.specialist_type === undefined || value.specialist_type === "general")
    && isIsoTime(value.created_at);
}

function parseConfirmation(input: {
  value: DbMessage | null;
  coupleId: string;
  receiptMetadata: Record<string, unknown>;
}) {
  const value = input.value;
  const requestKey = input.receiptMetadata.client_request_id;
  const requestMatch = typeof requestKey === "string"
    ? CHAT_REQUEST_KEY_RE.exec(requestKey)
    : null;
  if (
    !value
    || !requestMatch
    || !UUID_RE.test(value.id)
    || value.id !== input.receiptMetadata.in_reply_to_user_message_id
    || value.couple_id !== input.coupleId
    || value.sender_id?.toLowerCase() !== requestMatch[1]?.toLowerCase()
    || (value.sender_type !== "bride" && value.sender_type !== "groom")
    || value.role !== "user"
    || value.visibility !== "shared"
    || value.content !== AMORA_FIRST_USE_ACTION_APPLICATION_CONFIRMATION
    || !isRecord(value.metadata)
    || value.metadata.confirmed_amora_action_id
      !== input.receiptMetadata.confirmed_amora_action_id
    || typeof value.metadata.client_request_id !== "string"
    || !UUID_RE.test(value.metadata.client_request_id)
    || !isIsoTime(value.created_at)
  ) return null;

  return {
    actorId: requestMatch[1]!.toLowerCase(),
    visibleRequestKey:
      `chat:${requestMatch[1]!.toLowerCase()}:${value.metadata.client_request_id.toLowerCase()}`,
  };
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
    && leftKeys.every((key) => (
      Object.hasOwn(right, key) && exactJsonValueEqual(left[key], right[key])
    ));
}

function parsePublicToolResult(metadata: Record<string, unknown>) {
  if (!Array.isArray(metadata.toolResults) || metadata.toolResults.length !== 1) {
    return null;
  }
  const result = metadata.toolResults[0];
  if (
    !isRecord(result)
    || !hasExactKeys(result, [
      "toolName", "toolInput", "toolOutput", "success", "displayMessage",
    ])
    || result.toolName !== "add_amora_action"
    || result.success !== true
    || typeof result.displayMessage !== "string"
    || !isRecord(result.toolOutput)
    || !hasExactKeys(result.toolOutput, ["action"])
    || !isRecord(result.toolOutput.action)
  ) return null;
  return { result, action: result.toolOutput.action };
}

function matchesDurableExecution(input: {
  execution: ToolExecution | null;
  pendingAction: StoredAmoraPendingAction;
  publicResult: Record<string, unknown>;
  publicAction: Record<string, unknown>;
  coupleId: string;
  requestKey: string;
  journeyRevision: number;
}) {
  const execution = input.execution;
  if (
    !execution
    || execution.couple_id !== input.coupleId
    || execution.request_key !== input.requestKey
    || execution.operation_key !== input.pendingAction.operationKey
    || execution.tool_name !== "add_amora_action"
    || execution.input_digest !== input.pendingAction.inputDigest
    || execution.status !== "completed"
    || execution.pending_action_id !== input.pendingAction.actionId
    || execution.pending_action_journey_revision !== input.journeyRevision
    || !isRecord(execution.result)
    || !hasExactKeys(execution.result, [
      "toolName", "toolOutput", "success", "displayMessage",
    ])
    || execution.result.toolName !== "add_amora_action"
    || execution.result.success !== true
    || execution.result.displayMessage !== input.publicResult.displayMessage
    || !isRecord(execution.result.toolOutput)
    || !hasExactKeys(execution.result.toolOutput, ["action"])
    || !isRecord(execution.result.toolOutput.action)
  ) return false;

  const durableAction = execution.result.toolOutput.action;
  const stableKeys = [
    "id", "title", "description", "dueDate", "categoryKey",
    "priority", "status", "source", "href",
  ] as const;
  if (!stableKeys.every((key) => {
    const durableValue = Object.hasOwn(durableAction, key)
      ? durableAction[key]
      : null;
    return exactJsonValueEqual(durableValue, input.publicAction[key]);
  })) return false;
  return isIsoTime(durableAction.createdAt) && isIsoTime(durableAction.updatedAt);
}

function parseFirstUseBinding(
  value: FirstUseBinding | null,
  input: {
    coupleId: string;
    sourceMessageId: string;
    actionId: string;
    promotionId: string;
    journeyRevision: number;
  },
) {
  return value !== null
    && value.couple_id === input.coupleId
    && value.proposal_message_id === input.sourceMessageId
    && value.action_id === input.actionId
    && value.promotion_id === input.promotionId
    && value.proposal_journey_revision === input.journeyRevision;
}

export function parsePreparationActionReceiptCandidate(
  input: PreparationActionReceiptCandidate,
): PreparationActionReceiptEntry | null {
  if (
    !UUID_RE.test(input.coupleId)
    || !Number.isFinite(input.nowMs)
    || !isCanonicalSharedAiMessage(input.receiptMessage, input.coupleId)
  ) return null;
  const metadata = input.receiptMessage.metadata;
  if (!isRecord(metadata)) return null;
  const origin = metadata.response_origin;
  if (
    origin !== FIRST_USE_APPLICATION_ORIGIN
    && origin !== AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN
  ) return null;

  const confirmation = parseConfirmation({
    value: input.confirmationMessage,
    coupleId: input.coupleId,
    receiptMetadata: metadata,
  });
  if (!confirmation) return null;
  if (
    Date.parse(input.confirmationMessage!.created_at)
      > Date.parse(input.receiptMessage.created_at)
  ) return null;

  const publicTool = parsePublicToolResult(metadata);
  if (!publicTool || input.receiptMessage.content !== publicTool.result.displayMessage) {
    return null;
  }
  const confirmedActionId = metadata.confirmed_amora_action_id;
  const journeyRevision = metadata.amora_wedding_context_revision;
  if (
    typeof confirmedActionId !== "string"
    || !UUID_RE.test(confirmedActionId)
    || !isSafeRevision(journeyRevision)
    || typeof metadata.client_request_id !== "string"
  ) return null;

  let pendingAction: StoredAmoraPendingAction;
  if (origin === FIRST_USE_APPLICATION_ORIGIN) {
    if (!isCanonicalSharedAiMessage(input.sourceMessage, input.coupleId)) return null;
    const source = parseAmoraFirstUseActionApplicationSource({
      sourceMessage: {
        id: input.sourceMessage.id,
        content: input.sourceMessage.content,
        metadata: input.sourceMessage.metadata,
        createdAt: input.sourceMessage.created_at,
      },
      confirmedActionId,
      availableTools: BETA_SAFE_TOOLS,
      expectedJourneyRevision: journeyRevision,
      expectedCriterionDecisionId: undefined,
      now: input.nowMs,
      allowExpired: true,
    });
    if (
      !source
      || !parseFirstUseBinding(input.firstUseBinding, {
        coupleId: input.coupleId,
        sourceMessageId: source.sourceProposalMessageId,
        actionId: source.pendingAction.actionId,
        promotionId: source.promotionId,
        journeyRevision: source.journeyRevision,
      })
      || !parseAmoraFirstUseDeterministicApplication({
        value: [{
          outcome: "persisted",
          tool_result: publicTool.result,
          message_id: input.receiptMessage.id,
          message_created_at: input.receiptMessage.created_at,
          message_content: input.receiptMessage.content,
          message_metadata: metadata,
          message_stage_tag: input.receiptMessage.stage_tag ?? null,
          message_specialist_type: input.receiptMessage.specialist_type ?? null,
          message_visibility: input.receiptMessage.visibility,
          message_reused: false,
        }],
        expectedChatRequestKey: metadata.client_request_id,
        expectedVisibleRequestKey: confirmation.visibleRequestKey,
        expectedConfirmationMessageId: input.confirmationMessage!.id,
        expectedPendingAction: source.pendingAction,
        expectedJourneyRevision: source.journeyRevision,
        expectedPromotionId: source.promotionId,
      })
    ) return null;
    pendingAction = source.pendingAction;
  } else {
    if (input.firstUseBinding !== null) return null;
    if (!isCanonicalSharedAiMessage(input.sourceMessage, input.coupleId)) return null;
    const source = parseAmoraProviderBackedAddActionApplicationSource({
      sourceMessage: {
        id: input.sourceMessage.id,
        content: input.sourceMessage.content,
        metadata: input.sourceMessage.metadata,
        createdAt: input.sourceMessage.created_at,
      },
      confirmedActionId,
      availableTools: BETA_SAFE_TOOLS,
      expectedJourneyRevision: journeyRevision,
      now: input.nowMs,
      allowExpired: true,
    });
    if (
      !source
      || !parseAmoraProviderBackedAddActionApplication({
        value: [{
          outcome: "persisted",
          tool_result: publicTool.result,
          message_id: input.receiptMessage.id,
          message_created_at: input.receiptMessage.created_at,
          message_content: input.receiptMessage.content,
          message_metadata: metadata,
          message_stage_tag: input.receiptMessage.stage_tag ?? null,
          message_specialist_type: input.receiptMessage.specialist_type ?? null,
          message_visibility: input.receiptMessage.visibility,
          message_reused: false,
        }],
        expectedChatRequestKey: metadata.client_request_id,
        expectedVisibleRequestKey: confirmation.visibleRequestKey,
        expectedConfirmationMessageId: input.confirmationMessage!.id,
        expectedSourceMessageId: source.sourceProposalMessageId,
        expectedPendingAction: source.pendingAction,
        expectedJourneyRevision: source.journeyRevision,
        expectedCoupleId: input.coupleId,
      })
    ) return null;
    pendingAction = source.pendingAction;
  }

  if (
    Date.parse(input.sourceMessage!.created_at)
      > Date.parse(input.confirmationMessage!.created_at)
    || !matchesDurableExecution({
      execution: input.execution,
      pendingAction,
      publicResult: publicTool.result,
      publicAction: publicTool.action,
      coupleId: input.coupleId,
      requestKey: metadata.client_request_id,
      journeyRevision,
    })
  ) return null;

  const action = publicTool.action;
  if (
    typeof action.id !== "string"
    || !ACTION_ID_RE.test(action.id)
    || typeof action.title !== "string"
    || action.title.length < 1
    || action.title.length > 120
  ) return null;
  const topicKey = typeof action.categoryKey === "string"
    && TOPIC_KEYS.has(action.categoryKey)
      ? action.categoryKey
      : null;
  return {
    receiptMessageId: input.receiptMessage.id.toLowerCase(),
    actionId: action.id,
    topicKey,
    title: action.title,
    displayMessage: input.receiptMessage.content,
    appliedAt: input.receiptMessage.created_at,
    scope: "couple_shared",
    canOpenAction: true,
  };
}

export function buildPreparationActionReceiptPage(input: {
  coupleId: string;
  recipientUserId: string;
  query: string;
  snapshotAt: string;
  limit: number;
  scanLimit: number;
  receiptMessages: readonly unknown[];
  sourceAndConfirmationMessages: readonly unknown[];
  firstUseBindings: readonly unknown[];
  executions: readonly unknown[];
  nowMs: number;
}): {
  entries: PreparationActionReceiptEntry[];
  nextBoundary: PreparationActionReceiptBoundary | null;
  partial: boolean;
} | null {
  if (
    !UUID_RE.test(input.coupleId)
    || !UUID_RE.test(input.recipientUserId)
    || !isIsoTime(input.snapshotAt)
    || typeof input.query !== "string"
    || input.query.length > 120
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 24
    || !Number.isSafeInteger(input.scanLimit)
    || input.scanLimit < input.limit
    || input.scanLimit > 192
    || !Array.isArray(input.receiptMessages)
    || input.receiptMessages.length > input.scanLimit + 1
    || !Array.isArray(input.sourceAndConfirmationMessages)
    || !Array.isArray(input.firstUseBindings)
    || !Array.isArray(input.executions)
    || !Number.isFinite(input.nowMs)
  ) return null;

  const messages = new Map<string, DbMessage>();
  for (const raw of input.sourceAndConfirmationMessages) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !UUID_RE.test(raw.id)) {
      continue;
    }
    const id = raw.id.toLowerCase();
    if (messages.has(id)) return null;
    messages.set(id, raw as unknown as DbMessage);
  }
  const bindings = input.firstUseBindings.filter(isRecord) as FirstUseBinding[];
  const executions = input.executions.filter(isRecord) as ToolExecution[];
  const normalizedQuery = input.query.normalize("NFKC").toLocaleLowerCase("ko-KR");
  const entries: PreparationActionReceiptEntry[] = [];
  const seenReceiptIds = new Set<string>();
  const seenActionIds = new Set<string>();
  let partial = false;
  let processed = 0;
  let lastBoundary: PreparationActionReceiptBoundary | null = null;

  for (const rawReceipt of input.receiptMessages.slice(0, input.scanLimit)) {
    processed += 1;
    if (!isRecord(rawReceipt)) {
      partial = true;
      continue;
    }
    const receipt = rawReceipt as unknown as DbMessage;
    if (!UUID_RE.test(receipt.id) || !isIsoTime(receipt.created_at)) {
      partial = true;
      continue;
    }
    lastBoundary = {
      appliedAt: receipt.created_at,
      receiptMessageId: receipt.id.toLowerCase(),
    };
    const metadata = isRecord(receipt.metadata) ? receipt.metadata : null;
    const confirmationId = typeof metadata?.in_reply_to_user_message_id === "string"
      ? metadata.in_reply_to_user_message_id.toLowerCase()
      : null;
    const origin = metadata?.response_origin;
    const actionId = typeof metadata?.confirmed_amora_action_id === "string"
      ? metadata.confirmed_amora_action_id.toLowerCase()
      : null;
    const requestKey = typeof metadata?.client_request_id === "string"
      ? metadata.client_request_id
      : null;
    let binding: FirstUseBinding | null = null;
    let sourceId: string | null = null;
    if (origin === FIRST_USE_APPLICATION_ORIGIN) {
      const promotionId = typeof metadata?.amora_first_use_promotion_id === "string"
        ? metadata.amora_first_use_promotion_id.toLowerCase()
        : null;
      const matches = promotionId && actionId
        ? bindings.filter((candidate) => (
          candidate.couple_id === input.coupleId
          && candidate.promotion_id === promotionId
          && candidate.action_id === actionId
        ))
        : [];
      if (matches.length === 1) {
        binding = matches[0]!;
        sourceId = binding.proposal_message_id.toLowerCase();
      }
    } else if (
      origin === AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_ORIGIN
      && typeof metadata?.source_amora_action_message_id === "string"
    ) {
      sourceId = metadata.source_amora_action_message_id.toLowerCase();
    }
    const matchingExecutions = requestKey && actionId
      ? executions.filter((candidate) => (
        candidate.couple_id === input.coupleId
        && candidate.request_key === requestKey
        && candidate.pending_action_id === actionId
      ))
      : [];
    const parsed = parsePreparationActionReceiptCandidate({
      coupleId: input.coupleId,
      receiptMessage: receipt,
      sourceMessage: sourceId ? messages.get(sourceId) ?? null : null,
      confirmationMessage: confirmationId
        ? messages.get(confirmationId) ?? null
        : null,
      firstUseBinding: binding,
      execution: matchingExecutions.length === 1 ? matchingExecutions[0]! : null,
      nowMs: input.nowMs,
    });
    if (!parsed) {
      partial = true;
      continue;
    }
    if (
      normalizedQuery !== ""
      && !`${parsed.title} ${parsed.displayMessage}`
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery)
    ) continue;
    if (
      seenReceiptIds.has(parsed.receiptMessageId)
      || seenActionIds.has(parsed.actionId)
    ) {
      partial = true;
      continue;
    }
    seenReceiptIds.add(parsed.receiptMessageId);
    seenActionIds.add(parsed.actionId);
    entries.push(parsed);
    if (entries.length >= input.limit) break;
  }

  const hasMore = processed < input.receiptMessages.length
    || input.receiptMessages.length > input.scanLimit;
  return {
    entries,
    nextBoundary: hasMore ? lastBoundary : null,
    partial,
  };
}
