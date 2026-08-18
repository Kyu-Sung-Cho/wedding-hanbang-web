import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { parseAmoraFirstUseActionApplicationSource } from "@/lib/ai/amoraFirstUseDeterministicApplication";
import { extractAmoraPendingAction, resolveAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  buildPreparationActionReceiptPage,
  parsePreparationActionReceiptCandidate,
} from "@/lib/amora/preparationActionReceipt";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const COUPLE = "20000000-0000-4000-8000-000000000002";
const CONFIRMATION = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const RECEIPT = "50000000-0000-4000-8000-000000000005";
const PENDING_ACTION = "60000000-0000-4000-8000-000000000006";
const VISIBLE_REQUEST = "70000000-0000-4000-8000-000000000007";
const SOURCE_USER_MESSAGE = "80000000-0000-4000-8000-000000000008";
const PROMOTION = "90000000-0000-4000-8000-000000000009";
const FIRST_USE_ACTION = "예식장 후보 비교 기준 정리";
const FIRST_USE_REASON = "장소를 보기 전에 두 사람의 공통 기준이 필요해요.";
const FIRST_USE_COMPLETION_CRITERION =
  "각자 꼭 지킬 기준을 하나씩 적으면 끝나요.";
const FIRST_USE_DESCRIPTION =
  `이유: ${FIRST_USE_REASON} 완료 기준: ${FIRST_USE_COMPLETION_CRITERION}`;

function confirmationRequestUuid() {
  const hex = createHash("sha256")
    .update(`amora-confirmed-action-request\0${CONFIRMATION}\0${PENDING_ACTION}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function providerCandidate(
  description = "두 사람이 확인할 조건을 한 번 더 대조해요.",
) {
  const issuedAt = Date.parse("2026-08-18T01:00:00.000Z");
  const input = {
    title: "예식장 계약 조건 다시 확인",
    description,
    category_key: "venue",
    priority: "medium",
    source: "chat",
    href: "/wedding/lounge",
  };
  const pendingAction = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "add_amora_action", input })}[/pending_action]`,
    allowedTools: BETA_SAFE_TOOLS,
    now: issuedAt,
    createActionId: () => PENDING_ACTION,
  }).pendingAction!;
  const requestKey = `chat:${ACTOR}:${confirmationRequestUuid()}`;
  const operation = buildAmoraAtomicToolOperation(
    "add_amora_action",
    pendingAction.input,
    {
      coupleId: COUPLE,
      requestKey,
      weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
    },
    pendingAction.operationKey,
  );
  if (!operation.result.success || !operation.result.toolOutput) {
    throw new Error("fixture operation failed");
  }
  const publicResult = operation.result;
  const publicAction = publicResult.toolOutput.action as Record<string, unknown>;
  const displayMessage = publicResult.displayMessage;
  const sourceMetadata = {
    client_request_id: `chat:${ACTOR}:90000000-0000-4000-8000-000000000009`,
    in_reply_to_user_message_id: SOURCE_USER_MESSAGE,
    question_scope: "W0_wedding_core",
    memory_eligible: false,
    memory_enqueue_requested: false,
    amora_wedding_context_revision: 12,
    pending_amora_action: pendingAction,
    pending_amora_action_journey_revision: 12,
    amora_add_action_proposal_origin_v1: "ordinary_provider",
  };
  const receiptMetadata = {
    client_request_id: requestKey,
    client_visible_request_id: `chat:${ACTOR}:${VISIBLE_REQUEST}`,
    in_reply_to_user_message_id: CONFIRMATION,
    confirmed_amora_action_id: PENDING_ACTION,
    question_scope: "W0_wedding_core",
    memory_eligible: false,
    memory_enqueue_requested: false,
    amora_wedding_context_revision: 12,
    source_amora_action_message_id: SOURCE,
    toolResults: [publicResult],
    toolsUsed: ["add_amora_action"],
    persistence_terminal_source: "server_mutation_receipts",
    response_origin: "server_authoritative_provider_backed_add_action_application",
    provider_call_count: 0,
  };
  return {
    coupleId: COUPLE,
    receiptMessage: {
      id: RECEIPT,
      couple_id: COUPLE,
      sender_id: null,
      sender_type: "ai",
      sender_role: null,
      role: "assistant",
      content: displayMessage,
      metadata: receiptMetadata,
      visibility: "shared",
      stage_tag: null,
      specialist_type: "general",
      created_at: "2026-08-18T01:02:00.000Z",
    },
    sourceMessage: {
      id: SOURCE,
      couple_id: COUPLE,
      sender_id: null,
      sender_type: "ai",
      sender_role: null,
      role: "assistant",
      content: pendingAction.confirmation,
      metadata: sourceMetadata,
      visibility: "shared",
      stage_tag: null,
      specialist_type: "general",
      created_at: "2026-08-18T01:00:00.000Z",
    },
    confirmationMessage: {
      id: CONFIRMATION,
      couple_id: COUPLE,
      sender_id: ACTOR,
      sender_type: "bride",
      sender_role: null,
      role: "user",
      content: "좋아요. 제안한 변경을 적용해 주세요.",
      metadata: {
        client_request_id: VISIBLE_REQUEST,
        confirmed_amora_action_id: PENDING_ACTION,
      },
      visibility: "shared",
      created_at: "2026-08-18T01:01:00.000Z",
    },
    firstUseBinding: null,
    execution: {
      couple_id: COUPLE,
      request_key: requestKey,
      operation_key: pendingAction.operationKey,
      tool_name: "add_amora_action",
      input_digest: pendingAction.inputDigest,
      status: "completed",
      result: {
        toolName: "add_amora_action",
        toolOutput: {
          action: {
            ...publicAction,
            createdAt: "2026-08-18T01:01:59.000Z",
            updatedAt: "2026-08-18T01:01:59.000Z",
          },
        },
        success: true,
        displayMessage,
      },
      pending_action_id: PENDING_ACTION,
      pending_action_journey_revision: 12,
    },
    nowMs: Date.parse("2026-08-18T02:00:00.000Z"),
  };
}

