import { NextResponse } from "next/server";
import {
  validateTodayOneCareV2Response,
  type TodayOneCareV2Response,
} from "@hanbang/shared";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

const EXPLICIT_ACTION_ID_RE = /^[0-9A-Za-z_-]{1,200}$/;

function readExplicitActionId(request: Request): string | null | undefined {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "actionId")) return undefined;
  const values = params.getAll("actionId");
  if (values.length === 0) return null;
  if (values.length !== 1 || !EXPLICIT_ACTION_ID_RE.test(values[0] ?? "")) return undefined;
  return values[0];
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
  if (!actor.ok) {
    return response({ code: actor.code, error: actor.message }, actor.status);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", user.id)
    .single();
  if (profileError || !isUuid(profile?.couple_id)) {
    return response({ code: "TODAY_ONE_V2_COUPLE_REQUIRED", error: "커플 연결을 확인해 주세요." }, 409);
  }
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", profile.couple_id)
    .single();
  const rosterMatches =
    (profile.role === "bride" && couple?.bride_id === user.id)
    || (profile.role === "groom" && couple?.groom_id === user.id);
  if (coupleError || !rosterMatches) {
    return response({ code: "TODAY_ONE_V2_ROSTER_CHANGED", error: "커플 연결 상태가 바뀌었어요." }, 409);
  }
  const { data: epoch, error: epochError } = await supabase.rpc(
    "get_own_amora_privacy_epoch",
    { p_couple_id: profile.couple_id, p_visibility: "shared" },
  );
  if (epochError || !Number.isSafeInteger(epoch) || epoch < 1) {
    return response({ code: "TODAY_ONE_V2_PRIVACY_UNAVAILABLE", error: "공유 범위를 확인하지 못했어요." }, 503);
  }
  return { userId: user.id, coupleId: profile.couple_id, privacyEpoch: epoch };
}

export async function GET(request: Request) {
  try {
    if (!isAmoraTodayOneEnabled()) {
      return response({ code: "TODAY_ONE_V2_UNAVAILABLE" }, 404);
    }
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "TODAY_ONE_V2_ORIGIN_REJECTED", error: "잘못된 요청 출처입니다." }, 403);
    }
    const explicitActionId = readExplicitActionId(request);
    if (explicitActionId === undefined) {
      return response({ code: "TODAY_ONE_V2_QUERY_INVALID", error: "요청 형식이 올바르지 않아요." }, 400);
    }
    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-today-one-v2:claim", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }

    const admin = createAdminClient();
    const { data, error } = explicitActionId
      ? await admin.rpc("claim_amora_action_execution_v1", {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_privacy_epoch: context.privacyEpoch,
        p_action_id: explicitActionId,
      })
      : await admin.rpc("claim_amora_action_follow_up_v2", {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_privacy_epoch: context.privacyEpoch,
      });
    if (error) {
      const text = [error.code, error.message, error.details, error.hint].join(" ");
      if (/PRIVACY_STALE|RECIPIENT_FORBIDDEN/.test(text)) {
        return response({ code: "TODAY_ONE_V2_CONTEXT_CHANGED", error: "계정이나 공유 상태가 바뀌었어요." }, 409);
      }
      if (/function .*(?:claim_amora_action_follow_up_v2|claim_amora_action_execution_v1).*does not exist|PGRST202/i.test(text)) {
        return response({ code: "TODAY_ONE_V2_UNAVAILABLE" }, 404);
      }
      console.error("[today-one-v2] claim failed", { code: error.code });
      return response({ code: "TODAY_ONE_V2_READ_FAILED", error: "후속 확인을 불러오지 못했어요." }, 503);
    }
    const validated = validateTodayOneCareV2Response(data, context.userId);
    if (!validated.ok) {
      console.error("[today-one-v2] invalid claim response", { reason: validated.reason });
      return response({ code: "TODAY_ONE_V2_INVALID_RESPONSE", error: "후속 확인 형식을 확인하지 못했어요." }, 503);
    }
    return response(validated.value satisfies TodayOneCareV2Response);
  } catch (error) {
    console.error("[today-one-v2] GET failed", error);
    return response({ code: "TODAY_ONE_V2_READ_FAILED", error: "후속 확인을 불러오지 못했어요." }, 503);
  }
}
