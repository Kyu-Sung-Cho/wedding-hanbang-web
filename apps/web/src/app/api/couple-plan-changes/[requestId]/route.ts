import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import {
  checkRateLimit,
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 2 * 1024;
const MAX_SUMMARY_CHARS = 240;
const MAX_PROPOSAL_BYTES = 128 * 1024;
const MAX_PROGRESS_KEYS = 300;
const MAX_BASE_REVISION = Number.MAX_SAFE_INTEGER - 1;
const PROGRESS_KEY_PATTERN = /^[a-zA-Z0-9_.:-]{1,80}$/;
const DISCLOSURE_RECEIPT_PATTERN = /^[a-f0-9]{64}$/;
const CHECKLIST_PROFILE_KEY = "__checklist_profile";
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const VALID_SURFACES = new Set(["/schedule", "/budget", "/dashboard"]);

type PlanChangeStatus =
  | "applied"
  | "pending_partner"
  | "stale"
  | "rejected";

type PlanChangeResult = {
  requestId: string;
  status: PlanChangeStatus;
  requiredCount: number;
  acceptedCount: number;
  baseRevision: number;
  summary?: string;
  surface?: string;
  journey?: Record<string, unknown>;
};

type PlanChangeProposal =
  | { kind: "other" }
  | {
      kind: "checklist_situation";
      baseRevision: number;
      progressPatch: Record<string, unknown>;
    };
type StoredPlanChangeProposal = {
  proposal: PlanChangeProposal;
  changeDigest: string;
};

type AuthContext = { userId: string; coupleId: string };
type AuthResult = AuthContext | { error: Response };
type MutationBodyResult =
  | { ok: true; disclosureReceipt?: string }
  | { ok: false; error: Response };

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function privateNoStore(response: Response) {
  response.headers.set(
    "Cache-Control",
    PRIVATE_NO_STORE_HEADERS["Cache-Control"],
  );
  return response;
}

function hasControlCharacter(value: string) {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function parsePlanChangeResult(
  value: unknown,
  coupleId: string,
): PlanChangeResult | null {
  if (
    !isRecord(value)
    || !isUuid(value.requestId)
    || !(
      value.status === "applied"
      || value.status === "pending_partner"
      || value.status === "stale"
      || value.status === "rejected"
    )
    || typeof value.requiredCount !== "number"
    || !Number.isSafeInteger(value.requiredCount)
    || value.requiredCount < 1
    || value.requiredCount > 2
    || typeof value.acceptedCount !== "number"
    || !Number.isSafeInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.requiredCount
    || typeof value.baseRevision !== "number"
    || !Number.isSafeInteger(value.baseRevision)
    || value.baseRevision < 0
    || value.baseRevision > MAX_BASE_REVISION
  ) {
    return null;
  }

  const summary = value.summary;
  if (
    summary !== undefined
    && (
      typeof summary !== "string"
      || summary.length === 0
      || Array.from(summary).length > MAX_SUMMARY_CHARS
      || hasControlCharacter(summary)
    )
  ) {
    return null;
  }

  const surface = value.surface;
  if (
    surface !== undefined
    && (typeof surface !== "string" || !VALID_SURFACES.has(surface))
  ) {
    return null;
  }

  let journey: Record<string, unknown> | undefined;
  if (value.status === "applied") {
    if (
      value.acceptedCount !== value.requiredCount
      || !isRecord(value.journey)
      || value.journey.couple_id !== coupleId
      || typeof value.journey.state_revision !== "number"
      || !Number.isSafeInteger(value.journey.state_revision)
      || value.journey.state_revision < 0
    ) {
      return null;
    }
    journey = value.journey;
  } else if (
    (
      Object.prototype.hasOwnProperty.call(value, "journey")
      && value.journey !== null
    )
    || (
      value.status === "pending_partner"
      && (
        value.requiredCount !== 2
        || value.acceptedCount !== 1
      )
    )
  ) {
    return null;
  }
  return {
    requestId: value.requestId.toLowerCase(),
    status: value.status,
    requiredCount: value.requiredCount,
    acceptedCount: value.acceptedCount,
    baseRevision: value.baseRevision,
    ...(typeof summary === "string" ? { summary } : {}),
    ...(typeof surface === "string" ? { surface } : {}),
    ...(journey ? { journey } : {}),
  };
}

function parseStoredProposal(
  value: unknown,
  result: PlanChangeResult,
): StoredPlanChangeProposal | null {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 5
    || typeof value.base_revision !== "number"
    || !Number.isSafeInteger(value.base_revision)
    || value.base_revision < 0
    || value.base_revision > MAX_BASE_REVISION
    || value.base_revision !== result.baseRevision
    || typeof value.change_digest !== "string"
    || !DISCLOSURE_RECEIPT_PATTERN.test(value.change_digest)
    || typeof value.is_high_impact !== "boolean"
    || typeof value.surface_href !== "string"
    || value.surface_href !== result.surface
    || !isRecord(value.changes)
  ) return null;

  const progressPatch = value.changes.progress_patch;
  const isChecklistSituation = isRecord(progressPatch)
    && Object.prototype.hasOwnProperty.call(progressPatch, CHECKLIST_PROFILE_KEY);
  if (!isChecklistSituation) {
    return {
      proposal: { kind: "other" },
      changeDigest: value.change_digest,
    };
  }

  if (
    value.is_high_impact !== true
    || value.surface_href !== "/schedule"
    || Object.keys(value.changes).length !== 1
    || !Object.prototype.hasOwnProperty.call(value.changes, "progress_patch")
    || !isRecord(progressPatch)
  ) return null;
  const progressKeys = Object.keys(progressPatch);
  if (
    progressKeys.length < 1
    || progressKeys.length > MAX_PROGRESS_KEYS
    || progressKeys.some((key) => !PROGRESS_KEY_PATTERN.test(key))
  ) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(progressPatch)).byteLength > MAX_PROPOSAL_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    proposal: {
      kind: "checklist_situation",
      baseRevision: value.base_revision,
      progressPatch,
    },
    changeDigest: value.change_digest,
  };
}

