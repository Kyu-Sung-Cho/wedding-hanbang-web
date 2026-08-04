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
const BODY_KEYS = new Set(["commercial_relationship", "has_conflict"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const prepared = await prepareResponderMutation(request, {
      maxBodyBytes: MAX_BODY_BYTES,
      ratePrefix: "community:responder:request:accept",
      rateLimit: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      requireWriteAccess: true,
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
    if (
      Object.keys(parsed.body).some((key) => !BODY_KEYS.has(key))
      || !isResponderAllowed(
        parsed.body.commercial_relationship,
        RESPONDER_COMMERCIAL_RELATIONSHIPS,
      )
      || parsed.body.has_conflict !== false
    ) {
      return responderJson(
        {
          code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
          error: "이해관계와 충돌 여부를 다시 확인해 주세요.",
        },
        400,
      );
    }

    const commandPayload = {
      request_id: requestId,
      decision: "accept",
      commercial_relationship: parsed.body.commercial_relationship,
      has_conflict: false,
      decline_reason_code: null,
    };
    const replay = await preflightResponderCommand(
      prepared.userId,
      "respond_request",
      prepared.idempotencyKey,
      commandPayload,
    );
    if (!replay.ok) return replay.response;
    if (replay.kind === "receipt") {
      if (!isResponderDecisionResult(replay.receipt, requestId, "accepted")) {
        return responderJson(
          { code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE", error: "저장된 수락 결과를 안전하게 확인하지 못했어요." },
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
        p_decision: "accept",
        p_commercial_relationship: parsed.body.commercial_relationship,
        p_has_conflict: false,
        p_decline_reason_code: null,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );
    if (error) return responderRpcErrorResponse(error);
    if (!isResponderDecisionResult(data, requestId, "accepted")) {
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
    console.error("[community responder accept] unavailable");
    return responderJson(
      { code: "COMMUNITY_RESPONDER_UNAVAILABLE", error: "응답 요청을 잠시 처리할 수 없어요." },
      503,
      { "Retry-After": "30" },
    );
  }
}
