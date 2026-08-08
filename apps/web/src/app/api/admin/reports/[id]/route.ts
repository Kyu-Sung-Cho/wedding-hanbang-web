import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const ALLOWED_STATUSES = ["reviewed", "resolved", "dismissed"] as const;
type ReportStatus = (typeof ALLOWED_STATUSES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuidOrNull(value: unknown) {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isAtomicReportReceipt(
  data: unknown,
  expectedStatus: ReportStatus,
  expectedReportId: string,
  expectedOperationKey: string,
) {
  if (!isRecord(data)) return false;

  const receipt = data;
  const original = receipt.original_outcome;
  const current = receipt.current_postcondition;
  if (!isRecord(original) || !isRecord(current)) return false;

  if (
    receipt.ok !== true ||
    receipt.receipt_version !== 3 ||
    Object.hasOwn(receipt, "idempotent_replay") ||
    Object.hasOwn(receipt, "replayed") ||
    typeof receipt.event_id !== "string" ||
    !UUID_PATTERN.test(receipt.event_id) ||
    !isUuidOrNull(receipt.notice_id) ||
    receipt.operation_key !== expectedOperationKey ||
    !["post", "comment"].includes(String(receipt.target_type)) ||
    typeof receipt.target_id !== "string" ||
    !UUID_PATTERN.test(receipt.target_id) ||
    receipt.report_id !== expectedReportId ||
    receipt.status !== expectedStatus ||
    receipt.requested_action !== expectedStatus ||
    typeof receipt.content_action !== "string" ||
    typeof receipt.target_contained !== "boolean" ||
    !isUuidOrNull(receipt.source_event_id) ||
    typeof original.content_action !== "string" ||
    typeof original.target_contained !== "boolean" ||
    original.report_status !== expectedStatus ||
    current.target_contained !== receipt.target_contained ||
    current.superseded !== false ||
    typeof current.causal_head_event_id !== "string" ||
    !UUID_PATTERN.test(current.causal_head_event_id) ||
    !isRecord(current.author_state)
  ) {
    return false;
  }

  const originalAction = original.content_action;
  const validOriginalOutcome = (() => {
    if (expectedStatus === "reviewed") {
      return (
        originalAction === "none" &&
        receipt.action === "review_report" &&
        receipt.notice_id === null &&
        receipt.source_event_id === null
      );
    }
    if (expectedStatus === "resolved") {
      return (
        ["hide", "already_contained"].includes(originalAction) &&
        original.target_contained === true &&
        receipt.action === "hide" &&
        typeof receipt.notice_id === "string" &&
        receipt.source_event_id === null
      );
    }
    if (originalAction === "none") {
      return (
        receipt.action === "review_report" &&
        receipt.notice_id === null &&
        receipt.source_event_id === null
      );
    }
    return (
      ["restore", "retained_containment"].includes(originalAction) &&
      original.target_contained === (originalAction === "retained_containment") &&
      receipt.action === "restore" &&
      typeof receipt.notice_id === "string" &&
      typeof receipt.source_event_id === "string"
    );
  })();
  if (!validOriginalOutcome) return false;

  return (
    receipt.content_action === originalAction &&
    receipt.target_contained === original.target_contained &&
    current.causal_head_event_id === receipt.event_id
  );
}

function atomicReportError(
  error: { code?: string; message?: string } | null
) {
  if (error?.message?.includes("COMMUNITY_MODERATION_RECEIPT")) {
    return NextResponse.json(
      {
        error: "저장된 신고 조치 결과를 안전하게 확인하지 못했습니다.",
        code: "COMMUNITY_REPORT_ATOMIC_RECEIPT_INVALID",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const unavailable =
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    error?.message?.includes("community_review_report_atomic") === true;

  if (unavailable) {
    return NextResponse.json(
      {
        error:
          "안전한 신고 기록 기능이 아직 준비되지 않아 변경하지 않았습니다.",
        code: "COMMUNITY_REPORT_REVIEW_SCHEMA_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
      }
    );
  }

  if (error?.code === "P0002") {
    return NextResponse.json(
      { error: "신고를 찾을 수 없습니다." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  if (error?.code === "55000" || error?.code === "23505") {
    return NextResponse.json(
      {
        error: "?좉퀬 ?곹깭媛 ?대? 蹂寃쎈릺?덇굅??媛숈? ?ㅺ? ?ㅻⅨ ?붿껌???ъ슜?섏뿀?듬땲??",
        code: "COMMUNITY_REPORT_REVIEW_CONFLICT",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      error: "신고 상태를 기록하지 못해 아무것도 변경하지 않았습니다.",
      code: "COMMUNITY_REPORT_REVIEW_FAILED",
    },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

/**
 * PATCH /api/admin/reports/[id]
 * body: {
 *   status: "reviewed" | "resolved" | "dismissed",
 *   reason: string,
 *   action?: "deactivate_member"
 * }
 */
export async function PATCH(
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
    const body: unknown = await request.json().catch(() => null);
    const status =
      body && typeof body === "object" && "status" in body
        ? String(body.status)
        : "";
    const reason =
      body && typeof body === "object" && "reason" in body
        ? String(body.reason).trim()
        : "";
    const action =
      body && typeof body === "object" && "action" in body
        ? String(body.action)
        : undefined;

    if (!ALLOWED_STATUSES.includes(status as ReportStatus)) {
      return NextResponse.json(
        { error: "허용되지 않은 신고 상태입니다." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    if (reason.length < 3 || reason.length > 2_000) {
      return NextResponse.json(
        { error: "검토 사유를 3자 이상 2,000자 이하로 입력해 주세요." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    if (action && action !== "deactivate_member") {
      return NextResponse.json(
        { error: "허용되지 않은 후속 조치입니다." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const isMemberReport = id.startsWith("member:");
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (!isMemberReport && !UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json(
        {
          error: "신고 조치 요청 키가 없거나 올바르지 않습니다.",
          code: "COMMUNITY_REPORT_IDEMPOTENCY_REQUIRED",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = getServiceClient();

    if (isMemberReport) {
      const reportId = id.slice("member:".length);
      if (!UUID_PATTERN.test(reportId)) {
        return NextResponse.json(
          { error: "올바른 멤버 신고 ID가 아닙니다." },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const { data, error } = await supabase.rpc(
        "community_review_cohort_member_report" as never,
        {
          p_report_id: reportId,
          p_status: status,
          p_reason: reason,
          p_admin_id: adminId,
          p_deactivate_member: action === "deactivate_member",
        } as never
      );

      if (error) {
        console.error("[admin reports] atomic cohort review failed:", {
          code: error.code,
          message: error.message,
        });
        if (
          error.code === "42883" ||
          error.code === "PGRST202" ||
          error.message?.includes(
            "community_review_cohort_member_report"
          )
        ) {
          return NextResponse.json(
            {
              error:
                "안전한 동기방 신고 기록 기능이 아직 준비되지 않아 변경하지 않았습니다.",
              code: "COHORT_MODERATION_SCHEMA_UNAVAILABLE",
            },
            {
              status: 503,
              headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
            }
          );
        }
        if (error.code === "P0002") {
          return NextResponse.json(
            { error: "멤버 신고를 찾을 수 없습니다." },
            { status: 404, headers: NO_STORE_HEADERS }
          );
        }
        return NextResponse.json(
          {
            error:
              "동기방 신고 조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
            code: "COHORT_MODERATION_FAILED",
          },
          { status: 500, headers: NO_STORE_HEADERS }
        );
      }

      return NextResponse.json(
        { ok: true, result: data },
        { headers: NO_STORE_HEADERS },
      );
    }

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "올바른 신고 ID가 아닙니다." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { data, error } = await supabase.rpc(
      "community_review_report_atomic" as never,
      {
        p_report_id: id,
        p_status: status,
        p_reason: reason,
        p_admin_id: adminId,
        p_idempotency_key: idempotencyKey,
      } as never
    );

    if (error) {
      console.error("[admin reports] atomic review failed:", {
        code: error.code,
        message: error.message,
      });
      return atomicReportError(error);
    }

    if (!isAtomicReportReceipt(
      data,
      status as ReportStatus,
      id,
      idempotencyKey,
    )) {
      console.error("[admin reports] invalid atomic receipt:", {
        reportId: id,
        status,
      });
      return NextResponse.json(
        {
          error:
            "신고 조치의 원자적 처리 결과를 확인할 수 없습니다. 운영자 확인이 필요합니다.",
          code: "COMMUNITY_REPORT_ATOMIC_RECEIPT_INVALID",
        },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: true, result: data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[admin reports] unexpected:", error);
    return NextResponse.json(
      {
        error: "신고 상태를 기록하지 못해 아무것도 변경하지 않았습니다.",
        code: "COMMUNITY_REPORT_REVIEW_FAILED",
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
