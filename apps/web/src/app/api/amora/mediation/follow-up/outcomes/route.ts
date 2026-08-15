import { NextResponse } from "next/server";
import {
  validateMediationOutcomeFollowUpReceiptResponse,
  validateMediationOutcomeFollowUpRequest,
} from "@hanbang/shared";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { isAmoraMediationOutcomeFollowUpEnabled } from "@/lib/features/amoraCareFlags";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const MAX_BODY_BYTES = 2 * 1024;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Context = { userId: string; coupleId: string; privacyEpoch: number };

async function loadContext(request: Request): Promise<Context | NextResponse> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return response({ code: "MEDIATION_FOLLOW_UP_AUTH_REQUIRED", error: "인증이 필요합니다." }, 401);
  }
  const actor = verifyMutationActorFence(request.headers, user.id, { allowLegacy: false });
  if (!actor.ok) return response({ code: actor.code, error: actor.message }, actor.status);
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("couple_id, role").eq("id", user.id).single();
  if (profileError || !isUuid(profile?.couple_id)) {
    return response({ code: "MEDIATION_FOLLOW_UP_COUPLE_REQUIRED", error: "커플 연결을 확인해 주세요." }, 409);
  }
  const { data: couple, error: coupleError } = await supabase
    .from("couples").select("bride_id, groom_id").eq("id", profile.couple_id).single();
  const matches = (profile.role === "bride" && couple?.bride_id === user.id)
    || (profile.role === "groom" && couple?.groom_id === user.id);
  if (
    coupleError
    || !matches
    || !isUuid(couple?.bride_id)
    || !isUuid(couple.groom_id)
    || couple.bride_id === couple.groom_id
  ) {
    return response({ code: "MEDIATION_FOLLOW_UP_ROSTER_CHANGED", error: "커플 연결 상태가 바뀌었어요." }, 409);
  }
  const { data: epoch, error: epochError } = await supabase.rpc(
    "get_own_amora_privacy_epoch",
    { p_couple_id: profile.couple_id, p_visibility: "shared" },
  );
  if (epochError || !Number.isSafeInteger(epoch) || epoch < 1) {
    return response({ code: "MEDIATION_FOLLOW_UP_PRIVACY_UNAVAILABLE", error: "공유 범위를 확인하지 못했어요." }, 503);
  }
  return { userId: user.id, coupleId: profile.couple_id, privacyEpoch: epoch };
}

function rpcFailure(error: {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}) {
  const errorText = [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (/does not exist|PGRST202/iu.test(errorText)) {
    return response({ code: "MEDIATION_FOLLOW_UP_UNAVAILABLE" }, 404);
  }
  if (/CARD_NOT_FOUND/u.test(errorText)) {
    return response({ code: "MEDIATION_FOLLOW_UP_RECEIPT_NOT_FOUND", error: "후속 확인 기록을 찾지 못했어요." }, 404);
  }
  if (/IDEMPOTENCY_CONFLICT|23505/u.test(errorText)) {
    return response({ code: "MEDIATION_FOLLOW_UP_IDEMPOTENCY_CONFLICT", error: "이미 다른 선택으로 처리된 요청이에요." }, 409);
  }
  if (/STALE|RECIPIENT_FORBIDDEN/u.test(errorText)) {
    return response({ code: "MEDIATION_FOLLOW_UP_CONTEXT_CHANGED", error: "계정이나 안전 상태가 바뀌었어요." }, 409);
  }
  return response({ code: "MEDIATION_FOLLOW_UP_WRITE_FAILED", error: "선택을 기록하지 못했어요." }, 503);
}

export async function POST(request: Request) {
  try {
    if (!isAmoraMediationOutcomeFollowUpEnabled()) {
      return response({ code: "MEDIATION_FOLLOW_UP_UNAVAILABLE" }, 404);
    }
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "MEDIATION_FOLLOW_UP_ORIGIN_REJECTED", error: "잘못된 요청 출처입니다." }, 403);
    }
    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-mediation-follow-up:outcome", request, context.userId),
      { maxRequests: 20, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }
    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response(
        { code: "MEDIATION_FOLLOW_UP_REQUEST_INVALID", error: "요청 형식이 올바르지 않습니다." },
        raw.reason === "too_large" ? 413 : 400,
      );
    }
    let body: unknown;
    try { body = JSON.parse(raw.text); } catch { body = null; }
    const validated = validateMediationOutcomeFollowUpRequest(body);
    if (!validated.ok) {
      return response({ code: "MEDIATION_FOLLOW_UP_REQUEST_INVALID", error: "선택 형식이 올바르지 않습니다." }, 400);
    }
    const value = validated.value;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_amora_mediation_outcome_follow_up", {
      p_couple_id: context.coupleId,
      p_recipient_user_id: context.userId,
      p_expected_privacy_epoch: context.privacyEpoch,
      p_card_id: value.cardId,
      p_expected_card_revision: value.cardRevision,
      p_expected_source_digest: value.sourceDigest,
      p_outcome: value.outcome,
      p_idempotency_key: value.idempotencyKey,
    });
    if (error) return rpcFailure(error);
    const receipt = validateMediationOutcomeFollowUpReceiptResponse(
      data,
      context.userId,
      context.coupleId,
    );
    if (!receipt.ok) {
      return response({ code: "MEDIATION_FOLLOW_UP_INVALID_RECEIPT", error: "저장 영수증을 확인하지 못했어요." }, 503);
    }
    return response(receipt.value);
  } catch (error) {
    console.error("[mediation-follow-up] POST outcome failed", error);
    return response({ code: "MEDIATION_FOLLOW_UP_WRITE_FAILED", error: "선택을 기록하지 못했어요." }, 503);
  }
}

export async function GET(request: Request) {
  try {
    if (!isAmoraMediationOutcomeFollowUpEnabled()) {
      return response({ code: "MEDIATION_FOLLOW_UP_UNAVAILABLE" }, 404);
    }
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "MEDIATION_FOLLOW_UP_ORIGIN_REJECTED", error: "잘못된 요청 출처입니다." }, 403);
    }
    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-mediation-follow-up:receipt", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }
    const params = new URL(request.url).searchParams;
    if (Array.from(params.keys()).some((key) => key !== "idempotencyKey")) {
      return response({ code: "MEDIATION_FOLLOW_UP_REQUEST_INVALID", error: "허용되지 않은 조회 항목입니다." }, 400);
    }
    const idempotencyKey = params.get("idempotencyKey");
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      return response({ code: "MEDIATION_FOLLOW_UP_REQUEST_INVALID", error: "영수증 키가 올바르지 않습니다." }, 400);
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "read_amora_mediation_outcome_follow_up_receipt",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_privacy_epoch: context.privacyEpoch,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (error) return rpcFailure(error);
    if (data === null) {
      return response({ code: "MEDIATION_FOLLOW_UP_RECEIPT_NOT_FOUND", error: "후속 확인 기록을 찾지 못했어요." }, 404);
    }
    const receipt = validateMediationOutcomeFollowUpReceiptResponse(
      data,
      context.userId,
      context.coupleId,
    );
    if (!receipt.ok) {
      return response({ code: "MEDIATION_FOLLOW_UP_INVALID_RECEIPT", error: "저장 영수증을 확인하지 못했어요." }, 503);
    }
    return response(receipt.value);
  } catch (error) {
    console.error("[mediation-follow-up] GET receipt failed", error);
    return response({ code: "MEDIATION_FOLLOW_UP_READ_FAILED", error: "저장 영수증을 불러오지 못했어요." }, 503);
  }
}
