import { createAdminClient } from "@/lib/supabase/admin";
import {
  decisionJson,
  decisionRpcError,
  hasExactKeys,
  isRpcObject,
  prepareDecisionMutation,
  stateUnconfirmedResponse,
} from "@/lib/community/decisionThreadApi";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

const PUBLICATION_STATES = [
  "pending_review",
  "published",
  "rejected",
  "withdrawn",
] as const;

export async function GET(
  request: Request,
  context: {
    params: Promise<{ threadId: string; outcomeId: string }>;
  },
) {
  try {
    const { threadId, outcomeId } = await context.params;
    if (!isUuid(threadId) || !isUuid(outcomeId)) {
      return decisionJson(
        { code: "COMMUNITY_DECISION_INVALID", error: "결과를 확인해 주세요." },
        422,
      );
    }
    const authClient = await createClientFromRequest(request);
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user || !isUuid(user.id)) {
      return decisionJson(
        { code: "COMMUNITY_AUTH_REQUIRED", error: "로그인이 필요해요." },
        401,
      );
    }
    const { data, error } = await createAdminClient().rpc(
      "community_get_decision_outcome_publication_state" as never,
      {
        p_actor_id: user.id,
        p_thread_id: threadId,
        p_outcome_id: outcomeId,
      } as never,
    );
    if (error) return decisionRpcError(error);
    if (data === null) {
      return decisionJson(
        { code: "COMMUNITY_DECISION_NOT_FOUND", error: "결과를 찾을 수 없어요." },
        404,
      );
    }
    if (
      !isRpcObject(data)
      || !hasExactKeys(data, [
        "outcomeId",
        "threadId",
        "revision",
        "publicationState",
        "canWithdraw",
        "updatedAt",
      ])
      || data.outcomeId !== outcomeId
      || data.threadId !== threadId
      || !Number.isSafeInteger(data.revision)
      || (data.revision as number) < 1
      || !PUBLICATION_STATES.includes(
        data.publicationState as (typeof PUBLICATION_STATES)[number],
      )
      || typeof data.canWithdraw !== "boolean"
      || data.canWithdraw !== ["pending_review", "published"].includes(
        data.publicationState as string,
      )
      || !isIsoDate(data.updatedAt)
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(data, 200);
  } catch {
    console.error("COMMUNITY_DECISION_OUTCOME_PUBLICATION_STATE_READ_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_READ_FAILED",
        error: "공개 검수 상태를 불러오지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ threadId: string; outcomeId: string }>;
  },
) {
  try {
    const { threadId, outcomeId } = await context.params;
    if (!isUuid(threadId) || !isUuid(outcomeId)) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_INVALID",
          error: "공개 동의를 철회할 결과를 확인해 주세요.",
        },
        422,
      );
    }

    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 32,
      ratePrefix: "community-decision-publication-withdraw",
      rateLimit: { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      // Consent withdrawal must remain available during suspension and every
      // community runtime mode. Ownership is enforced atomically in the RPC.
      requireWriteAccess: false,
      publicationReplay: {
        operation: "author_withdraw",
        outcomeId,
        payload: {
          threadId,
          outcomeId,
          reason: "consent_withdrawn",
        },
        expectedBodyKeys: [],
      },
    });
    if (!prepared.ok) return prepared.response;
    if (!hasExactKeys(prepared.body, [])) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_INVALID",
          error: "공개 동의 철회 요청을 확인해 주세요.",
        },
        422,
      );
    }

    const { data, error } = await createAdminClient().rpc(
      "community_withdraw_decision_outcome_publication" as never,
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_outcome_id: outcomeId,
        p_operation_key: prepared.idempotencyKey,
      } as never,
    );
    if (error) return decisionRpcError(error);
    if (
      !isRpcObject(data)
      || !hasExactKeys(data, [
        "receiptVersion",
        "operationKey",
        "outcomeId",
        "threadId",
        "revision",
        "publicationState",
        "withdrawnAt",
        "replayed",
      ])
      || data.receiptVersion !== 1
      || data.operationKey !== prepared.idempotencyKey
      || data.outcomeId !== outcomeId
      || data.threadId !== threadId
      || !Number.isSafeInteger(data.revision)
      || (data.revision as number) < 1
      || data.publicationState !== "withdrawn"
      || !isIsoDate(data.withdrawnAt)
      || typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }

    return decisionJson(
      {
        status: "withdrawn",
        threadId,
        outcomeId,
        operationKey: prepared.idempotencyKey,
        revision: data.revision,
        withdrawnAt: data.withdrawnAt,
        replayed: data.replayed,
      },
      200,
    );
  } catch {
    console.error("COMMUNITY_DECISION_OUTCOME_PUBLICATION_WITHDRAWAL_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "공개 동의를 안전하게 철회하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
