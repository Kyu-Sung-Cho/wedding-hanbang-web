import { NextResponse } from "next/server";
import {
  validateAmoraScheduleCareFollowUpBinding,
} from "@hanbang/shared/amora-schedule-care-follow-up";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import {
  resolveAmoraScheduleCareFollowUp,
  type AmoraScheduleCareFollowUpResolutionFailure,
} from "@/lib/care/scheduleCareFollowUp";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
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
const QUERY_KEYS = ["cardId", "cardRevision", "sourceRevision"] as const;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function readDecimalRevision(
  value: string | null,
  minimum: 0 | 1,
): number | null {
  if (value === null || !/^(?:0|[1-9]\d{0,15})$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function readBinding(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => !QUERY_KEYS.includes(key as typeof QUERY_KEYS[number]))
    || QUERY_KEYS.some((key) => params.getAll(key).length !== 1)
  ) return null;

  const cardRevision = readDecimalRevision(params.get("cardRevision"), 1);
  const sourceRevision = readDecimalRevision(params.get("sourceRevision"), 0);
  const validation = validateAmoraScheduleCareFollowUpBinding({
    cardId: params.get("cardId"),
    cardRevision,
    sourceRevision,
  });
  return validation.ok ? validation.value : null;
}

function resolutionFailure(reason: AmoraScheduleCareFollowUpResolutionFailure) {
  if (reason === "scope_changed") {
    return response({ code: "SCHEDULE_CARE_FOLLOW_UP_SCOPE_CHANGED" }, 403);
  }
  if (reason === "privacy_unavailable" || reason === "source_unavailable") {
    return response({
      code: "SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
      retryable: true,
      retryPolicy: "same_request",
    }, 503);
  }
  return response({
    code: "SCHEDULE_CARE_FOLLOW_UP_STALE",
    retryable: false,
    retryPolicy: "refresh_source",
  }, 409);
}

export async function GET(request: Request) {
  try {
    if (!isAmoraTodayOneEnabled()) {
      return response({ code: "SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE" }, 404);
    }
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "SCHEDULE_CARE_FOLLOW_UP_ORIGIN_REJECTED" }, 403);
    }
    const binding = readBinding(request);
    if (!binding) {
      return response({ code: "SCHEDULE_CARE_FOLLOW_UP_QUERY_INVALID" }, 400);
    }

    const client = await createClientFromRequest(request);
    const { data: { user } } = await client.auth.getUser();
    if (!user || !isUuid(user.id)) {
      return response({ code: "SCHEDULE_CARE_FOLLOW_UP_AUTH_REQUIRED" }, 401);
    }
    const recipientUserId = user.id.toLowerCase();
    const actor = verifyMutationActorFence(request.headers, recipientUserId, {
      allowLegacy: false,
    });
    if (!actor.ok) {
      return response({ code: actor.code, error: actor.message }, actor.status);
    }

    const limited = checkRateLimit(
      rateLimitKey("amora-schedule-care-follow-up:read", request, recipientUserId),
      { maxRequests: 30, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      limited.headers.set("Vary", PRIVATE_HEADERS.Vary);
      return limited;
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("couple_id")
      .eq("id", recipientUserId)
      .single();
    if (profileError) {
      return response({
        code: "SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
        retryable: true,
        retryPolicy: "same_request",
      }, 503);
    }
    if (!isUuid(profile?.couple_id)) {
      return response({ code: "SCHEDULE_CARE_FOLLOW_UP_COUPLE_REQUIRED" }, 409);
    }
    const coupleId = profile.couple_id.toLowerCase();
    const resolved = await resolveAmoraScheduleCareFollowUp({
      client,
      recipientUserId,
      coupleId,
      binding,
      now: new Date(),
    });
    if (!resolved.ok) return resolutionFailure(resolved.reason);

    return response({
      version: 1,
      state: "ready",
      recipientUserId: resolved.value.recipientUserId,
      coupleId: resolved.value.coupleId,
      binding: resolved.value.binding,
      expiresAt: resolved.value.expiresAt,
      prompt: resolved.value.prompt,
    });
  } catch (error) {
    console.error("[schedule-care-follow-up] GET failed", error);
    return response({
      code: "SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
      retryable: true,
      retryPolicy: "same_request",
    }, 503);
  }
}
