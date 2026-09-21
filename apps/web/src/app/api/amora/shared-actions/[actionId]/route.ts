import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { parseAuthorizationHeader } from "@/utils/bearerAuthorization";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2 * 1024;
const POST_KEYS = new Set(["messageId", "expectedActorId"]);

type ApprovalStatus = {
  approvalMode: "couple";
  accepted: boolean;
  acceptedCount: number;
  requiredCount: 1 | 2;
  partnerLinked: boolean;
  ready: boolean;
};
type ApplicationClaimStatus = {
  applicationGranted: boolean;
  retryAfterMs: number;
};
type RequestAuthContext = { userId: string; coupleId: string };
type RequestAuthResult = RequestAuthContext | { error: NextResponse };
type ScopedActionContext = RequestAuthContext & {
  actionId: string;
  messageId: string;
};
type ScopedActionResult = ScopedActionContext | { error: NextResponse };

function parseApprovalStatus(value: unknown): ApprovalStatus | null {
  if (!isRecord(value) || value.approvalMode !== "couple") return null;
  if (
    typeof value.accepted !== "boolean"
    || !Number.isInteger(value.acceptedCount)
    || (value.acceptedCount as number) < 0
    || (value.requiredCount !== 1 && value.requiredCount !== 2)
    || (value.acceptedCount as number) > value.requiredCount
    || typeof value.partnerLinked !== "boolean"
    || typeof value.ready !== "boolean"
  ) {
    return null;
  }
  return {
    approvalMode: "couple",
    accepted: value.accepted,
    acceptedCount: value.acceptedCount as number,
    requiredCount: value.requiredCount,
    partnerLinked: value.partnerLinked,
    ready: value.ready,
  };
}

function parseApplicationClaimStatus(
  value: unknown,
): ApplicationClaimStatus | null {
  if (
    !isRecord(value)
    || typeof value.applicationGranted !== "boolean"
    || !Number.isInteger(value.retryAfterMs)
    || (value.retryAfterMs as number) < 0
    || (value.retryAfterMs as number) > 60_000
  ) {
    return null;
  }
  return {
    applicationGranted: value.applicationGranted,
    retryAfterMs: value.retryAfterMs as number,
  };
}