function serviceErrorText(error: unknown) {
  if (!isRecord(error)) return String(error ?? "");
  return `${String(error.code ?? "")} ${String(error.message ?? "")} ${String(error.details ?? "")}`;
}

function serviceErrorResponse(error: unknown) {
  const text = serviceErrorText(error);
  if (/COUPLE_PLAN_CHANGE_DISCLOSURE_REQUIRED/i.test(text)) {
    return privateResponse(
      {
        error: "변경 전체를 다시 확인한 뒤 동의해 주세요.",
        code: "PLAN_CHANGE_DISCLOSURE_REQUIRED",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_DISCLOSURE_UNEXPECTED/i.test(text)) {
    return privateResponse(
      {
        error: "이 변경 요청에는 확인 영수증을 사용할 수 없어요.",
        code: "PLAN_CHANGE_DISCLOSURE_UNEXPECTED",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_DISCLOSURE_UNAVAILABLE/i.test(text)) {
    return privateResponse(
      {
        error: "변경 전체를 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        code: "PLAN_CHANGE_DISCLOSURE_UNAVAILABLE",
      },
      503,
    );
  }
  if (
    /COUPLE_PLAN_CHANGE_DISCLOSURE_(?:MISMATCH|USED|EXPIRED|CONFLICT)/i
      .test(text)
  ) {
    return privateResponse(
      {
        error: "확인한 변경 원본이 더 이상 최신이 아니에요. 변경 전체를 다시 확인해 주세요.",
        code: "PLAN_CHANGE_DISCLOSURE_CONFLICT",
      },
      409,
    );
  }
  if (/COUPLE_PLAN_CHANGE_(?:NOT_FOUND|JOURNEY_NOT_FOUND)/i.test(text)) {
    return privateResponse(
      {
        error: "변경 요청을 찾을 수 없습니다.",
        code: "PLAN_CHANGE_NOT_FOUND",
      },
      404,
    );
  }
  if (/COUPLE_PLAN_CHANGE_SCOPE_DENIED/i.test(text)) {
    return privateResponse(
      {
        error: "이 변경 요청을 확인할 권한이 없습니다.",
        code: "PLAN_CHANGE_SCOPE_DENIED",
      },
      403,
    );
  }
  if (/COUPLE_PLAN_CHANGE_INVALID/i.test(text)) {
    return privateResponse(
      {
        error: "변경 요청이 올바르지 않습니다.",
        code: "PLAN_CHANGE_INVALID",
      },
      400,
    );
  }
  if (
    /COUPLE_PLAN_CHANGE_(?:STALE|EXPIRED|ALREADY_APPLIED|REJECTED|CONFLICT|ROSTER_CHANGED)/i
      .test(text)
  ) {
    return privateResponse(
      {
        error: "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
        code: "PLAN_CHANGE_CONFLICT",
      },
      409,
    );
  }

  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "unknown";
  console.error("Couple plan-change status RPC failed:", { code });
  return privateResponse(
    {
      error: "변경 요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: "PLAN_CHANGE_UNAVAILABLE",
    },
    503,
  );
}

function resultBody(result: PlanChangeResult) {
  return {
    requestId: result.requestId,
    status: result.status,
    requiredCount: result.requiredCount,
    acceptedCount: result.acceptedCount,
    baseRevision: result.baseRevision,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.surface ? { surface: result.surface } : {}),
    ...(result.journey ? { journey: result.journey } : {}),
  };
}

function staleResponse(result: PlanChangeResult) {
  return privateResponse(
    {
      ...resultBody(result),
      error: "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
      code: "PLAN_CHANGE_STALE",
    },
    409,
  );
}

async function authenticatedContext(
  request: Request,
  scope: "read" | "mutate",
): Promise<AuthResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: privateResponse({ error: "인증이 필요합니다." }, 401) };
  }

  const key = rateLimitKey(
    `couple-plan-change:${scope}`,
    request,
    user.id,
  );
  const limited = scope === "read"
    ? checkRateLimit(key, {
        maxRequests: 60,
        windowMs: 60 * 1000,
      })
    : await checkRateLimitPersistent(
        key,
        {
          maxRequests: 12,
          windowMs: 60 * 1000,
        },
        { failClosed: true },
      );
  if (limited) return { error: privateNoStore(limited) };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();
  if (error) {
    return {
      error: privateResponse({ error: "커플 정보를 확인하지 못했어요." }, 503),
    };
  }
  if (
    !isRecord(profile)
    || typeof profile.couple_id !== "string"
    || !isUuid(profile.couple_id)
  ) {
    return {
      error: privateResponse({ error: "커플 연결이 필요합니다." }, 403),
    };
  }
  return { userId: user.id, coupleId: profile.couple_id };
}

