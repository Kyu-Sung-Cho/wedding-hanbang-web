import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const ALLOWED_STATUSES = ["reviewed", "resolved", "dismissed"] as const;
type ReportStatus = (typeof ALLOWED_STATUSES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function atomicReportError(
  error: { code?: string; message?: string } | null
) {
  const unavailable =
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    error?.message?.includes("community_review_report") === true;

  if (unavailable) {
    return NextResponse.json(
      {
        error:
          "안전한 신고 기록 기능이 아직 준비되지 않아 변경하지 않았습니다.",
        code: "COMMUNITY_REPORT_REVIEW_SCHEMA_UNAVAILABLE",
      },
      { status: 503, headers: { "Retry-After": "60" } }
    );
  }

  if (error?.code === "P0002") {
    return NextResponse.json(
      { error: "신고를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      error: "신고 상태를 기록하지 못해 아무것도 변경하지 않았습니다.",
      code: "COMMUNITY_REPORT_REVIEW_FAILED",
    },
    { status: 500 }
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
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized || !adminId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        { status: 400 }
      );
    }
    if (reason.length < 3 || reason.length > 2_000) {
      return NextResponse.json(
        { error: "검토 사유를 3자 이상 2,000자 이하로 입력해 주세요." },
        { status: 400 }
      );
    }
    if (action && action !== "deactivate_member") {
      return NextResponse.json(
        { error: "허용되지 않은 후속 조치입니다." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    if (id.startsWith("member:")) {
      const reportId = id.slice("member:".length);
      if (!UUID_PATTERN.test(reportId)) {
        return NextResponse.json(
          { error: "올바른 멤버 신고 ID가 아닙니다." },
          { status: 400 }
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
            { status: 503, headers: { "Retry-After": "60" } }
          );
        }
        if (error.code === "P0002") {
          return NextResponse.json(
            { error: "멤버 신고를 찾을 수 없습니다." },
            { status: 404 }
          );
        }
        return NextResponse.json(
          {
            error:
              "동기방 신고 조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
            code: "COHORT_MODERATION_FAILED",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, result: data });
    }

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "올바른 신고 ID가 아닙니다." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc(
      "community_review_report" as never,
      {
        p_report_id: id,
        p_status: status,
        p_reason: reason,
        p_admin_id: adminId,
      } as never
    );

    if (error) {
      console.error("[admin reports] atomic review failed:", {
        code: error.code,
        message: error.message,
      });
      return atomicReportError(error);
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    console.error("[admin reports] unexpected:", error);
    return NextResponse.json(
      {
        error: "신고 상태를 기록하지 못해 아무것도 변경하지 않았습니다.",
        code: "COMMUNITY_REPORT_REVIEW_FAILED",
      },
      { status: 500 }
    );
  }
}
