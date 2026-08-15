import {
  AMORA_CORE_CRITERION_CONTRACT_VERSION,
  parseAmoraCoreCriterionDeleteRequest,
  parseAmoraCoreCriterionSaveRequest,
  parseAmoraCoreCriterionResponse,
} from "@hanbang/shared/amora-core-criterion";
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

const CRITERION_CONTRACT = "amora_core_criterion_v1";
const MAX_BODY_BYTES = 1_024;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

type CoupleRole = "bride" | "groom";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function privateVisibility(role: CoupleRole) {
  return `${role}_private` as const;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isUuid(user.id)) {
      return response({ code: "AMORA_CORE_CRITERION_AUTH_REQUIRED" }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id, role")
      .eq("id", user.id)
      .single();
    if (
      profileError
      || !isUuid(profile?.couple_id)
      || (profile.role !== "bride" && profile.role !== "groom")
    ) {
      return response({ code: "AMORA_CORE_CRITERION_SCOPE_CHANGED" }, 409);
    }

    const role: CoupleRole = profile.role;
    const coupleId = profile.couple_id.toLowerCase();
    const { data: couple, error: coupleError } = await supabase
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", coupleId)
      .single();
    const rosterMatches = !coupleError && (
      (role === "bride" && couple?.bride_id === user.id)
      || (role === "groom" && couple?.groom_id === user.id)
    );
    if (!rosterMatches) {
      return response({ code: "AMORA_CORE_CRITERION_SCOPE_CHANGED" }, 409);
    }

    const visibility = privateVisibility(role);
    const { data: row, error: rowError } = await supabase
      .from("decision_nodes")
      .select("id, chosen_value, metadata, updated_at")
      .eq("couple_id", coupleId)
      .eq("visibility", visibility)
      .eq("source_actor_role", role)
      .eq("source", "manual")
      .eq("category", "preference")
      .eq("decision_type", "considering")
      .contains("metadata", {
        criterion_contract: CRITERION_CONTRACT,
        owner_user_id: user.id,
      })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rowError) {
      return response({ code: "AMORA_CORE_CRITERION_READ_UNAVAILABLE" }, 503);
    }
    if (!row) {
      return response({
        version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
        criterion: null,
      });
    }
    if (
      !isRecord(row.metadata)
      || row.metadata.criterion_contract !== CRITERION_CONTRACT
      || row.metadata.owner_user_id !== user.id
      || row.metadata.criterion_version !== AMORA_CORE_CRITERION_CONTRACT_VERSION
      || row.metadata.explicit !== true
    ) {
      return response({ code: "AMORA_CORE_CRITERION_RECEIPT_INVALID" }, 503);
    }
    if (row.metadata.criterion_deleted === true) {
      return response({
        version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
        criterion: null,
      });
    }

    const updatedAt = typeof row.updated_at === "string"
      ? new Date(row.updated_at).toISOString()
      : "";
    const payload = parseAmoraCoreCriterionResponse({
      version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
      criterion: {
        id: row.id,
        value: isRecord(row.chosen_value) ? row.chosen_value.value : null,
        updatedAt,
      },
    });
    return payload
      ? response(payload)
      : response({ code: "AMORA_CORE_CRITERION_RECEIPT_INVALID" }, 503);
  } catch {
    return response({ code: "AMORA_CORE_CRITERION_READ_UNAVAILABLE" }, 503);
  }
}

async function mutateCriterion(request: Request, deleteMode: boolean) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ code: "AMORA_CORE_CRITERION_ORIGIN_REJECTED" }, 403);
    }
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !isUuid(user.id)) {
      return response({ code: "AMORA_CORE_CRITERION_AUTH_REQUIRED" }, 401);
    }
    const actor = verifyMutationActorFence(request.headers, user.id, {
      allowLegacy: false,
    });
    if (!actor.ok) return response({ code: actor.code }, actor.status);

    const raw = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!raw.ok) {
      return response(
        { code: "AMORA_CORE_CRITERION_REQUEST_INVALID" },
        raw.reason === "too_large" ? 413 : 400,
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.text);
    } catch {
      parsedJson = null;
    }
    const saveBody = deleteMode ? null : parseAmoraCoreCriterionSaveRequest(parsedJson);
    const deleteBody = deleteMode ? parseAmoraCoreCriterionDeleteRequest(parsedJson) : null;
    const body = saveBody ?? deleteBody;
    if (!body) {
      return response({ code: "AMORA_CORE_CRITERION_REQUEST_INVALID" }, 400);
    }
    if (saveBody && containsPotentialSensitiveData(saveBody.value)) {
      return response({ code: "AMORA_CORE_CRITERION_SENSITIVE_DATA_REJECTED" }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id, role")
      .eq("id", user.id)
      .single();
    if (
      profileError
      || !isUuid(profile?.couple_id)
      || (profile.role !== "bride" && profile.role !== "groom")
    ) {
      return response({ code: "AMORA_CORE_CRITERION_SCOPE_CHANGED" }, 409);
    }
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
      return response({ code: "AMORA_CORE_CRITERION_SCOPE_CHANGED" }, 409);
    }

    const limited = checkRateLimit(
      rateLimitKey("amora-core-criterion", request, user.id),
      { maxRequests: 20, windowMs: 60_000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
      return limited;
    }

    const { data, error } = await createAdminClient().rpc(
      "set_amora_core_criterion_v1",
      {
        p_couple_id: coupleId,
        p_recipient_user_id: user.id,
        p_expected_criterion_id: body.expectedCriterionId,
        p_request_id: body.requestId,
        p_value: saveBody?.value ?? null,
        p_delete: deleteMode,
      },
    );
    if (error) {
      const errorText = [error.code, error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      if (error.code === "40001" || /AMORA_CORE_CRITERION_CONFLICT/u.test(errorText)) {
        return response({ code: "AMORA_CORE_CRITERION_CONFLICT" }, 409);
      }
      if (error.code === "42501" || /AMORA_CORE_CRITERION_SCOPE_CHANGED/u.test(errorText)) {
        return response({ code: "AMORA_CORE_CRITERION_SCOPE_CHANGED" }, 409);
      }
      if (error.code === "22023") {
        return response({ code: "AMORA_CORE_CRITERION_REQUEST_INVALID" }, 400);
      }
      return response({ code: "AMORA_CORE_CRITERION_WRITE_UNAVAILABLE" }, 503);
    }
    if (
      !isRecord(data)
      || data.version !== AMORA_CORE_CRITERION_CONTRACT_VERSION
      || data.deleted !== deleteMode
      || !isUuid(data.criterionId)
      || typeof data.updatedAt !== "string"
    ) {
      return response({ code: "AMORA_CORE_CRITERION_RECEIPT_INVALID" }, 503);
    }
    const payload = parseAmoraCoreCriterionResponse(deleteMode
      ? {
          version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
          criterion: null,
        }
      : {
          version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
          criterion: {
            id: data.criterionId,
            value: data.value,
            updatedAt: new Date(data.updatedAt).toISOString(),
          },
        });
    return payload
      ? response(payload)
      : response({ code: "AMORA_CORE_CRITERION_RECEIPT_INVALID" }, 503);
  } catch {
    return response({ code: "AMORA_CORE_CRITERION_WRITE_UNAVAILABLE" }, 503);
  }
}

export async function PUT(request: Request) {
  return mutateCriterion(request, false);
}

export async function DELETE(request: Request) {
  return mutateCriterion(request, true);
}
