import { NextResponse } from "next/server";
import {
  validateAmoraActionOutcomeFeedbackResponse,
} from "@hanbang/shared/amora-action-outcome-feedback";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Context = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
};

async function loadContext(request: Request): Promise<Context | NextResponse> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return response({ code: "AMORA_ACTION_FEEDBACK_AUTH_REQUIRED" }, 401);
  }

  const userId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, userId, { allowLegacy: false });
  if (!actor.ok) {
    return response({ code: actor.code, error: actor.message }, actor.status);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (
    profileError
    || !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return response({ code: "AMORA_ACTION_FEEDBACK_COUPLE_REQUIRED" }, 409);
  }
  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  const rosterMatches = !coupleError && (
    (profile.role === "bride" && couple?.bride_id === userId)
    || (profile.role === "groom" && couple?.groom_id === userId)
  );
  if (!rosterMatches) {
    return response({ code: "AMORA_ACTION_FEEDBACK_CONTEXT_CHANGED" }, 409);
  }

  const { data: privacyEpoch, error: privacyError } = await supabase.rpc(
    "get_own_amora_privacy_epoch",
    { p_couple_id: coupleId, p_visibility: "shared" },
  );
  if (
    privacyError
    || !Number.isSafeInteger(privacyEpoch)
    || privacyEpoch < 1
  ) {
    return response({ code: "AMORA_ACTION_FEEDBACK_PRIVACY_UNAVAILABLE" }, 503);
  }
  return { userId, coupleId, privacyEpoch };
}

function rpcFailure(error: {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}) {
  const text = [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (
    /function .*read_own_amora_action_outcome_feedback_v1.*does not exist|PGRST202/iu
      .test(text)
  ) {
    return response({ code: "AMORA_ACTION_FEEDBACK_UNAVAILABLE" }, 404);
  }
  if (/RECIPIENT_FORBIDDEN|PRIVACY_STALE/iu.test(text)) {
    return response({ code: "AMORA_ACTION_FEEDBACK_CONTEXT_CHANGED" }, 409);
  }
  return response({ code: "AMORA_ACTION_FEEDBACK_READ_FAILED" }, 503);
}

export async function GET(request: Request) {
  try {
    if (!isAmoraTodayOneEnabled()) {
      return response({ code: "AMORA_ACTION_FEEDBACK_UNAVAILABLE" }, 404);
    }
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_ACTION_FEEDBACK_ORIGIN_REJECTED" }, 403);
    }
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      return response({ code: "AMORA_ACTION_FEEDBACK_QUERY_INVALID" }, 400);
    }

    const context = await loadContext(request);
    if (context instanceof NextResponse) return context;
    const limited = checkRateLimit(
      rateLimitKey("amora-action-feedback:read", request, context.userId),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      limited.headers.set("Vary", PRIVATE_HEADERS.Vary);
      return limited;
    }

    const { data, error } = await createAdminClient().rpc(
      "read_own_amora_action_outcome_feedback_v1",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_privacy_epoch: context.privacyEpoch,
      },
    );
    if (error) return rpcFailure(error);

    const validated = validateAmoraActionOutcomeFeedbackResponse(
      data,
      context.userId,
      context.coupleId,
      Date.now(),
    );
    if (!validated.ok) {
      console.error("[amora-action-feedback] invalid response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_ACTION_FEEDBACK_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[amora-action-feedback] GET failed", error);
    return response({ code: "AMORA_ACTION_FEEDBACK_READ_FAILED" }, 503);
  }
}
