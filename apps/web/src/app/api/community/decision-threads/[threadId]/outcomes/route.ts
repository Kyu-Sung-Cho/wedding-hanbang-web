import { createAdminClient } from "@/lib/supabase/admin";
import { parseCommunityDecisionPublicOutcome } from "@hanbang/shared/community-decision-feed";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import {
  cleanNullableText,
  cleanRequiredText,
  containsExactCalendarDate,
  DECISION_RELATIONSHIPS,
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
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  hasPresentedAuthCredential,
  isUuid,
} from "@/utils/requestValidation";

const OUTCOME_KEYS = [
  "expectedVersion",
  "currentOutcomeId",
  "actionTaken",
  "resultSummary",
  "applicableConditions",
  "publicConsent",
  "commercialRelationship",
  "sponsorshipDetail",
] as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError && hasPresentedAuthCredential(request)) {
      return decisionJson(
        { code: "COMMUNITY_AUTH_REQUIRED", error: "로그인이 필요해요." },
        401,
      );
    }
    const viewerId = user && isUuid(user.id) ? user.id : null;
    const { data, error } = await createAdminClient().rpc(
      "community_get_decision_public_outcome",
      { p_thread_id: threadId, p_viewer_id: viewerId },
    );
    if (error) return decisionRpcError(error);
    const parsed = parseCommunityDecisionPublicOutcome({ outcome: data });
    if (!parsed) return stateUnconfirmedResponse();
    return decisionJson(parsed, 200);
  } catch {
    console.error("COMMUNITY_DECISION_PUBLIC_OUTCOME_READ_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_READ_FAILED",
        error: "공개된 결과를 불러오지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 10_000,
      ratePrefix: "community-decision-outcome",
      rateLimit: { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      operation: "decision_thread_outcome",
    });
    if (!prepared.ok) return prepared.response;
    const { body } = prepared;
    const actionTaken = cleanRequiredText(body.actionTaken, 3, 2_000);
    const resultSummary = cleanRequiredText(body.resultSummary, 3, 3_000);
    const applicableConditions = cleanRequiredText(
      body.applicableConditions,
      3,
      2_000,
    );
    const sponsorshipDetail = cleanNullableText(
      body.sponsorshipDetail,
      3,
      500,
    );
    if (
      !hasExactKeys(body, OUTCOME_KEYS) ||
      typeof body.expectedVersion !== "number" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 1 ||
      !(
        body.currentOutcomeId === null || isUuid(body.currentOutcomeId)
      ) ||
      !actionTaken ||
      !resultSummary ||
      !applicableConditions ||
      typeof body.publicConsent !== "boolean" ||
      !isAllowed(body.commercialRelationship, DECISION_RELATIONSHIPS) ||
      sponsorshipDetail === undefined ||
      (body.commercialRelationship === "none"
        ? sponsorshipDetail !== null
        : sponsorshipDetail === null)
    ) {
      return invalidDecisionBody();
    }
    const publicText = [
      actionTaken,
      resultSummary,
      applicableConditions,
      sponsorshipDetail,
    ].filter((value): value is string => value !== null);
    if (
      publicText.some(containsExactCalendarDate) ||
      findObviousPublicPersonalInfo(...publicText).length > 0
    ) {
      return invalidDecisionBody(PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE);
    }

    const { data, error } = await createAdminClient().rpc(
      "community_record_decision_outcome",
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_expected_version: body.expectedVersion,
        p_current_outcome_id: body.currentOutcomeId,
        p_action_taken: actionTaken,
        p_result_summary: resultSummary,
        p_applicable_conditions: applicableConditions,
        p_public_consent: body.publicConsent,
        p_commercial_relationship: body.commercialRelationship,
        p_sponsorship_detail: sponsorshipDetail,
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
      data.status !== "completed" ||
      !isUuid(data.thread_id) ||
      data.thread_id !== threadId ||
      data.state !== "completed" ||
      typeof data.version !== "number" ||
      !Number.isSafeInteger(data.version) ||
      !isUuid(data.outcome_id) ||
      typeof data.revision !== "number" ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 1 ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(
      {
        status: "completed",
        threadId: data.thread_id,
        state: data.state,
        version: data.version,
        outcomeId: data.outcome_id,
        revision: data.revision,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      200,
    );
  } catch {
    console.error("COMMUNITY_DECISION_OUTCOME_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "결과를 안전하게 저장하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