function firstUseCandidate(description = FIRST_USE_DESCRIPTION) {
  const issuedAt = Date.parse("2026-08-18T03:00:00.000Z");
  const input = {
    title: FIRST_USE_ACTION,
    description,
    category_key: "general",
    priority: "medium",
    source: "chat",
  };
  const addActionTool = BETA_SAFE_TOOLS.find(
    (tool) => tool.name === "add_amora_action",
  )!;
  const pendingAction = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "add_amora_action", input })}[/pending_action]`,
    allowedTools: [{
      ...addActionTool,
      input_schema: {
        ...addActionTool.input_schema,
        "x-amora-bound-input": input,
      },
    }],
    now: issuedAt,
    createActionId: () => PENDING_ACTION,
  }).pendingAction!;
  const requestKey = `chat:${ACTOR}:${confirmationRequestUuid()}`;
  const actionId = `act_${confirmationRequestUuid().replaceAll("-", "")}_${pendingAction.operationKey.slice(0, 24)}`;
  const displayMessage = `"${input.title}"을 아모라 행동 카드로 저장했어요.`;
  const publicAction = {
    id: actionId,
    title: input.title,
    description: input.description,
    dueDate: null,
    categoryKey: null,
    priority: "medium",
    status: "open",
    source: "chat",
    href: "/wedding/lounge",
  };
  const publicResult = {
    toolName: "add_amora_action",
    toolInput: input,
    toolOutput: { action: publicAction },
    success: true,
    displayMessage,
  };
  const receiptMetadata = {
    client_request_id: requestKey,
    client_visible_request_id: `chat:${ACTOR}:${VISIBLE_REQUEST}`,
    in_reply_to_user_message_id: CONFIRMATION,
    confirmed_amora_action_id: PENDING_ACTION,
    question_scope: "W0_wedding_core",
    memory_eligible: false,
    memory_enqueue_requested: false,
    amora_wedding_context_revision: 4,
    amora_first_use_promotion_id: PROMOTION,
    toolResults: [publicResult],
    toolsUsed: ["add_amora_action"],
    persistence_terminal_source: "server_mutation_receipts",
    response_origin: "server_authoritative_first_use_action_application",
    provider_call_count: 0,
  };
  return {
    coupleId: COUPLE,
    receiptMessage: {
      id: RECEIPT,
      couple_id: COUPLE,
      sender_id: null,
      sender_type: "ai",
      sender_role: null,
      role: "assistant",
      content: displayMessage,
      metadata: receiptMetadata,
      visibility: "shared",
      stage_tag: null,
      specialist_type: "general",
      created_at: "2026-08-18T03:02:00.000Z",
    },
    sourceMessage: {
      id: SOURCE,
      couple_id: COUPLE,
      sender_id: null,
      sender_type: "ai",
      sender_role: null,
      role: "assistant",
      content: pendingAction.confirmation,
      metadata: {
        client_request_id: `chat:${ACTOR}:a0000000-0000-4000-8000-000000000010`,
        client_visible_request_id: `chat:${ACTOR}:b0000000-0000-4000-8000-000000000011`,
        in_reply_to_user_message_id: SOURCE_USER_MESSAGE,
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 4,
        pending_amora_action: pendingAction,
        pending_amora_action_journey_revision: 4,
        amora_first_use_promotion_id: PROMOTION,
        response_origin: "server_authoritative_first_use_promotion",
        provider_call_count: 0,
      },
      visibility: "shared",
      stage_tag: null,
      specialist_type: "general",
      created_at: new Date(issuedAt).toISOString(),
    },
    confirmationMessage: {
      id: CONFIRMATION,
      couple_id: COUPLE,
      sender_id: ACTOR,
      sender_type: "bride",
      role: "user",
      content: "좋아요. 제안한 변경을 적용해 주세요.",
      metadata: {
        client_request_id: VISIBLE_REQUEST,
        confirmed_amora_action_id: PENDING_ACTION,
      },
      visibility: "shared",
      created_at: "2026-08-18T03:01:00.000Z",
    },
    firstUseBinding: {
      proposal_message_id: SOURCE,
      couple_id: COUPLE,
      action_id: PENDING_ACTION,
      promotion_id: PROMOTION,
      proposal_journey_revision: 4,
    },
    execution: {
      couple_id: COUPLE,
      request_key: requestKey,
      operation_key: pendingAction.operationKey,
      tool_name: "add_amora_action",
      input_digest: pendingAction.inputDigest,
      status: "completed",
      result: {
        toolName: "add_amora_action",
        toolOutput: {
          action: {
            id: actionId,
            title: input.title,
            description: input.description,
            priority: "medium",
            status: "open",
            source: "chat",
            href: "/wedding/lounge",
            createdAt: "2026-08-18T03:01:59.000Z",
            updatedAt: "2026-08-18T03:01:59.000Z",
          },
        },
        success: true,
        displayMessage,
      },
      pending_action_id: PENDING_ACTION,
      pending_action_journey_revision: 4,
    },
    nowMs: Date.parse("2026-08-18T04:00:00.000Z"),
  };
}

function actionReceiptPageInput(
  candidate:
    | ReturnType<typeof providerCandidate>
    | ReturnType<typeof firstUseCandidate>,
  query: string,
  contractVersion?: 1 | 2,
) {
  return {
    coupleId: COUPLE,
    recipientUserId: ACTOR,
    query,
    snapshotAt: new Date(candidate.nowMs).toISOString(),
    limit: 24,
    scanLimit: 192,
    receiptMessages: [candidate.receiptMessage],
    sourceAndConfirmationMessages: [
      candidate.sourceMessage,
      candidate.confirmationMessage,
    ],
    firstUseBindings: candidate.firstUseBinding === null
      ? []
      : [candidate.firstUseBinding],
    executions: [candidate.execution],
    nowMs: candidate.nowMs,
    ...(contractVersion === undefined ? {} : { contractVersion }),
  };
}

describe("preparation action receipt", () => {
  it("builds a bounded searchable page and marks duplicate durable receipts partial", () => {
    const candidate = providerCandidate();
    const expectedAction = (
      candidate.execution.result.toolOutput.action as Record<string, unknown>
    );
    const input = {
      coupleId: COUPLE,
      recipientUserId: ACTOR,
      query: "예식장",
      snapshotAt: "2026-08-18T02:00:00.000Z",
      limit: 24,
      scanLimit: 192,
      receiptMessages: [candidate.receiptMessage],
      sourceAndConfirmationMessages: [
        candidate.sourceMessage,
        candidate.confirmationMessage,
      ],
      firstUseBindings: [],
      executions: [candidate.execution],
      nowMs: candidate.nowMs,
    };

    const page = buildPreparationActionReceiptPage(input);
    expect(page).toMatchObject({
      entries: [{
        receiptMessageId: RECEIPT,
        actionId: expectedAction.id,
        topicKey: "venue",
      }],
      nextBoundary: null,
      partial: false,
    });
    expect(buildPreparationActionReceiptPage({
      ...input,
      receiptMessages: [candidate.receiptMessage, candidate.receiptMessage],
    })).toMatchObject({ entries: [page!.entries[0]], partial: true });
    expect(buildPreparationActionReceiptPage({
      ...input,
      query: "신혼여행",
    })).toEqual({ entries: [], nextBoundary: null, partial: false });
  });

  it("projects one exact provider-backed application only after source, confirmation, and ledger validation", () => {
    const candidate = providerCandidate();

    expect(parsePreparationActionReceiptCandidate(candidate)).toEqual({
      receiptMessageId: RECEIPT,
      actionId: (candidate.execution.result.toolOutput.action as Record<string, unknown>).id,
      topicKey: "venue",
      title: "예식장 계약 조건 다시 확인",
      displayMessage: candidate.receiptMessage.content,
      appliedAt: candidate.receiptMessage.created_at,
      scope: "couple_shared",
      canOpenAction: true,
    });
  });

  it("projects one exact first-use application only with its immutable proposal binding", () => {
    const candidate = firstUseCandidate();
    const stored = candidate.sourceMessage.metadata.pending_amora_action;
    const addTool = BETA_SAFE_TOOLS.find((tool) => tool.name === "add_amora_action")!;
    expect(resolveAmoraPendingAction({
      value: stored,
      confirmedActionId: PENDING_ACTION,
      allowedTools: [{
        ...addTool,
        input_schema: {
          ...addTool.input_schema,
          "x-amora-bound-input": stored.input,
        },
      }],
      now: stored.expiresAt - 1,
    })).not.toBeNull();
    expect(parseAmoraFirstUseActionApplicationSource({
      sourceMessage: {
        id: candidate.sourceMessage.id,
        content: candidate.sourceMessage.content,
        metadata: candidate.sourceMessage.metadata,
        createdAt: candidate.sourceMessage.created_at,
      },
      confirmedActionId: PENDING_ACTION,
      availableTools: BETA_SAFE_TOOLS,
      expectedJourneyRevision: 4,
      expectedCriterionDecisionId: undefined,
      now: candidate.nowMs,
      allowExpired: true,
    })).not.toBeNull();
    expect(parsePreparationActionReceiptCandidate(candidate)).toEqual({
      receiptMessageId: RECEIPT,
      actionId: candidate.execution.result.toolOutput.action.id,
      topicKey: null,
      title: FIRST_USE_ACTION,
      displayMessage: candidate.receiptMessage.content,
      appliedAt: candidate.receiptMessage.created_at,
      scope: "couple_shared",
      canOpenAction: true,
    });

    candidate.firstUseBinding.promotion_id =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(parsePreparationActionReceiptCandidate(candidate)).toBeNull();
  });

  it("opts into a searchable v2 approved first action without exposing provenance ids", () => {
    const candidate = firstUseCandidate();
    const expectedEntry = {
      receiptMessageId: RECEIPT,
      actionId: candidate.execution.result.toolOutput.action.id,
      topicKey: null,
      title: FIRST_USE_ACTION,
      displayMessage: candidate.receiptMessage.content,
      appliedAt: candidate.receiptMessage.created_at,
      scope: "couple_shared",
      canOpenAction: true,
      approvedFirstAction: {
        action: FIRST_USE_ACTION,
        reason: FIRST_USE_REASON,
        completionCriterion: FIRST_USE_COMPLETION_CRITERION,
      },
    };

    for (const query of [FIRST_USE_REASON, FIRST_USE_COMPLETION_CRITERION]) {
      expect(buildPreparationActionReceiptPage(
        actionReceiptPageInput(candidate, query, 2),
      )).toEqual({
        entries: [expectedEntry],
        nextBoundary: null,
        partial: false,
      });
    }

    const serialized = JSON.stringify(buildPreparationActionReceiptPage(
      actionReceiptPageInput(candidate, "", 2),
    ));
    expect(serialized).not.toContain(SOURCE);
    expect(serialized).not.toContain(SOURCE_USER_MESSAGE);
    expect(serialized).not.toContain(PROMOTION);
    expect(serialized).not.toContain("sourceMessageId");
    expect(serialized).not.toContain("promotionId");
  });

  it("keeps every provider-backed description out of the v2 approved-first-action field", () => {
    for (const description of [
      "두 사람이 확인할 조건을 한 번 더 대조해요.",
      FIRST_USE_DESCRIPTION,
    ]) {
      const candidate = providerCandidate(description);

      expect(buildPreparationActionReceiptPage(
        actionReceiptPageInput(candidate, "", 2),
      )).toEqual({
        entries: [{
          receiptMessageId: RECEIPT,
          actionId: (candidate.execution.result.toolOutput.action as Record<string, unknown>).id,
          topicKey: "venue",
          title: "예식장 계약 조건 다시 확인",
          displayMessage: candidate.receiptMessage.content,
          appliedAt: candidate.receiptMessage.created_at,
          scope: "couple_shared",
          canOpenAction: true,
          approvedFirstAction: null,
        }],
        nextBoundary: null,
        partial: false,
      });
    }

    expect(buildPreparationActionReceiptPage(
      actionReceiptPageInput(providerCandidate(FIRST_USE_DESCRIPTION), FIRST_USE_REASON, 2),
    )).toEqual({ entries: [], nextBoundary: null, partial: false });
  });

  it("omits an ambiguous first-use canonical description and marks the v2 page partial", () => {
    const candidate = firstUseCandidate(
      "이유: 이유 안에 완료 기준: 표기가 있어 모호해요. 완료 기준: 실제 기준을 적으면 끝나요.",
    );

    expect(buildPreparationActionReceiptPage(
      actionReceiptPageInput(candidate, "", 2),
    )).toEqual({ entries: [], nextBoundary: null, partial: true });
  });

  it.each([
    ["private receipt", (value: ReturnType<typeof providerCandidate>) => {
      value.receiptMessage.visibility = "bride_private";
    }],
    ["wrong confirmation actor", (value: ReturnType<typeof providerCandidate>) => {
      value.confirmationMessage.sender_id = "99999999-9999-4999-8999-999999999999";
    }],
    ["unfinished tool execution", (value: ReturnType<typeof providerCandidate>) => {
      value.execution.status = "processing";
    }],
    ["tampered immutable action", (value: ReturnType<typeof providerCandidate>) => {
      const action = value.execution.result.toolOutput.action as Record<string, unknown>;
      action.title = "바뀐 제목";
    }],
  ])("rejects %s without a public record", (_label, mutate) => {
    const candidate = providerCandidate();
    mutate(candidate);
    expect(parsePreparationActionReceiptCandidate(candidate)).toBeNull();
  });
});
