import { NextResponse } from "next/server";
import {
  validateTodayOneCareV2OutcomeRequest,
  validateTodayOneCareV2OutcomeResponse,
} from "@hanbang/shared";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
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

function readOutcomeMode(request: Request): "scheduled_follow_up" | "explicit_action" | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "mode")) return null;
  const values = params.getAll("mode");
  if (values.length === 0) return "scheduled_follow_up";
  if (values.length === 1 && values[0] === "explicit_action") return "explicit_action";
  return null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Context = { userId: string; coupleId: string; privacyEpoch: number };

async function loadContext(request: Request): Promise<Context | NextResponse> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return response({ code: "TODAY_ONE_V2_AUTH_REQUIRED", error: "인증이 필요합니다." }, 401);
  }
  const actor = verifyMutationActorFence(request.headers, user.id, { allowLegacy: false });
  if (!actor.ok) return response({ code: actor.code, error: actor.message }, actor.status);
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("couple_id, role").eq("id", user.id).single();
  if (profileError || !isUuid(profile?.couple_id)) {
    return response({ code: "TODAY_ONE_V2_COUPLE_REQUIRED", error: "커플 연결을 확인해 주세요." }, 409);
  }
  const { data: couple, error: coupleError } = await supabase
    .from("couples").select("bride_id, groom_id").eq("id", profile.couple_id).single();
  const matches = (profile.role === "bride" && couple?.bride_id === user.id)
    || (profile.role === "groom" && couple?.groom_id === user.id);
  if (coupleError || !matches) {
    return response({ code: "TODAY_ONE_V2_ROSTER_CHANGED", error: "커플 연결 상태가 바뀌었어요." }, 409);
  }
  const { data: epoch, error } = await supabase.rpc("get_own_amora_privacy_epoch", {
    p_couple_id: profile.couple_id,
    p_visibility: "shared",
  });
  if (error || !Number.isSafeInteger(epoch) || epoch < 1) {
    return response({ code: "TODAY_ONE_V2_PRIVACY_UNAVAILABLE", error: "공유 범위를 확인하지 못했어요." }, 503);
  }
  return { userId: user.id, coupleId: profile.couple_id, privacyEpoch: epoch };
}

function rpcFailure(error: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }) {
  const text = [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string").join(" ");
  if (/function .*(?:amora_action_follow_up|amora_action_execution).*does not exist|PGRST202/i.test(text)) {
    return response({ code: "TODAY_ONE_V2_UNAVAILABLE" }, 404);
  }
  if (/CARD_NOT_FOUND/.test(text)) {
    return response({ code: "TODAY_ONE_V2_RECEIPT_NOT_FOUND", error: "후속 확인 기록을 찾지 못했어요." }, 404);
  }
  if (/IDEMPOTENCY_CONFLICT|23505/.test(text)) {
    return response({ code: "TODAY_ONE_V2_IDEMPOTENCY_CONFLICT", error: "이미 다른 선택으로 처리된 요청이에요." }, 409);
  }
  if (/STALE|RECIPIENT_FORBIDDEN|PREFERENCE_INACTIVE/.test(text)) {
    return response({ code: "TODAY_ONE_V2_CONTEXT_CHANGED", error: "계정이나 후속 확인 상태가 바뀌었어요." }, 409);
  }
  return response({ code: "TODAY_ONE_V2_WRITE_FAILED", error: "선택을 기록하지 못했어요." }, 503);
}

export async function POST(request: Request) {
  try {
    if (!isAmoraTodayOneEnabled()) return response({ code: "TODAY_ONE_V2_UNAVAILABLE" }, 404);
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "TODAY_ONE_V2_ORIGIN_REJECTED", error: "잘못된 요청 출처입니다." }, 403);
    }
    const outcomeMode = readOutcomeMode(request);
    if (outcomeMode === null) {
      return response({ code: "TODAY_ONE_V2_REQUEST_INVALID", error: "요청 형식이 올바르지 않아요." }, 400);
    }
    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-today-one-v2:outcome", request, context.userId),
      { maxRequests: 20, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }
    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) return response({ code: "TODAY_ONE_V2_REQUEST_INVALID", error: "요청 형식이 올바르지 않습니다." }, raw.reason === "too_large" ? 413 : 400);
    let body: unknown;
    try { body = JSON.parse(raw.text); } catch { body = null; }
    const validated = validateTodayOneCareV2OutcomeRequest(body);
    if (!validated.ok) {
      return response({ code: "TODAY_ONE_V2_REQUEST_INVALID", error: "선택 형식이 올바르지 않습니다." }, 400);
    }
    const value = validated.value;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      outcomeMode === "explicit_action"
        ? "record_amora_action_execution_outcome_v1"
        : "record_amora_action_follow_up_outcome_v2",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_privacy_epoch: context.privacyEpoch,
        p_card_id: value.cardId,
        p_expected_card_revision: value.cardRevision,
        p_expected_source_revision: value.sourceRevision,
        p_outcome: value.outcome,
        p_blocker_code: value.blockerCode ?? null,
        p_confirmed: value.confirmed === true,
        p_idempotency_key: value.idempotencyKey,
      },
    );
    if (error) return rpcFailure(error);
    const receipt = validateTodayOneCareV2OutcomeResponse(data, context.userId);
    if (!receipt.ok) return response({ code: "TODAY_ONE_V2_INVALID_RECEIPT", error: "저장 영수증을 확인하지 못했어요." }, 503);
    return response(receipt.value);
  } catch (error) {
    console.error("[today-one-v2] POST outcome failed", error);
    return response({ code: "TODAY_ONE_V2_WRITE_FAILED", error: "선택을 기록하지 못했어요." }, 503);
  }
}

export async function GET(request: Request) {
  try {
    if (!isAmoraTodayOneEnabled()) return response({ code: "TODAY_ONE_V2_UNAVAILABLE" }, 404);
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "TODAY_ONE_V2_ORIGIN_REJECTED", error: "잘못된 요청 출처입니다." }, 403);
    }
    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-today-one-v2:receipt", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }
    const params = new URL(request.url).searchParams;
    if (Array.from(params.keys()).some((key) => key !== "idempotencyKey")) {
      return response({ code: "TODAY_ONE_V2_REQUEST_INVALID", error: "허용되지 않은 조회 항목입니다." }, 400);
    }
    const key = params.get("idempotencyKey");
    if (!key || !isUuid(key)) {
      return response({ code: "TODAY_ONE_V2_REQUEST_INVALID", error: "영수증 키가 올바르지 않습니다." }, 400);
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("read_amora_action_follow_up_outcome_v2", {
      p_couple_id: context.coupleId,
      p_recipient_user_id: context.userId,
      p_expected_privacy_epoch: context.privacyEpoch,
      p_idempotency_key: key,
    });
    if (error) return rpcFailure(error);
    if (data === null) return response({ code: "TODAY_ONE_V2_RECEIPT_NOT_FOUND", error: "후속 확인 기록을 찾지 못했어요." }, 404);
    const receipt = validateTodayOneCareV2OutcomeResponse(data, context.userId);
    if (!receipt.ok) return response({ code: "TODAY_ONE_V2_INVALID_RECEIPT", error: "저장 영수증을 확인하지 못했어요." }, 503);
    return response(receipt.value);
  } catch (error) {
    console.error("[today-one-v2] GET receipt failed", error);
    return response({ code: "TODAY_ONE_V2_READ_FAILED", error: "저장 영수증을 불러오지 못했어요." }, 503);
  }
}