function approvalError(error: { code?: string; message?: string } | null) {
  const failure = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (
    failure.includes("AMORA_SHARED_ACTION_PROPOSAL_CHANGED")
    || failure.includes("AMORA_SHARED_ACTION_ROSTER_CHANGED")
    || failure.includes("AMORA_SHARED_ACTION_STALE_CONTEXT")
  ) {
    return NextResponse.json(
      {
        error: "그 사이 내용이 바뀌어 아무것도 반영하지 않았어요. 최신 제안을 다시 확인해 주세요.",
        code: "AMORA_SHARED_ACTION_PROPOSAL_CHANGED",
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (failure.includes("AMORA_SHARED_ACTION_EXPIRED")) {
    return NextResponse.json(
      {
        error: "확인 시간이 지나 아무것도 변경하지 않았어요. 아모라에게 다시 제안해 달라고 해주세요.",
        code: "AMORA_SHARED_ACTION_EXPIRED",
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (failure.includes("AMORA_SHARED_ACTION_APPROVAL_REQUIRED")) {
    return NextResponse.json(
      {
        error: "두 분의 확인이 모두 끝나기 전이라 아직 반영을 시작하지 않았어요.",
        code: "AMORA_SHARED_ACTION_APPROVAL_REQUIRED",
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (failure.includes("AMORA_SHARED_ACTION_SCOPE_DENIED")) {
    return NextResponse.json(
      { error: "이 변경을 확인할 권한이 없습니다.", code: "AMORA_SHARED_ACTION_SCOPE_DENIED" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (failure.includes("AMORA_SHARED_ACTION_ALREADY_APPLIED")) {
    return NextResponse.json(
      {
        error: "이미 반영된 변경이라 확인 기록을 취소할 수 없어요.",
        code: "AMORA_SHARED_ACTION_ALREADY_APPLIED",
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    {
      error: "공동 확인 상태를 안전하게 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: "AMORA_SHARED_ACTION_UNAVAILABLE",
    },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

async function requestContext(request: Request): Promise<RequestAuthResult> {
  const supabase = await createClientFromRequest(request);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || !UUID_PATTERN.test(user.id)) {
    return {
      error: NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();
  if (error) {
    return {
      error: NextResponse.json(
        { error: "커플 정보를 확인하지 못했어요." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  if (!profile?.couple_id) {
    return {
      error: NextResponse.json(
        { error: "커플 연결이 필요합니다." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  return { userId: user.id, coupleId: profile.couple_id as string };
}

function actorBoundary(request: Request, supplied: boolean, expectedActorId: unknown, actualActorId: string, readOnly = false) {
  // 구버전 앱의 인증된 읽기만 호환한다. 쓰기는 Bearer라도 누른 화면 주체가 반드시 필요하다.
  // 쿠키의 암묵적 현재 계정이나 명시한 null/잘못된 UUID를 호환 경로로 추정하지 않는다.
  if (readOnly && !supplied && parseAuthorizationHeader(request.headers.get("authorization")).kind === "bearer") return null;
  const reason = !supplied ? "actor_required"
    : typeof expectedActorId !== "string" || !UUID_PATTERN.test(expectedActorId) ? "actor_invalid"
      : expectedActorId.toLowerCase() !== actualActorId.toLowerCase() ? "actor_changed" : null;
  if (!reason) return null;
  return NextResponse.json({ code: "AMORA_SHARED_ACTION_ACTOR_CHANGED", reason,
    error: "로그인 상태를 다시 확인해야 해요. 현재 계정으로 화면을 새로 열어 제안을 확인해 주세요. 앱에서는 최신 버전으로 업데이트한 뒤 다시 확인해 주세요.",
  }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

async function identifiers(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
  messageId: unknown,
): Promise<ScopedActionResult> {
  const { actionId } = await context.params;
  if (
    !UUID_PATTERN.test(actionId)
    || typeof messageId !== "string"
    || !UUID_PATTERN.test(messageId)
  ) {
    return {
      error: NextResponse.json(
        { error: "변경 식별자가 올바르지 않습니다." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  const auth = await requestContext(request);
  if ("error" in auth) return auth;
  return {
    actionId: actionId.toLowerCase(),
    messageId: messageId.toLowerCase(),
    ...auth,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  const params = new URL(request.url).searchParams;
  const messageId = params.get("messageId");
  const scoped = await identifiers(request, context, messageId);
  if ("error" in scoped) return scoped.error;
  const actorError = actorBoundary(request, params.has("expectedActorId"),
    params.getAll("expectedActorId").length === 1 ? params.get("expectedActorId") : undefined, scoped.userId, true);
  if (actorError) return actorError;

  const { data, error } = await createAdminClient().rpc(
    "get_amora_shared_action_status",
    {
      p_action_id: scoped.actionId,
      p_couple_id: scoped.coupleId,
      p_source_message_id: scoped.messageId,
      p_user_id: scoped.userId,
    },
  );
  if (error) return approvalError(error);
  const status = parseApprovalStatus(data);
  if (!status) return approvalError(null);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function mutateApproval(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
  rpcName:
    | "accept_amora_shared_action"
    | "revoke_amora_shared_action_acceptance"
    | "claim_amora_shared_action_application",
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      {
        error: bodyResult.reason === "too_large"
          ? "요청 데이터가 너무 큽니다."
          : "요청 데이터를 읽지 못했습니다.",
      },
      {
        status: bodyResult.reason === "too_large" ? 413 : 400,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text) as unknown;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (
    !isRecord(body)
    || Object.keys(body).some((key) => !POST_KEYS.has(key))
  ) {
    return NextResponse.json(
      { error: "허용되지 않은 요청 항목이 있습니다." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const scoped = await identifiers(request, context, body.messageId);
  if ("error" in scoped) return scoped.error;
  const actorError = actorBoundary(request, Object.hasOwn(body, "expectedActorId"), body.expectedActorId, scoped.userId);
  if (actorError) return actorError;

  const limited = checkRateLimit(
    rateLimitKey("amora:shared-action", request, scoped.userId),
    { maxRequests: 20, windowMs: 60 * 1000 },
  );
  if (limited) return limited;

  const { data, error } = await createAdminClient().rpc(
    rpcName,
    {
      p_action_id: scoped.actionId,
      p_couple_id: scoped.coupleId,
      p_source_message_id: scoped.messageId,
      p_user_id: scoped.userId,
    },
  );
  if (error) return approvalError(error);
  if (rpcName === "claim_amora_shared_action_application") {
    const claim = parseApplicationClaimStatus(data);
    if (!claim) return approvalError(null);
    return NextResponse.json(claim, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const status = parseApprovalStatus(data);
  if (!status) return approvalError(null);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  return mutateApproval(request, context, "accept_amora_shared_action");
}

export function DELETE(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  return mutateApproval(
    request,
    context,
    "revoke_amora_shared_action_acceptance",
  );
}

export function PUT(
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) {
  return mutateApproval(
    request,
    context,
    "claim_amora_shared_action_application",
  );
}
