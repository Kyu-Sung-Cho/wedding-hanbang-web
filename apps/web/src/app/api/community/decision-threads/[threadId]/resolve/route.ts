import { createAdminClient } from "@/lib/supabase/admin";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import {
  cleanRequiredText,
  containsExactCalendarDate,
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

const RESOLVE_KEYS = [
  "expectedVersion",
  "answerIds",
  "nextAction",
  "reason",
] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 6_000,
      ratePrefix: "community-decision-resolve",
      rateLimit: { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      operation: "decision_thread_resolve",
    });
    if (!prepared.ok) return prepared.response;
    const { body } = prepared;
    const answerIds = Array.isArray(body.answerIds) ? body.answerIds : [];
    const nextAction = cleanRequiredText(body.nextAction, 3, 1_000);
    const reason = cleanRequiredText(body.reason, 3, 500);
    if (
      !hasExactKeys(body, RESOLVE_KEYS) ||
      typeof body.expectedVersion !== "number" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 1 ||
      answerIds.length < 1 ||
      answerIds.length > 10 ||
      !answerIds.every(isUuid) ||
      new Set(answerIds).size !== answerIds.length ||
      !nextAction ||
      !reason
    ) {
      return invalidDecisionBody();
    }
    if (
      [nextAction, reason].some(containsExactCalendarDate) ||
      findObviousPublicPersonalInfo(nextAction, reason).length > 0
    ) {
      return invalidDecisionBody(PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE);
    }

    const { data, error } = await createAdminClient().rpc(
      "community_finalize_decision_thread_resolution",
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_expected_version: body.expectedVersion,
        p_answer_ids: answerIds,
        p_next_action: nextAction,
        p_reason: reason,
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
      data.status !== "resolved" ||
      !isUuid(data.thread_id) ||
      data.thread_id !== threadId ||
      data.state !== "resolved" ||
      typeof data.version !== "number" ||
      !Number.isSafeInteger(data.version) ||
      typeof data.next_action !== "string" ||
      !Array.isArray(data.answer_ids) ||
      !data.answer_ids.every(isUuid) ||
      data.answer_ids.length !== answerIds.length ||
      !data.answer_ids.every((answerId) => answerIds.includes(answerId)) ||
      !Array.isArray(data.selection_ids) ||
      !data.selection_ids.every(isUuid) ||
      data.answer_ids.length !== data.selection_ids.length ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(
      {
        status: "resolved",
        threadId: data.thread_id,
        state: data.state,
        version: data.version,
        nextAction: data.next_action,
        answerIds: data.answer_ids,
        selectionIds: data.selection_ids,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      200,
    );
  } catch {
    console.error("COMMUNITY_DECISION_RESOLUTION_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "결정을 안전하게 저장하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
