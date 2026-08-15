import { NextResponse } from "next/server";
import {
  buildAmoraFirstUseSharedDraft,
  validateAmoraFirstUsePromotionPreviewResponse,
} from "@hanbang/shared/amora-first-use-promotion";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid } from "@/utils/requestValidation";
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

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function parseCanonicalActionInput(value: unknown) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["action", "reason", "completionCriterion"])
    || typeof value.action !== "string"
    || typeof value.reason !== "string"
    || typeof value.completionCriterion !== "string"
  ) return null;
  const canonicalInput = {
    action: value.action,
    reason: value.reason,
    completionCriterion: value.completionCriterion,
  };
  const sharedText = buildAmoraFirstUseSharedDraft(canonicalInput);
  if (!sharedText) return null;
  return {
    ...canonicalInput,
    sharedText,
  };
}

type PromotionRead =
  | {
      status: "ready";
      sourceRevision: number;
      criterionDecisionId: string | null;
      canonicalDraft: {
        action: string;
        reason: string;
        completionCriterion: string;
        sharedText: string;
      };
    }
  | { status: "promoted"; sharedMessageId: string };

function parsePromotionRead(value: unknown, expectedSourceMessageId: string): PromotionRead | null {
  if (!isRecord(value) || value.version !== 1 || value.sourceMessageId !== expectedSourceMessageId) {
    return null;
  }
  if (value.status === "ready") {
    if (
      !hasExactKeys(value, [
        "version",
        "status",
        "promotionId",
        "sharedMessageId",
        "sourceMessageId",
        "sourceRevision",
        "criterionDecisionId",
        "canonicalActionInput",
      ])
      || value.promotionId !== null
      || value.sharedMessageId !== null
      || !Number.isSafeInteger(value.sourceRevision)
      || (value.sourceRevision as number) < 0
      || (value.criterionDecisionId !== null && !isUuid(value.criterionDecisionId))
    ) return null;
    const canonicalDraft = parseCanonicalActionInput(value.canonicalActionInput);
    if (!canonicalDraft) return null;
    return {
      status: "ready",
      sourceRevision: value.sourceRevision as number,
      criterionDecisionId: value.criterionDecisionId as string | null,
      canonicalDraft,
    };
  }
  if (value.status === "promoted") {
    if (
      !hasExactKeys(value, [
        "version",
        "status",
        "promotionId",
        "sharedMessageId",
        "sourceMessageId",
      ])
      || !isUuid(value.promotionId)
      || !isUuid(value.sharedMessageId)
    ) return null;
    return { status: "promoted", sharedMessageId: value.sharedMessageId };
  }
  return null;
}

