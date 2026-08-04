import { createAdminClient } from "@/lib/supabase/admin";
import {
  DECISION_APPLICABILITY,
  DECISION_STATES,
  decisionJson,
  decisionRpcError,
  hasExactKeys,
  invalidDecisionBody,
  isAllowed,
  isRpcObject,
  prepareDecisionMutation,
  stateUnconfirmedResponse,
} from "@/lib/community/decisionThreadApi";
import { isUuid } from "@/utils/requestValidation";

const APPLICABILITY_KEYS = [
  "expectedVersion",
  "answerId",
  "applicability",
] as const;

export async function PUT(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 1_500,
      ratePrefix: "community-decision-applicability",
      rateLimit: { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      operation: "decision_thread_applicability",
    });
    if (!prepared.ok) return prepared.response;
    const { body } = prepared;
    if (
      !hasExactKeys(body, APPLICABILITY_KEYS) ||
      typeof body.expectedVersion !== "number" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 1 ||
      !isUuid(body.answerId) ||
      !isAllowed(body.applicability, DECISION_APPLICABILITY)
    ) {
      return invalidDecisionBody();
    }

    const { data, error } = await createAdminClient().rpc(
      "community_set_decision_applicability",
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_expected_version: body.expectedVersion,
        p_answer_id: body.answerId,
        p_applicability: body.applicability,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );
    if (error) return decisionRpcError(error);
    if (
      !isRpcObject(data)
      || !isUuid(data.command_id)
      || !isUuid(data.operation_key)
      || data.operation_key !== prepared.idempotencyKey
    ) {
      return stateUnconfirmedResponse();
    }
    if (data.status === "stale") {
      if (
        !isUuid(data.thread_id) ||
        data.thread_id !== threadId ||
        !isAllowed(data.state, DECISION_STATES) ||
        typeof data.current_version !== "number" ||
        !Number.isSafeInteger(data.current_version) ||
        typeof data.replayed !== "boolean"
      ) {
        return stateUnconfirmedResponse();
      }
      return decisionJson(
        {
          status: "stale",
          threadId: data.thread_id,
          state: data.state,
          currentVersion: data.current_version,
          commandId: data.command_id,
          operationKey: data.operation_key,
          replayed: data.replayed,
        },
        409,
      );
    }
    if (
      data.status !== "applicability_recorded" ||
      !isUuid(data.thread_id) ||
      data.thread_id !== threadId ||
      !isAllowed(data.state, DECISION_STATES) ||
      typeof data.version !== "number" ||
      !Number.isSafeInteger(data.version) ||
      !isUuid(data.selection_id) ||
      !isUuid(data.answer_id) ||
      data.answer_id !== body.answerId ||
      !isAllowed(data.applicability, DECISION_APPLICABILITY) ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(
      {
        status: "applicability_recorded",
        threadId: data.thread_id,
        state: data.state,
        version: data.version,
        selectionId: data.selection_id,
        answerId: data.answer_id,
        applicability: data.applicability,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      200,
    );
  } catch {
    console.error("COMMUNITY_DECISION_APPLICABILITY_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "적용 여부를 안전하게 저장하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
