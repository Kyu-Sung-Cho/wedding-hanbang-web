import { NextRequest, NextResponse } from "next/server";
import { log } from "@/utils/log";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const ALLOWED_ACTIONS = ["hide", "restore", "soft_delete"] as const;
type ModerateAction = (typeof ALLOWED_ACTIONS)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuidOrNull(value: unknown) {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isSuccessfulModerationReceipt(
  value: unknown,
  expectedTargetId: string,
  expectedAction: ModerateAction,
  expectedOperationKey: string,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  const original = value.original_outcome;
  const current = value.current_postcondition;
  if (!isRecord(original) || !isRecord(current)) return false;

  if (
    value.ok !== true ||
    value.receipt_version !== 3 ||
    Object.hasOwn(value, "idempotent_replay") ||
    Object.hasOwn(value, "replayed") ||
    typeof value.event_id !== "string" ||
    !UUID_PATTERN.test(value.event_id) ||
    typeof value.notice_id !== "string" ||
    !UUID_PATTERN.test(value.notice_id) ||
    value.operation_key !== expectedOperationKey ||
    value.target_type !== "post" ||
    value.target_id !== expectedTargetId ||
    value.report_id !== null ||
    value.status !== null ||
    value.requested_action !== expectedAction ||
    value.action !== expectedAction ||
    typeof value.content_action !== "string" ||
    typeof value.target_contained !== "boolean" ||
    !isUuidOrNull(value.source_event_id) ||
    typeof original.content_action !== "string" ||
    typeof original.target_contained !== "boolean" ||
    original.report_status !== null ||
    current.target_contained !== value.target_contained ||
    current.superseded !== false ||
    typeof current.causal_head_event_id !== "string" ||
    !UUID_PATTERN.test(current.causal_head_event_id) ||
    !isRecord(current.author_state)
  ) {
    return false;
  }

  const allowedOriginalActions: Record<ModerateAction, readonly string[]> = {
    hide: ["hide", "already_contained"],
    soft_delete: ["soft_delete", "already_contained"],
    restore: ["restore", "retained_containment"],
  };
  if (!allowedOriginalActions[expectedAction].includes(original.content_action)) {
    return false;
  }

  const originalContainmentIsValid = expectedAction === "restore"
    ? original.target_contained ===
      (original.content_action === "retained_containment")
    : original.target_contained === true;
  if (!originalContainmentIsValid) return false;

  if (expectedAction === "restore" && typeof value.source_event_id !== "string") {
    return false;
  }

  return (
    value.content_action === original.content_action &&
    value.target_contained === original.target_contained &&
    current.causal_head_event_id === value.event_id
  );
}

function isSchemaUnavailable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.message?.includes("community_moderate_content") === true
  );
}

/**
 * POST /api/admin/posts/[id]/moderate
 * body: { action: "hide" | "restore" | "soft_delete", reason: string }
 *
 * 조치·콘텐츠 상태·감사 이벤트·작성자 통지는 DB RPC 한 트랜잭션으로 처리한다.
 * 실제 row를 지우는 hard delete는 이 경로에서 허용하지 않는다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized || !adminId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "올바른 게시글 ID가 아닙니다." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json(
        {
          error: "조치 요청 키가 없거나 올바르지 않습니다.",
          code: "COMMUNITY_MODERATION_IDEMPOTENCY_REQUIRED",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const action =
      body && typeof body === "object" && "action" in body
        ? (body.action as string)
        : "";
    const reason =
      body && typeof body === "object" && "reason" in body
        ? String(body.reason).trim()
        : "";

    if (!ALLOWED_ACTIONS.includes(action as ModerateAction)) {
      return NextResponse.json(
        { error: "허용되지 않은 조치입니다." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (reason.length < 3 || reason.length > 2_000) {
      return NextResponse.json(
        { error: "조치 사유를 3자 이상 2,000자 이하로 입력해 주세요." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { data, error } = await getServiceClient().rpc(
      "community_moderate_content" as never,
      {
        p_target_type: "post",
        p_target_id: id,
        p_action: action,
        p_reason: reason,
        p_admin_id: adminId,
        p_idempotency_key: idempotencyKey,
      } as never
    );

    if (error) {
      console.error("[admin moderate] atomic RPC failed:", {
        code: error.code,
        message: error.message,
      });

      if (isSchemaUnavailable(error)) {
        return NextResponse.json(
          {
            error:
              "안전한 조치 기록 기능이 아직 준비되지 않아 변경하지 않았습니다.",
            code: "COMMUNITY_MODERATION_SCHEMA_UNAVAILABLE",
          },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }

      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      if (error.message?.includes("COMMUNITY_MODERATION_RECEIPT")) {
        return NextResponse.json(
          {
            error: "저장된 조치 결과를 안전하게 확인하지 못했습니다.",
            code: "COMMUNITY_MODERATION_INVALID_RECEIPT",
          },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }

      if (error.code === "55000" || error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "다른 안전 조치나 확정된 신고가 있어 이 상태에서는 복구할 수 없습니다.",
            code: "COMMUNITY_MODERATION_CONFLICT",
          },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          error: "조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
          code: "COMMUNITY_MODERATION_FAILED",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (!isSuccessfulModerationReceipt(
      data,
      id,
      action as ModerateAction,
      idempotencyKey,
    )) {
      console.error("[admin moderate] invalid atomic RPC receipt");
      return NextResponse.json(
        {
          error: "조치 결과를 확인하지 못해 완료로 처리하지 않았습니다.",
          code: "COMMUNITY_MODERATION_INVALID_RECEIPT",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, result: data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    log.error("api/admin/posts/[id]/moderate", error);
    console.error("[admin moderate] unexpected:", error);
    return NextResponse.json(
      {
        error: "조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
        code: "COMMUNITY_MODERATION_FAILED",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