function rpcFailure(error: {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}) {
  const text = [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
  if (text.includes("AMORA_FIRST_USE_PROMOTION_CRITERION_CHANGED")) {
    return response({ code: "FIRST_USE_PROMOTION_CRITERION_STALE" }, 409);
  }
  if (text.includes("AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED")) {
    return response({ code: "FIRST_USE_PROMOTION_IDENTITY_CHANGED" }, 403);
  }
  if (
    text.includes("AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID")
    || text.includes("AMORA_FIRST_USE_PROMOTION_INVALID")
  ) {
    return response({ code: "FIRST_USE_PROMOTION_NOT_FOUND" }, 404);
  }
  if (
    text.includes("AMORA_FIRST_USE_PROMOTION_SOURCE_STALE")
    || text.includes("AMORA_FIRST_USE_PROMOTION_JOURNEY_CHANGED")
    || text.includes("AMORA_FIRST_USE_PROMOTION_PRIVACY_CHANGED")
    || text.includes("AMORA_FIRST_USE_PROMOTION_ROSTER_CHANGED")
    || text.includes("AMORA_FIRST_USE_PROMOTION_CONTENT_MISMATCH")
    || text.includes("AMORA_FIRST_USE_PROMOTION_REQUEST_CONFLICT")
    || text.includes("AMORA_FIRST_USE_PROMOTION_PROPOSAL_MISMATCH")
  ) {
    return response({ code: "FIRST_USE_PROMOTION_STALE" }, 409);
  }
  return response({ code: "FIRST_USE_PROMOTION_UNAVAILABLE" }, 503);
}

async function loadOwnerContext(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return response({ code: "FIRST_USE_PROMOTION_AUTH_REQUIRED" }, 401);
  }
  const ownerUserId = user.id.toLowerCase();
  const actor = verifyMutationActorFence(request.headers, ownerUserId, {
    allowLegacy: false,
  });
  if (!actor.ok) return response({ code: actor.code, error: actor.message }, actor.status);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", ownerUserId)
    .single();
  if (
    profileError
    || !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) {
    return response({ code: "FIRST_USE_PROMOTION_IDENTITY_CHANGED" }, 403);
  }
  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  if (
    coupleError
    || (profile.role === "bride" && couple?.bride_id !== ownerUserId)
    || (profile.role === "groom" && couple?.groom_id !== ownerUserId)
  ) {
    return response({ code: "FIRST_USE_PROMOTION_IDENTITY_CHANGED" }, 403);
  }
  return { ownerUserId, coupleId };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sourceMessageId: string }> },
) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "FIRST_USE_PROMOTION_ORIGIN_REJECTED" }, 403);
    }
    const { sourceMessageId: rawSourceMessageId } = await context.params;
    const sourceMessageId = rawSourceMessageId?.toLowerCase();
    if (!isUuid(sourceMessageId)) {
      return response({ code: "FIRST_USE_PROMOTION_NOT_FOUND" }, 404);
    }
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      return response({ code: "FIRST_USE_PROMOTION_QUERY_INVALID" }, 400);
    }

    const owner = await loadOwnerContext(request);
    if (owner instanceof NextResponse) return owner;
    const limited = checkRateLimit(
      rateLimitKey("amora-first-use-promotion:read", request, owner.ownerUserId),
      { maxRequests: 30, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      limited.headers.set("Vary", PRIVATE_HEADERS.Vary);
      return limited;
    }

    const { data, error } = await createAdminClient().rpc(
      "read_amora_first_use_action_promotion_v1",
      {
        p_couple_id: owner.coupleId,
        p_owner_user_id: owner.ownerUserId,
        p_source_private_message_id: sourceMessageId,
      },
    );
    if (error) return rpcFailure(error);

    const promotion = parsePromotionRead(data, sourceMessageId);
    if (!promotion) {
      console.error("[first-use-promotion] invalid service response");
      return response({ code: "FIRST_USE_PROMOTION_INVALID_RESPONSE" }, 503);
    }
    const publicValue = promotion.status === "promoted"
      ? {
          version: 1 as const,
          state: "already_shared" as const,
          ownerUserId: owner.ownerUserId,
          coupleId: owner.coupleId,
          sourceMessageId,
          sharedMessageId: promotion.sharedMessageId,
        }
      : {
          version: 1 as const,
          state: "ready" as const,
          ownerUserId: owner.ownerUserId,
          coupleId: owner.coupleId,
          sourceMessageId,
          sourceRevision: promotion.sourceRevision,
          criterionDecisionId: promotion.criterionDecisionId,
          canonicalDraft: promotion.canonicalDraft,
        };
    const validated = validateAmoraFirstUsePromotionPreviewResponse(
      publicValue,
      owner.ownerUserId,
      owner.coupleId,
      sourceMessageId,
    );
    if (!validated.ok) {
      console.error("[first-use-promotion] invalid public response", {
        reason: validated.reason,
      });
      return response({ code: "FIRST_USE_PROMOTION_INVALID_RESPONSE" }, 503);
    }
    return response(validated.value);
  } catch (error) {
    console.error("[first-use-promotion] GET failed", error);
    return response({ code: "FIRST_USE_PROMOTION_UNAVAILABLE" }, 503);
  }
}
