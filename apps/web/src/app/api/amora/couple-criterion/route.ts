import {
  parseAmoraCoupleCriterionAcceptRequest,
  parseAmoraCoupleCriterionCancelRequest,
  parseAmoraCoupleCriterionProposeRequest,
  parseAmoraCoupleCriterionResponse,
} from "@hanbang/shared/amora-couple-criterion";
import { NextResponse } from "next/server";

import { containsPotentialSensitiveData } from "@/lib/ai/amoraMemoryCompiler";
import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 1_024;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

type MutationMode = "propose" | "accept" | "cancel";
type CoupleCriterionContext =
  | { error: NextResponse }
  | { userId: string; coupleId: string };

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

async function loadContext(request: Request): Promise<CoupleCriterionContext> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) return { error: response({
    code: "AMORA_COUPLE_CRITERION_AUTH_REQUIRED",
  }, 401) } as const;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", user.id)
    .single();
  if (
    profileError
    || !isUuid(profile?.couple_id)
    || (profile.role !== "bride" && profile.role !== "groom")
  ) return { error: response({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" }, 409) } as const;

  const coupleId = profile.couple_id.toLowerCase();
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .single();
  const rosterMatches = !coupleError && (
    (profile.role === "bride" && couple?.bride_id === user.id)
    || (profile.role === "groom" && couple?.groom_id === user.id)
  );
  if (!rosterMatches) {
    return { error: response({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" }, 409) } as const;
  }

  return { userId: user.id.toLowerCase(), coupleId } as const;
}

function mapRpcError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}) {
  const errorText = [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (error.code === "40001" || /AMORA_COUPLE_CRITERION_(?:CONFLICT|PENDING_EXISTS|ALREADY_ACCEPTED|ACCEPTANCE_INCOMPLETE)/u.test(errorText)) {
    return response({ code: "AMORA_COUPLE_CRITERION_CONFLICT" }, 409);
  }
  if (error.code === "42501" || /AMORA_COUPLE_CRITERION_SCOPE_CHANGED/u.test(errorText)) {
    return response({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" }, 409);
  }
  if (error.code === "22023") {
    return response({ code: "AMORA_COUPLE_CRITERION_REQUEST_INVALID" }, 400);
  }
  return response({ code: "AMORA_COUPLE_CRITERION_UNAVAILABLE" }, 503);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const context = await loadContext(request);
    if ("error" in context) return context.error;
    const { data, error } = await createAdminClient().rpc(
      "read_amora_couple_core_criterion_v1",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
      },
    );
    if (error) return mapRpcError(error);
    const payload = parseAmoraCoupleCriterionResponse(data);
    if (!payload || payload.coupleId !== context.coupleId) {
      return response({ code: "AMORA_COUPLE_CRITERION_RECEIPT_INVALID" }, 503);
    }
    return response(payload);
  } catch {
    return response({ code: "AMORA_COUPLE_CRITERION_UNAVAILABLE" }, 503);
  }
}

async function mutate(request: Request, mode: MutationMode): Promise<NextResponse> {
  try {
    const context = await loadContext(request);
    if ("error" in context) return context.error;
    const actor = verifyMutationActorFence(request.headers, context.userId, {
      allowLegacy: false,
    });
    if (!actor.ok) return response({ code: actor.code }, actor.status);

    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response(
        { code: "AMORA_COUPLE_CRITERION_REQUEST_INVALID" },
        raw.reason === "too_large" ? 413 : 400,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw.text);
    } catch {
      input = null;
    }
    let rpcName: string;
    let rpcBody: Record<string, string | number | null>;
    if (mode === "propose") {
      const body = parseAmoraCoupleCriterionProposeRequest(input);
      if (!body) {
        return response({ code: "AMORA_COUPLE_CRITERION_REQUEST_INVALID" }, 400);
      }
      if (body.expectedCoupleId !== context.coupleId) {
        return response({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" }, 409);
      }
      if (containsPotentialSensitiveData(body.value)) {
        return response({ code: "AMORA_COUPLE_CRITERION_SENSITIVE_DATA_REJECTED" }, 400);
      }
      rpcName = "propose_amora_couple_core_criterion_v1";
      rpcBody = {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_expected_current_decision_id: body.expectedCurrentDecisionId,
        p_request_id: body.requestId,
        p_value: body.value,
      };
    } else {
      const body = mode === "accept"
        ? parseAmoraCoupleCriterionAcceptRequest(input)
        : parseAmoraCoupleCriterionCancelRequest(input);
      if (!body) {
        return response({ code: "AMORA_COUPLE_CRITERION_REQUEST_INVALID" }, 400);
      }
      if (body.expectedCoupleId !== context.coupleId) {
        return response({ code: "AMORA_COUPLE_CRITERION_SCOPE_CHANGED" }, 409);
      }
      rpcName = mode === "accept"
        ? "accept_amora_couple_core_criterion_v1"
        : "cancel_amora_couple_core_criterion_v1";
      rpcBody = {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
        p_proposal_id: body.proposalId,
        p_expected_revision: body.expectedRevision,
        p_request_id: body.requestId,
      };
    }

    const limited = checkRateLimit(
      rateLimitKey(`amora-couple-criterion:${mode}`, request, context.userId),
      { maxRequests: 20, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }

    const { data, error } = await createAdminClient().rpc(rpcName, rpcBody);
    if (error) return mapRpcError(error);
    const payload = parseAmoraCoupleCriterionResponse(data);
    if (!payload || payload.coupleId !== context.coupleId) {
      return response({ code: "AMORA_COUPLE_CRITERION_RECEIPT_INVALID" }, 503);
    }
    return response(payload);
  } catch {
    return response({ code: "AMORA_COUPLE_CRITERION_UNAVAILABLE" }, 503);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isTrustedMutationRequest(request)) {
    return response({ code: "AMORA_COUPLE_CRITERION_ORIGIN_REJECTED" }, 403);
  }
  return mutate(request, "propose");
}

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isTrustedMutationRequest(request)) {
    return response({ code: "AMORA_COUPLE_CRITERION_ORIGIN_REJECTED" }, 403);
  }
  return mutate(request, "accept");
}

export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isTrustedMutationRequest(request)) {
    return response({ code: "AMORA_COUPLE_CRITERION_ORIGIN_REJECTED" }, 403);
  }
  return mutate(request, "cancel");
}