async function parseMutationBody(
  request: Request,
): Promise<MutationBodyResult> {
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return {
      ok: false,
      error: privateResponse(
        {
          error: bodyResult.reason === "too_large"
            ? "요청 데이터가 너무 큽니다."
            : "요청 데이터를 읽지 못했습니다.",
        },
        bodyResult.reason === "too_large" ? 413 : 400,
      ),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    return {
      ok: false,
      error: privateResponse({ error: "잘못된 JSON 요청입니다." }, 400),
    };
  }
  if (!isRecord(body)) {
    return {
      ok: false,
      error: privateResponse(
        { error: "허용되지 않은 요청 항목이 있습니다." },
        400,
      ),
    };
  }
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: true };
  if (
    keys.length === 1
    && keys[0] === "disclosureReceipt"
    && typeof body.disclosureReceipt === "string"
    && DISCLOSURE_RECEIPT_PATTERN.test(body.disclosureReceipt)
  ) {
    return { ok: true, disclosureReceipt: body.disclosureReceipt };
  }
  return {
    ok: false,
    error: privateResponse(
      { error: "허용되지 않은 요청 항목이 있습니다." },
      400,
    ),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    if (!isUuid(requestId)) {
      return privateResponse({ error: "변경 요청 ID가 올바르지 않습니다." }, 400);
    }

    const auth = await authenticatedContext(request, "read");
    if ("error" in auth) return auth.error;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "get_couple_plan_change_status",
      {
        p_request_id: requestId.toLowerCase(),
        p_couple_id: auth.coupleId,
        p_actor_user_id: auth.userId,
      },
    );
    if (error) return serviceErrorResponse(error);

    const result = parsePlanChangeResult(data, auth.coupleId);
    if (!result || result.requestId !== requestId.toLowerCase()) {
      console.error("Couple plan-change status RPC returned an invalid result.");
      return privateResponse(
        {
          error: "변경 요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "PLAN_CHANGE_UNAVAILABLE",
        },
        503,
      );
    }
    if (result.status !== "pending_partner") {
      return privateResponse(resultBody(result));
    }

    const { data: proposalRow, error: proposalError } = await admin
      .from("couple_plan_change_requests")
      .select("base_revision, changes, change_digest, is_high_impact, surface_href")
      .eq("id", result.requestId)
      .eq("couple_id", auth.coupleId)
      .single();
    const storedProposal = proposalError
      ? null
      : parseStoredProposal(proposalRow, result);
    if (!storedProposal) {
      console.error("Couple plan-change proposal could not be disclosed safely.");
      return privateResponse(
        {
          error: "변경 내용을 빠짐없이 확인할 수 없어 승인할 수 없어요. 잠시 후 다시 시도해 주세요.",
          code: "PLAN_CHANGE_DISCLOSURE_UNAVAILABLE",
        },
        503,
      );
    }
    const { proposal, changeDigest } = storedProposal;
    if (proposal.kind === "other") {
      return privateResponse({ ...resultBody(result), proposal });
    }

    const { data: disclosureReceipt, error: disclosureError } = await admin.rpc(
      "issue_checklist_plan_change_disclosure_receipt",
      {
        p_request_id: result.requestId,
        p_couple_id: auth.coupleId,
        p_actor_user_id: auth.userId,
        p_expected_base_revision: proposal.baseRevision,
        p_expected_change_digest: changeDigest,
      },
    );
    if (disclosureError) return serviceErrorResponse(disclosureError);
    if (
      typeof disclosureReceipt !== "string"
      || !DISCLOSURE_RECEIPT_PATTERN.test(disclosureReceipt)
    ) {
      console.error("Checklist disclosure receipt RPC returned an invalid result.");
      return privateResponse(
        {
          error: "변경 내용을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "PLAN_CHANGE_DISCLOSURE_UNAVAILABLE",
        },
        503,
      );
    }
    return privateResponse({
      ...resultBody(result),
      proposal,
      disclosureReceipt,
    });
  } catch (error) {
    console.error("Couple plan-change status API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}

async function mutate(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
  rpcName: "accept_couple_plan_change" | "reject_couple_plan_change",
) {
  try {
    const { requestId } = await context.params;
    if (!isUuid(requestId)) {
      return privateResponse({ error: "변경 요청 ID가 올바르지 않습니다." }, 400);
    }
    if (!isTrustedMutationRequest(request)) {
      return privateResponse({ error: "잘못된 요청 출처입니다." }, 403);
    }

    const body = await parseMutationBody(request);
    if (!body.ok) return body.error;
    if (rpcName === "reject_couple_plan_change" && body.disclosureReceipt) {
      return privateResponse(
        { error: "거절 요청에는 확인 영수증을 사용할 수 없어요." },
        400,
      );
    }

    const auth = await authenticatedContext(request, "mutate");
    if ("error" in auth) return auth.error;

    const rpcArgs = {
      p_request_id: requestId.toLowerCase(),
      p_couple_id: auth.coupleId,
      p_actor_user_id: auth.userId,
      ...(rpcName === "accept_couple_plan_change"
        ? { p_disclosure_receipt: body.disclosureReceipt ?? null }
        : {}),
    };
    const { data, error } = await createAdminClient().rpc(
      rpcName === "accept_couple_plan_change"
        ? "accept_couple_plan_change_with_disclosure"
        : rpcName,
      rpcArgs,
    );
    if (error) return serviceErrorResponse(error);

    const result = parsePlanChangeResult(data, auth.coupleId);
    if (!result || result.requestId !== requestId.toLowerCase()) {
      console.error("Couple plan-change mutation RPC returned an invalid result.");
      return privateResponse(
        {
          error: "변경 요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "PLAN_CHANGE_UNAVAILABLE",
        },
        503,
      );
    }

    if (result.status === "stale") return staleResponse(result);
    if (rpcName === "accept_couple_plan_change") {
      if (result.status === "pending_partner") {
        return privateResponse(resultBody(result), 202);
      }
      if (result.status === "rejected") {
        return privateResponse(
          {
            ...resultBody(result),
            error: "이미 거절된 변경 요청입니다.",
            code: "PLAN_CHANGE_REJECTED",
          },
          409,
        );
      }
      return privateResponse(resultBody(result));
    }

    if (result.status !== "rejected") {
      return privateResponse(
        {
          ...resultBody(result),
          error: "이미 반영되었거나 처리할 수 없는 변경 요청입니다.",
          code: "PLAN_CHANGE_CONFLICT",
        },
        409,
      );
    }
    return privateResponse(resultBody(result));
  } catch (error) {
    console.error("Couple plan-change mutation API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}

export function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutate(request, context, "accept_couple_plan_change");
}

export function DELETE(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return mutate(request, context, "reject_couple_plan_change");
}
