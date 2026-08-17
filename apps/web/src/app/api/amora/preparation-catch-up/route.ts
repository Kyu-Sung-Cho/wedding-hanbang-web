import {
  parseAmoraPreparationCatchUpMutationRequest,
  validateAmoraPreparationCatchUpReceipt,
} from "@hanbang/shared/amora-preparation-catch-up";
import { NextResponse } from "next/server";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 2_048;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function privateRateLimit(value: NextResponse) {
  value.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  value.headers.set("Vary", PRIVATE_HEADERS.Vary);
  return value;
}

function isMissingRowError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "PGRST116";
}

type RequestContext = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
};

type ContextResult =
  | { ok: true; value: RequestContext }
  | { ok: false; response: NextResponse };

async function loadContext(request: Request): Promise<ContextResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_AUTH_REQUIRED" }, 401),
    };
  }
  const userId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, userId, { allowLegacy: false });
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
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_UNAVAILABLE" }, 503),
    };
  }
  if (
    !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return {
      ok: false,
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED" }, 409),
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
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_UNAVAILABLE" }, 503),
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
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED" }, 409),
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
      response: response({ code: "AMORA_PREPARATION_CATCH_UP_UNAVAILABLE" }, 503),
    };
  }
  return { ok: true, value: { userId, coupleId, privacyEpoch } };
}

function mapRpcError(error: { code?: unknown }) {
  if (error.code === "22023") {
    return response({ code: "AMORA_PREPARATION_CATCH_UP_REQUEST_INVALID" }, 400);
  }
  if (error.code === "23514") {
    return response({ code: "AMORA_PREPARATION_CATCH_UP_CANONICAL_EXISTS" }, 409);
  }
  if (error.code === "42501") {
    return response({ code: "AMORA_PREPARATION_CATCH_UP_SHARED_APPROVAL_REQUIRED" }, 409);
  }
  if (error.code === "40001") {
    return response({ code: "AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED" }, 409);
  }
  if (error.code === "55000") {
    return response({ code: "AMORA_PREPARATION_CATCH_UP_RECONCILIATION_REQUIRED" }, 503);
  }
  return response({ code: "AMORA_PREPARATION_CATCH_UP_UNAVAILABLE" }, 503);
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_PREPARATION_CATCH_UP_ORIGIN_REJECTED" }, 403);
    }
    if ([...new URL(request.url).searchParams.entries()].length > 0) {
      return response({ code: "AMORA_PREPARATION_CATCH_UP_REQUEST_INVALID" }, 400);
    }
    const loaded = await loadContext(request);
    if (!loaded.ok) return loaded.response;
    const context = loaded.value;
    const limited = checkRateLimit(
      rateLimitKey("amora-preparation-catch-up:write", request, context.userId),
      { maxRequests: 12, windowMs: 60_000 },
    );
    if (limited) return privateRateLimit(limited);

    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response({ code: "AMORA_PREPARATION_CATCH_UP_REQUEST_INVALID" }, 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.text);
    } catch {
      body = null;
    }
    const input = parseAmoraPreparationCatchUpMutationRequest(body);
    if (!input) {
      return response({ code: "AMORA_PREPARATION_CATCH_UP_REQUEST_INVALID" }, 400);
    }
    if (input.expectedCoupleId !== context.coupleId) {
      return response({ code: "AMORA_PREPARATION_CATCH_UP_CONTEXT_CHANGED" }, 409);
    }

    const { data, error } = await createAdminClient().rpc(
      "finalize_amora_preparation_catch_up_v1",
      {
        p_couple_id: context.coupleId,
        p_actor_user_id: context.userId,
        p_request_id: input.requestId,
        p_expected_privacy_epoch: context.privacyEpoch,
        p_items: input.items,
      },
    );
    if (error) return mapRpcError(error);

    const validated = validateAmoraPreparationCatchUpReceipt(
      data,
      context.coupleId,
      input.requestId,
      input.items,
    );
    if (!validated.ok) {
      console.error("[preparation-catch-up] invalid canonical receipt", {
        reason: validated.reason,
      });
      return response({
        code: "AMORA_PREPARATION_CATCH_UP_INVALID_RECEIPT",
        retryPolicy: "same_request",
      }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[preparation-catch-up] POST failed", error);
    return response({ code: "AMORA_PREPARATION_CATCH_UP_UNAVAILABLE" }, 503);
  }
}
