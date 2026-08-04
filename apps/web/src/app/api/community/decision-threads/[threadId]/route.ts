import { createAdminClient } from "@/lib/supabase/admin";
import {
  decisionJson,
  decisionRpcError,
  hasExactKeys,
  isRpcObject,
  stateUnconfirmedResponse,
} from "@/lib/community/decisionThreadApi";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  hasPresentedAuthCredential,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";

const WAITLIST_KEYS = [
  "status",
  "intake",
  "thread",
  "post",
  "answers",
  "viewer",
] as const;
const PUBLISHED_KEYS = ["thread", "post", "answers", "viewer"] as const;
const FORBIDDEN_KEYS = new Set([
  "author_id",
  "authorId",
  "responder_id",
  "responderId",
  "responder_request_id",
  "responderRequestId",
  "requester_id",
  "requesterId",
  "created_by_operator",
  "createdByOperator",
  "operatorId",
  "actorId",
  "payload_hash",
  "payloadHash",
  "couple_id",
  "coupleId",
  "wedding_date",
  "weddingDate",
  "exact_address",
  "exactAddress",
  "private_budget",
  "privateBudget",
]);

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenField(child),
  );
}

function isSafeReadProjection(value: unknown): value is Record<string, unknown> {
  if (!isRpcObject(value) || containsForbiddenField(value)) return false;
  if (value.status === "private_waitlist") {
    return (
      hasExactKeys(value, WAITLIST_KEYS) &&
      isRecord(value.intake) &&
      value.thread === null &&
      value.post === null &&
      Array.isArray(value.answers) &&
      value.answers.length === 0 &&
      isRecord(value.viewer) &&
      value.viewer.isAuthor === true &&
      value.viewer.canWithdraw === true
    );
  }
  return (
    hasExactKeys(value, PUBLISHED_KEYS) &&
    isRecord(value.thread) &&
    isUuid(value.thread.id) &&
    (value.post === null || isRecord(value.post)) &&
    Array.isArray(value.answers) &&
    isRecord(value.viewer) &&
    Array.isArray(value.viewer.selection) &&
    Array.isArray(value.viewer.outcomes)
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    if (!isUuid(threadId)) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_NOT_FOUND",
          error: "결정 질문을 찾을 수 없어요.",
        },
        404,
      );
    }

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
      "community_get_decision_thread",
      { p_thread_id: threadId, p_viewer_id: viewerId },
    );
    if (error) return decisionRpcError(error);
    if (data === null) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_NOT_FOUND",
          error: "결정 질문을 찾을 수 없어요.",
        },
        404,
      );
    }
    if (!isSafeReadProjection(data)) return stateUnconfirmedResponse();
    if (
      (data.status === "private_waitlist" &&
        (!isRecord(data.intake) || data.intake.questionId !== threadId)) ||
      (data.status !== "private_waitlist" &&
        (!isRecord(data.thread) || data.thread.id !== threadId))
    ) {
      return stateUnconfirmedResponse();
    }
    return decisionJson(data, 200);
  } catch {
    console.error("COMMUNITY_DECISION_THREAD_READ_FAILED");
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
