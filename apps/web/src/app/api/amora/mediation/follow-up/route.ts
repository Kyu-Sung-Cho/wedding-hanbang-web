import { NextResponse } from "next/server";
import {
  validateMediationOutcomeFollowUpResponse,
} from "@hanbang/shared";

import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { buildMediationDecisionFollowUpCandidates } from "@/lib/care/mediationDecisionFollowUp";
import { isAmoraMediationOutcomeFollowUpEnabled } from "@/lib/features/amoraCareFlags";
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
const DECISION_SELECT = [
  "id",
  "couple_id",
  "category",
  "decision_type",
  "source",
  "source_ref_id",
  "visibility",
  "decided_at",
  "superseded_at",
  "metadata",
].join(", ");

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Context = {
  userId: string;
  coupleId: string;
  privacyEpoch: number;
  brideUserId: string;
  groomUserId: string;
};

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
  if (
    coupleError
    || !isUuid(couple?.bride_id)
    || !isUuid(couple.groom_id)
    || couple.bride_id === couple.groom_id
    || !(
      (profile.role === "bride" && couple.bride_id === user.id)
      || (profile.role === "groom" && couple.groom_id === user.id)
    )
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
  return {
    userId: user.id,
    coupleId: profile.couple_id,
    privacyEpoch: epoch,
    brideUserId: couple.bride_id,
    groomUserId: couple.groom_id,
  };
}

function emptyClaimArguments(context: Context) {
  return {
    p_couple_id: context.coupleId,
    p_recipient_user_id: context.userId,
    p_expected_privacy_epoch: context.privacyEpoch,
    p_candidate_decision_id: null,
    p_expected_source_digest: "0".repeat(64),
  };
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
      rateLimitKey("amora-mediation-follow-up:claim", request, context.userId),
      { maxRequests: 30, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }

    const admin = createAdminClient();
    const { data: decisions, error: decisionError } = await admin
      .from("decision_nodes")
      .select(DECISION_SELECT)
      .eq("couple_id", context.coupleId)
      .eq("category", "conflict_resolution")
      .eq("decision_type", "decided")
      .eq("source", "chat")
      .eq("visibility", "shared")
      .order("decided_at", { ascending: false })
      .limit(20);
    if (decisionError) {
      return response({ code: "MEDIATION_FOLLOW_UP_READ_FAILED", error: "조율 후속 확인을 불러오지 못했어요." }, 503);
    }

    const candidates = buildMediationDecisionFollowUpCandidates({
      coupleId: context.coupleId,
      recipientUserId: context.userId,
      currentRoster: {
        brideUserId: context.brideUserId,
        groomUserId: context.groomUserId,
      },
      // An application-side clear marker is not sufficient safety evidence.
      // The service RPC rechecks the exact sealed source marker, both acceptance
      // rows, and every current recipient-private safety hold atomically.
      safety: { violence: false, coercion: false, privateSafetyHold: false },
      decisions: decisions ?? [],
    });
    const claimCandidates = candidates.length > 0 ? candidates : [null];
    for (const candidate of claimCandidates) {
      const { data, error } = await admin.rpc(
        "claim_amora_mediation_outcome_follow_up",
        candidate
          ? {
              p_couple_id: context.coupleId,
              p_recipient_user_id: context.userId,
              p_expected_privacy_epoch: context.privacyEpoch,
              p_candidate_decision_id: candidate.decisionId,
              p_expected_source_digest: candidate.sourceStateDigest,
            }
          : emptyClaimArguments(context),
      );
      if (error) {
        const errorText = [error.code, error.message, error.details, error.hint]
          .filter((value): value is string => typeof value === "string")
          .join(" ");
        if (/does not exist|PGRST202/iu.test(errorText)) {
          return response({ code: "MEDIATION_FOLLOW_UP_UNAVAILABLE" }, 404);
        }
        if (/PRIVACY_STALE|RECIPIENT_FORBIDDEN|CONTEXT_STALE/u.test(errorText)) {
          return response({ code: "MEDIATION_FOLLOW_UP_CONTEXT_CHANGED", error: "계정이나 안전 상태가 바뀌었어요." }, 409);
        }
        console.error("[mediation-follow-up] claim failed", { code: error.code });
        return response({ code: "MEDIATION_FOLLOW_UP_READ_FAILED", error: "조율 후속 확인을 불러오지 못했어요." }, 503);
      }

      const validated = validateMediationOutcomeFollowUpResponse(
        data,
        context.userId,
        context.coupleId,
      );
      if (!validated.ok) {
        console.error("[mediation-follow-up] invalid response", { reason: validated.reason });
        return response({ code: "MEDIATION_FOLLOW_UP_INVALID_RESPONSE", error: "조율 후속 형식을 확인하지 못했어요." }, 503);
      }
      if (validated.value.state === "ready" || candidate === null) {
        return response(validated.value);
      }
    }
    return response({
      version: 1,
      state: "none",
      recipientUserId: context.userId,
      coupleId: context.coupleId,
    });
  } catch (error) {
    console.error("[mediation-follow-up] GET failed", error);
    return response({ code: "MEDIATION_FOLLOW_UP_READ_FAILED", error: "조율 후속 확인을 불러오지 못했어요." }, 503);
  }
}
