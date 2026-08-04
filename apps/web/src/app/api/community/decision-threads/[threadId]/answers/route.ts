import { createAdminClient } from "@/lib/supabase/admin";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import {
  cleanNullableText,
  cleanRequiredText,
  containsExactCalendarDate,
  DECISION_EXPERIENCE_PERIODS,
  DECISION_RELATIONSHIPS,
  DECISION_STAGES,
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

const ANSWER_KEYS = [
  "content",
  "responseKind",
  "directExperience",
  "experiencePeriod",
  "experienceStage",
  "coarseRegion",
  "actionTaken",
  "resultSummary",
  "nextCheck",
  "factOpinionBoundary",
  "commercialRelationship",
  "sponsorshipDetail",
] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) return invalidDecisionBody();
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 12_000,
      ratePrefix: "community-decision-answer",
      rateLimit: { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      operation: "decision_thread_answer",
    });
    if (!prepared.ok) return prepared.response;
    const { body } = prepared;
    if (!hasExactKeys(body, ANSWER_KEYS)) return invalidDecisionBody();

    const content = cleanRequiredText(body.content, 10, 5_000);
    const coarseRegion = cleanNullableText(body.coarseRegion, 2, 40);
    const actionTaken = cleanNullableText(body.actionTaken, 3, 2_000);
    const resultSummary = cleanNullableText(body.resultSummary, 3, 3_000);
    const nextCheck = cleanNullableText(body.nextCheck, 3, 2_000);
    const factOpinionBoundary = cleanRequiredText(
      body.factOpinionBoundary,
      3,
      500,
    );
    const sponsorshipDetail = cleanNullableText(
      body.sponsorshipDetail,
      3,
      500,
    );
    if (
      !content ||
      coarseRegion === undefined ||
      actionTaken === undefined ||
      resultSummary === undefined ||
      nextCheck === undefined ||
      (!actionTaken && !resultSummary && !nextCheck) ||
      !factOpinionBoundary ||
      !isAllowed(body.responseKind, ["answer", "experience"] as const) ||
      body.directExperience !== true ||
      !isAllowed(body.experiencePeriod, DECISION_EXPERIENCE_PERIODS) ||
      !isAllowed(body.experienceStage, DECISION_STAGES) ||
      !isAllowed(body.commercialRelationship, DECISION_RELATIONSHIPS) ||
      sponsorshipDetail === undefined ||
      (body.commercialRelationship === "none"
        ? sponsorshipDetail !== null
        : sponsorshipDetail === null)
    ) {
      return invalidDecisionBody();
    }

    const publicText = [
      content,
      coarseRegion,
      actionTaken,
      resultSummary,
      nextCheck,
      factOpinionBoundary,
      sponsorshipDetail,
    ].filter((value): value is string => value !== null);
    if (
      publicText.some(containsExactCalendarDate) ||
      findObviousPublicPersonalInfo(...publicText).length > 0
    ) {
      return invalidDecisionBody(PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE);
    }

    const { data, error } = await createAdminClient().rpc(
      "community_create_decision_answer",
      {
        p_actor_id: prepared.userId,
        p_thread_id: threadId,
        p_idempotency_key: prepared.idempotencyKey,
        p_content: content,
        p_response_kind: body.responseKind,
        p_direct_experience: true,
        p_experience_period: body.experiencePeriod,
        p_experience_stage: body.experienceStage,
        p_coarse_region: coarseRegion,
        p_action_taken: actionTaken,
        p_result_summary: resultSummary,
        p_next_check: nextCheck,
        p_fact_opinion_boundary: factOpinionBoundary,
        p_commercial_relationship: body.commercialRelationship,
        p_sponsorship_detail: sponsorshipDetail,
      },
    );
    if (error) return decisionRpcError(error);
    if (
      !isRpcObject(data) ||
      data.status !== "answered" ||
      !isUuid(data.answer_id) ||
      !isUuid(data.comment_id) ||
      !isUuid(data.thread_id) ||
      data.thread_id !== threadId ||
      !isAllowed(data.state, DECISION_STATES) ||
      typeof data.version !== "number" ||
      !Number.isSafeInteger(data.version) ||
      typeof data.qualified_peer_answer_count !== "number" ||
      !Number.isSafeInteger(data.qualified_peer_answer_count) ||
      typeof data.qualified_professional_answer_count !== "number" ||
      !Number.isSafeInteger(data.qualified_professional_answer_count) ||
      !isUuid(data.command_id) ||
      !isUuid(data.operation_key) ||
      data.operation_key !== prepared.idempotencyKey ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }

    return decisionJson(
      {
        status: "answered",
        answerId: data.answer_id,
        commentId: data.comment_id,
        threadId: data.thread_id,
        state: data.state,
        version: data.version,
        qualifiedPeerAnswerCount: data.qualified_peer_answer_count,
        qualifiedProfessionalAnswerCount:
          data.qualified_professional_answer_count,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      data.replayed ? 200 : 201,
    );
  } catch {
    console.error("COMMUNITY_DECISION_ANSWER_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "답변을 안전하게 저장하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
