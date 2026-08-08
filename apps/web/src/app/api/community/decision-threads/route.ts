import {
  parseCommunityDecisionFeed,
  type CommunityDecisionFeedMode,
} from "@hanbang/shared/community-decision-feed";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  findObviousPublicPersonalInfo,
  PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE,
} from "@/lib/community/publicPersonalInfo";
import {
  cleanNullableText,
  cleanRequiredText,
  containsExactCalendarDate,
  DECISION_CONTRACT_PHASES,
  DECISION_EXPERIENCE_SCOPES,
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
import {
  hasPresentedAuthCredential,
  isUuid,
} from "@/utils/requestValidation";

const CREATE_KEYS = [
  "questionId",
  "title",
  "content",
  "topicCategory",
  "experienceScope",
  "coarseRegion",
  "preparationStage",
  "contractPhase",
  "desiredAnswer",
  "commercialRelationship",
  "sponsorshipDetail",
] as const;

const FEED_MODES = ["for_you", "needs_help", "outcomes"] as const;
const FEED_QUERY_KEYS = new Set(["mode", "limit", "cursorAt", "cursorId"]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    if (
      [...params.keys()].some((key) => !FEED_QUERY_KEYS.has(key))
      || [...FEED_QUERY_KEYS].some((key) => params.getAll(key).length > 1)
    ) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_FEED_INVALID",
          error: "결정 질문 목록 조건을 확인해 주세요.",
        },
        400,
      );
    }

    const rawMode = params.get("mode") ?? "for_you";
    if (!isAllowed(rawMode, FEED_MODES)) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_FEED_INVALID",
          error: "결정 질문 목록 종류를 확인해 주세요.",
        },
        400,
      );
    }
    const mode: CommunityDecisionFeedMode = rawMode;

    const rawLimit = params.get("limit") ?? "10";
    if (!/^[0-9]+$/u.test(rawLimit)) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_FEED_INVALID",
          error: "한 번에 불러올 질문 수를 확인해 주세요.",
        },
        400,
      );
    }
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_FEED_INVALID",
          error: "한 번에 1개에서 20개까지 확인할 수 있어요.",
        },
        400,
      );
    }

    const rawCursorAt = params.get("cursorAt");
    const rawCursorId = params.get("cursorId");
    if ((rawCursorAt === null) !== (rawCursorId === null)) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_FEED_INVALID",
          error: "다음 질문 위치를 확인해 주세요.",
        },
        400,
      );
    }
    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (rawCursorAt !== null && rawCursorId !== null) {
      const timestamp = Date.parse(rawCursorAt);
      if (!Number.isFinite(timestamp) || !isUuid(rawCursorId)) {
        return decisionJson(
          {
            code: "COMMUNITY_DECISION_FEED_INVALID",
            error: "다음 질문 위치를 확인해 주세요.",
          },
          400,
        );
      }
      cursorAt = new Date(timestamp).toISOString();
      cursorId = rawCursorId;
    }

    const authClient = await createClientFromRequest(request);
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const viewerId = authData.user?.id ?? null;
    if (
      (authError && hasPresentedAuthCredential(request))
      || (viewerId !== null && !isUuid(viewerId))
      || (mode === "needs_help" && viewerId === null)
    ) {
      return decisionJson(
        {
          code: "COMMUNITY_AUTH_REQUIRED",
          error: "내 경험이 필요한 질문은 로그인 후 확인할 수 있어요.",
        },
        401,
      );
    }

    const { data, error } = await createAdminClient().rpc(
      "community_list_decision_threads" as never,
      {
        p_viewer_id: viewerId,
        p_mode: mode,
        p_cursor_at: cursorAt,
        p_cursor_id: cursorId,
        p_limit: limit,
      } as never,
    );
    if (error) return decisionRpcError(error);
    const feed = parseCommunityDecisionFeed(data, mode);
    if (!feed) return stateUnconfirmedResponse();
    return decisionJson(feed, 200);
  } catch {
    console.error("COMMUNITY_DECISION_FEED_READ_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_READ_FAILED",
        error: "결정 질문을 불러오지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}

export async function POST(request: Request) {
  try {
    const prepared = await prepareDecisionMutation(request, {
      maxBodyBytes: 12_000,
      ratePrefix: "community-decision-publish",
      rateLimit: { maxRequests: 8, windowMs: 60 * 60 * 1000 },
      operation: "decision_thread_publish",
    });
    if (!prepared.ok) return prepared.response;

    const { body } = prepared;
    if (!hasExactKeys(body, CREATE_KEYS) || !isUuid(body.questionId)) {
      return invalidDecisionBody();
    }

    const title = cleanRequiredText(body.title, 8, 160);
    const content = cleanRequiredText(body.content, 20, 5_000);
    const coarseRegion = cleanNullableText(body.coarseRegion, 2, 40);
    const desiredAnswer = cleanRequiredText(body.desiredAnswer, 5, 300);
    const sponsorshipDetail = cleanNullableText(
      body.sponsorshipDetail,
      3,
      500,
    );
    if (
      !title ||
      !content ||
      coarseRegion === undefined ||
      !desiredAnswer ||
      sponsorshipDetail === undefined ||
      body.topicCategory !== "contract_extra_cost" ||
      !isAllowed(body.experienceScope, DECISION_EXPERIENCE_SCOPES) ||
      !isAllowed(body.preparationStage, DECISION_STAGES) ||
      !isAllowed(body.contractPhase, DECISION_CONTRACT_PHASES) ||
      !isAllowed(body.commercialRelationship, DECISION_RELATIONSHIPS) ||
      (body.commercialRelationship === "none"
        ? sponsorshipDetail !== null
        : sponsorshipDetail === null)
    ) {
      return invalidDecisionBody();
    }

    const publicText = [
      title,
      content,
      coarseRegion,
      desiredAnswer,
      sponsorshipDetail,
    ].filter((value): value is string => value !== null);
    if (
      publicText.some(containsExactCalendarDate) ||
      findObviousPublicPersonalInfo(...publicText).length > 0
    ) {
      return invalidDecisionBody(PUBLIC_PERSONAL_INFO_BLOCK_MESSAGE);
    }

    const { data, error } = await createAdminClient().rpc(
      "community_publish_decision_thread",
      {
        p_actor_id: prepared.userId,
        p_idempotency_key: prepared.idempotencyKey,
        p_question_id: body.questionId,
        p_title: title,
        p_content: content,
        p_topic_category: body.topicCategory,
        p_experience_scope: body.experienceScope,
        p_coarse_region: coarseRegion,
        p_preparation_stage: body.preparationStage,
        p_contract_phase: body.contractPhase,
        p_desired_answer: desiredAnswer,
        p_commercial_relationship: body.commercialRelationship,
        p_sponsorship_detail: sponsorshipDetail,
      },
    );
    if (error) return decisionRpcError(error);
    if (!isRpcObject(data) || typeof data.status !== "string") {
      return stateUnconfirmedResponse();
    }

    if (data.status === "private_waitlist") {
      if (
        !isUuid(data.question_id) ||
        data.question_id !== body.questionId ||
        !isUuid(data.command_id) ||
        !isUuid(data.operation_key) ||
        data.operation_key !== prepared.idempotencyKey ||
        typeof data.replayed !== "boolean"
      ) {
        return stateUnconfirmedResponse();
      }
      return decisionJson(
        {
          status: "private_waitlist",
          questionId: data.question_id,
          commandId: data.command_id,
          operationKey: data.operation_key,
          replayed: data.replayed,
        },
        202,
        { "Retry-After": "300" },
      );
    }

    if (
      data.status !== "published" ||
      !isUuid(data.question_id) ||
      data.question_id !== body.questionId ||
      !isUuid(data.thread_id) ||
      data.thread_id !== body.questionId ||
      !isUuid(data.post_id) ||
      data.publication_version !== 1 ||
      !isAllowed(data.current_state, DECISION_STATES) ||
      !Number.isSafeInteger(data.current_version) ||
      !isUuid(data.command_id) ||
      !isUuid(data.operation_key) ||
      data.operation_key !== prepared.idempotencyKey ||
      typeof data.replayed !== "boolean"
    ) {
      return stateUnconfirmedResponse();
    }

    return decisionJson(
      {
        status: "published",
        questionId: data.question_id,
        threadId: data.thread_id,
        postId: data.post_id,
        publicationVersion: data.publication_version,
        currentState: data.current_state,
        currentVersion: data.current_version,
        commandId: data.command_id,
        operationKey: data.operation_key,
        replayed: data.replayed,
      },
      data.replayed ? 200 : 201,
    );
  } catch {
    console.error("COMMUNITY_DECISION_PUBLICATION_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_SAVE_FAILED",
        error: "질문을 안전하게 저장하지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
