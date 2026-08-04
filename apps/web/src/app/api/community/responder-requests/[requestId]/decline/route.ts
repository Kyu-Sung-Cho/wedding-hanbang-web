import { NextRequest } from "next/server";

import {
  isResponderAllowed,
  isResponderDecisionResult,
  preflightResponderCommand,
  prepareResponderMutation,
  readResponderJsonObject,
  RESPONDER_COMMERCIAL_RELATIONSHIPS,
  responderJson,
  responderRpcErrorResponse,
} from "@/lib/community/responderSupplyApi";
import { isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 1024;
const BODY_KEYS = new Set([
  "commercial_relationship",
  "has_conflict",
  "decline_reason_code",
]);
const DECLINE_REASONS = [
  "not_available",
  "not_my_experience",
  "conflict",
  "too_many_requests",
  "prefer_not_to_say",
] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const prepared = await prepareResponderMutation(request, {
      maxBodyBytes: MAX_BODY_BYTES,
      ratePrefix: "community:responder:request:decline",
      rateLimit: { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      // Declining must remain available after a suspension so a person can stop
      // additional burden or disclose a newly noticed conflict.
      requireWriteAccess: false,
    });
    if (!prepared.ok) return prepared.response;

    const { requestId } = await params;
    if (!isUuid(requestId)) {
      return responderJson(
        { code: "COMMUNITY_RESPONDER_TARGET_INVALID", error: "응답 요청 식별자가 올바르지 않아요." },
        400,
      );
    }

    const parsed = await readResponderJsonObject(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const relationship = parsed.body.commercial_relationship;
    const hasConflict = parsed.body.has_conflict;
    const declineReason = parsed.body.decline_reason_code;
    if (
      Object.keys(parsed.body).some((key) => !BODY_KEYS.has(key))
      || !isResponderAllowed(relationship, RESPONDER_COMMERCIAL_RELATIONSHIPS)
      || typeof hasConflict !== "boolean"
      || !isResponderAllowed(declineReason, DECLINE_REASONS)
      || ((declineReason === "conflict") !== hasConflict)
    ) {
      return responderJson(
        {
          code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
          error: "거절 이유와 이해관계 여부를 다시 확인해 주세요.",
        },
        400,
      );
    }

    const commandPayload = {
      request_id: requestId,
      decision: "decline",
      commercial_relationship: relationship,
      has_conflict: hasConflict,
      decline_reason_code: declineReason,
    };
    const replay = await preflightResponderCommand(
      prepared.userId,
      "respond_request",
      prepared.idempotencyKey,
      commandPayload,
    );
    if (!replay.ok) return replay.response;
    if (replay.kind === "receipt") {
      if (!isResponderDecisionResult(replay.receipt, requestId, "declined")) {
        return responderJson(
          { code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE", error: "저장된 거절 결과를 안전하게 확인하지 못했어요." },
          503,
          { "Retry-After": "30" },
        );
      }
      return responderJson(
        {
          request: {
            id: replay.receipt.request_id,
            status: replay.receipt.status,
            question_state: replay.receipt.question_state,
          },
        },
        200,
      );
    }

    const gateResponse = await prepared.enforceMutableGates();
    if (gateResponse) return gateResponse;

    const serviceClient = replay.serviceClient;
    const { data, error } = await serviceClient.rpc(
      "community_respond_responder_request",
      {
        p_responder_id: prepared.userId,
        p_request_id: requestId,
        p_decision: "decline",
        p_commercial_relationship: relationship,
        p_has_conflict: hasConflict,
        p_decline_reason_code: declineReason,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );
    if (error) return responderRpcErrorResponse(error);
    if (!isResponderDecisionResult(data, requestId, "declined")) {
      return responderJson(
        {
          code: "COMMUNITY_RESPONDER_RESPONSE_INVALID",
          error: "저장 결과를 안전하게 확인하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }

    return responderJson(
      {
        request: {
          id: data.request_id,
          status: data.status,
          question_state: data.question_state,
        },
      },
      200,
    );
  } catch {
    console.error("[community responder decline] unavailable");
    return responderJson(
      { code: "COMMUNITY_RESPONDER_UNAVAILABLE", error: "응답 요청을 잠시 처리할 수 없어요." },
      503,
      { "Retry-After": "30" },
    );
  }
}
