import {
  validateAmoraPreparationTopicMessageRefResolveResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";
import { NextResponse } from "next/server";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type RequestContext = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
};

type ContextResult =
  | { ok: true; value: RequestContext }
  | { ok: false; response: NextResponse };

function isMissingRowError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "PGRST116";
}

async function loadContext(request: Request): Promise<ContextResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_AUTH_REQUIRED" }, 401),
    };
  }
  const userId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, userId, {
    allowLegacy: false,
  });
  if (!actor.ok) {
    return { ok: false, response: response({ code: actor.code }, actor.status) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (profileError && !isMissingRowError(profileError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  if (
    !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
  }
  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  if (coupleError && !isMissingRowError(coupleError)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503),
    };
  }
  const rosterMatches = !coupleError && (
    (profile.role === "bride"
      && isUuid(couple?.bride_id)
      && couple.bride_id.toLowerCase() === userId)
    || (profile.role === "groom"
      && isUuid(couple?.groom_id)
      && couple.groom_id.toLowerCase() === userId)
  );
  if (!rosterMatches) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONTEXT_CHANGED" }, 409),
    };
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
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_PRIVACY_UNAVAILABLE" }, 503),
    };
  }
  return {
    ok: true,
    value: { userId, coupleId, privacyEpoch },
  };
}

function mapRpcError(error: { code?: unknown }) {
  if (error.code === "P0002") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND" }, 404);
  }
  if (error.code === "40001") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_CONFLICT" }, 409);
  }
  if (error.code === "22023") {
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REQUEST_INVALID" }, 400);
  }
  return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
}

function privateRateLimit(responseValue: NextResponse) {
  responseValue.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  responseValue.headers.set("Vary", PRIVATE_HEADERS.Vary);
  return responseValue;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ refId: string }> },
) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_ORIGIN_REJECTED" }, 403);
    }
    const { refId: rawRefId } = await context.params;
    if (!isUuid(rawRefId)) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_NOT_FOUND" }, 404);
    }
    const refId = rawRefId.toLowerCase();
    if ([...new URL(request.url).searchParams.entries()].length > 0) {
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_QUERY_INVALID" }, 400);
    }

    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const requestContext = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey(
        "amora-preparation-topic-message-ref:resolve",
        request,
        requestContext.userId,
      ),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    const { data, error } = await createAdminClient().rpc(
      "resolve_amora_preparation_topic_message_ref_v1",
      {
        p_couple_id: requestContext.coupleId,
        p_recipient_user_id: requestContext.userId,
        p_ref_id: refId,
        p_expected_privacy_epoch: requestContext.privacyEpoch,
      },
    );
    if (error) return mapRpcError(error);
    const validated = validateAmoraPreparationTopicMessageRefResolveResponse(
      data,
      requestContext.userId,
      requestContext.coupleId,
      refId,
    );
    if (!validated.ok) {
      console.error("[preparation-topic-message-ref-resolve] invalid response", {
        reason: validated.reason,
      });
      return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-topic-message-ref-resolve] GET failed", error);
    return response({ code: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_UNAVAILABLE" }, 503);
  }
}
