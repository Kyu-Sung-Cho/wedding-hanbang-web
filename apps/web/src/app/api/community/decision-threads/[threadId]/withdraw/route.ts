import { createAdminClient } from "@/lib/supabase/admin";
import {
  cleanRequiredText,
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

const WITHDRAW_KEYS = ["expectedVersion", "reason"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 2_000,
      ratePrefix: "community-decision-withdraw",
      rateLimit: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      requireWriteAccess: false,
      operation: "decision_thread_withdraw",
    });
    if (!prepared.ok) return prepared.response;
    const { body } = prepared;
    const reason = cleanRequiredText(body.reason, 3, 500);
    if (
      !hasExactKeys(body, WITHDRAW_KEYS) ||
      !(
        body.expectedVersion === null ||
        (typeof body.expectedVersion === "number" &&
          Number.isSafeInteger(body.expectedVersion) &&
          body.expectedVersion > 0)
      ) ||
      !reason
    ) {
      return invalidDecisionBody();
    }

    const { data, error } = await createAdminClient().rpc(
      "community_withdraw_decision_thread",
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_expected_version: body.expectedVersion,
        p_reason: reason,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );
    if (error) return decisionRpcError(error);
    if (
      !isRpcObject(data) ||
      !isUuid(data.question_id) ||
      data.question_id !== threadId ||
      !isUuid(data.command_id) ||
      !isUuid(data.operation_key) ||
      data.operation_key !== prepared.idempotencyKey ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }
    if (data.status === "stale") {
      if (
        !isUuid(data.thread_id) ||
        data.thread_id !== threadId ||
        !isAllowed(data.state, DECISION_STATES) ||
        typeof data.current_version !== "number" ||
        !Number.isSafeInteger(data.current_version)
      ) {
        return stateUnconfirmedResponse();
      }
      return decisionJson(
        {
          status: "stale",
          questionId: data.question_id,
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
    if (data.status !== "withdrawn") return stateUnconfirmedResponse();
    const waitlistWithdrawal = data.thread_id === null;
    if (
      (!waitlistWithdrawal && !isUuid(data.thread_id)) ||
      (!waitlistWithdrawal && data.thread_id !== threadId) ||
      (waitlistWithdrawal
        ? data.state !== null ||
          data.version !== null ||
          data.source_unavailable_at !== null
        : !isAllowed(data.state, DECISION_STATES) ||
          typeof data.version !== "number" ||
          !Number.isSafeInteger(data.version) ||
          typeof data.source_unavailable_at !== "string")
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(
      {
        status: "withdrawn",
        questionId: data.question_id,
        threadId: data.thread_id,
        state: data.state,
        version: data.version,
        sourceUnavailableAt: data.source_unavailable_at,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      200,
    );
  } catch {
    console.error("COMMUNITY_DECISION_WITHDRAWAL_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "질문을 안전하게 철회하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
