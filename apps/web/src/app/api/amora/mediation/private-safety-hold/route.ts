import { NextResponse } from "next/server";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { sealMediationPrivateSafetyHold } from "@/lib/care/mediationPrivateSafetyHold";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
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

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_ORIGIN_REJECTED" }, 403);
    }
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isUuid(user.id)) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_AUTH_REQUIRED" }, 401);
    }
    const actor = verifyMutationActorFence(request.headers, user.id, {
      allowLegacy: false,
    });
    if (!actor.ok) return response({ code: actor.code }, actor.status);

    const raw = await readBoundedUtf8Text(request, 256);
    if (!raw.ok) {
      return response(
        { code: "MEDIATION_PRIVATE_SAFETY_HOLD_REQUEST_INVALID" },
        raw.reason === "too_large" ? 413 : 400,
      );
    }
    let body: unknown;
    try { body = JSON.parse(raw.text); } catch { body = null; }
    if (
      !isRecord(body)
      || Object.keys(body).length !== 1
      || !isUuid(body.coupleId)
    ) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_REQUEST_INVALID" }, 400);
    }
    const coupleId = body.coupleId.toLowerCase();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id, role")
      .eq("id", user.id)
      .single();
    if (
      profileError
      || profile?.couple_id !== coupleId
      || (profile.role !== "bride" && profile.role !== "groom")
    ) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_SCOPE_CHANGED" }, 409);
    }
    const { data: couple, error: coupleError } = await supabase
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", coupleId)
      .single();
    const rosterMatches = !coupleError
      && isUuid(couple?.bride_id)
      && isUuid(couple.groom_id)
      && couple.bride_id !== couple.groom_id
      && (
        (profile.role === "bride" && couple.bride_id === user.id)
        || (profile.role === "groom" && couple.groom_id === user.id)
      );
    if (!rosterMatches) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_SCOPE_CHANGED" }, 409);
    }

    const limited = checkRateLimit(
      rateLimitKey("amora-mediation-private-safety-hold", request, user.id),
      { maxRequests: 12, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }

    const sealed = await sealMediationPrivateSafetyHold({
      client: createAdminClient(),
      coupleId,
      recipientUserId: user.id,
    });
    if (!sealed) {
      return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_SEAL_UNAVAILABLE" }, 503);
    }
    return response({
      version: 1,
      sealed: true,
      recipientUserId: user.id,
      coupleId,
    });
  } catch {
    return response({ code: "MEDIATION_PRIVATE_SAFETY_HOLD_SEAL_UNAVAILABLE" }, 503);
  }
}
