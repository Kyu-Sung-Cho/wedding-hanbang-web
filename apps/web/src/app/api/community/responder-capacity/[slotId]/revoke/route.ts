import { NextRequest } from "next/server";

import {
  isResponderAllowed,
  preflightResponderCommand,
  prepareResponderMutation,
  readResponderJsonObject,
  responderJson,
  responderRpcErrorResponse,
} from "@/lib/community/responderSupplyApi";
import { isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 512;
const BODY_KEYS = new Set(["reason_code"]);
const REVOCATION_REASONS = [
  "topic_opt_out",
  "temporary_unavailable",
  "too_many_requests",
  "prefer_not_to_say",
] as const;

function isRevocationResult(value: unknown, slotId: string): value is {
  slot_id: string;
  opt_in_status: "revoked";
  affected_request_id: string | null;
} {
  return isRecord(value)
    && value.slot_id === slotId
    && value.opt_in_status === "revoked"
    && (value.affected_request_id === null || isUuid(value.affected_request_id))
    && !Object.hasOwn(value, "replayed");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slotId: string }> },
) {
  try {
    const prepared = await prepareResponderMutation(request, {
      maxBodyBytes: MAX_BODY_BYTES,
      ratePrefix: "community:responder:capacity:revoke",
      rateLimit: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      // Consent withdrawal is a safety exit and stays available to suspended
      // members. The service RPC still verifies ownership from this actor ID.
      requireWriteAccess: false,
    });
    if (!prepared.ok) return prepared.response;

    const { slotId } = await params;
    if (!isUuid(slotId)) {
      return responderJson(
        { code: "COMMUNITY_RESPONDER_TARGET_INVALID", error: "응답 범위 식별자가 올바르지 않아요." },
        400,
      );
    }

    const parsed = await readResponderJsonObject(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const reasonCode = parsed.body.reason_code;
    if (
      Object.keys(parsed.body).some((key) => !BODY_KEYS.has(key))
      || !isResponderAllowed(reasonCode, REVOCATION_REASONS)
    ) {
      return responderJson(
        {
          code: "COMMUNITY_RESPONDER_REQUEST_INVALID",
          error: "응답 동의 철회 이유를 확인해 주세요.",
        },
        400,
      );
    }

    const replay = await preflightResponderCommand(
      prepared.userId,
      "revoke_capacity",
      prepared.idempotencyKey,
      { slot_id: slotId, reason_code: reasonCode },
    );
    if (!replay.ok) return replay.response;
    if (replay.kind === "receipt") {
      if (!isRevocationResult(replay.receipt, slotId)) {
        return responderJson(
          { code: "COMMUNITY_RESPONDER_RECEIPT_UNAVAILABLE", error: "저장된 철회 결과를 안전하게 확인하지 못했어요." },
          503,
          { "Retry-After": "30" },
        );
      }
      return responderJson(
        {
          slot: {
            id: replay.receipt.slot_id,
            status: replay.receipt.opt_in_status,
            affected_request_id: replay.receipt.affected_request_id,
          },
        },
        200,
      );
    }

    const gateResponse = await prepared.enforceMutableGates();
    if (gateResponse) return gateResponse;

    const serviceClient = replay.serviceClient;
    const { data, error } = await serviceClient.rpc(
      "community_revoke_responder_capacity_slot",
      {
        p_responder_id: prepared.userId,
        p_slot_id: slotId,
        p_reason_code: reasonCode,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );
    if (error) return responderRpcErrorResponse(error);
    if (!isRevocationResult(data, slotId)) {
      return responderJson(
        {
          code: "COMMUNITY_RESPONDER_RESPONSE_INVALID",
          error: "철회 결과를 안전하게 확인하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }

    return responderJson(
      {
        slot: {
          id: data.slot_id,
          status: data.opt_in_status,
          affected_request_id: data.affected_request_id,
        },
      },
      200,
    );
  } catch {
    console.error("[community responder revoke] unavailable");
    return responderJson(
      { code: "COMMUNITY_RESPONDER_UNAVAILABLE", error: "응답 동의를 잠시 철회할 수 없어요." },
      503,
      { "Retry-After": "30" },
    );
  }
}
