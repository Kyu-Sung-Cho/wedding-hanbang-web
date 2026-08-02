import { NextRequest } from "next/server";
import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { checkAdminMutationRateLimit } from "@/lib/admin/adminReadBoundary";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const ALLOWED_STATUSES = ["pending", "reviewed", "resolved", "dismissed"] as const;
type ReportStatus = (typeof ALLOWED_STATUSES)[number];
const MAX_BODY_BYTES = 2 * 1024;

/**
 * PATCH /api/admin/reports/[id]
 * body: { status: 'reviewed' | 'resolved' | 'dismissed', action?: 'deactivate_member' }
 * 관리자만 — 신고 상태 갱신.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, userId } = await verifyAdmin(request);
    if (!authorized || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await checkAdminMutationRateLimit(
      request,
      userId,
      "report-moderation",
    );
    if (limited) return limited;

    const { id } = await params;
    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = isRecord(bodyResult.value) ? bodyResult.value : {};
    const status = typeof body.status === "string" ? body.status : undefined;
    const action = typeof body.action === "string" ? body.action : undefined;

    if (!status || !ALLOWED_STATUSES.includes(status as ReportStatus)) {
      return NextResponse.json({ error: "잘못된 상태입니다." }, { status: 400 });
    }

    const supabase = getServiceClient();

    if (id.startsWith("member:")) {
      const reportId = id.slice("member:".length);
      if (!reportId) {
        return NextResponse.json({ error: "잘못된 신고 ID입니다." }, { status: 400 });
      }

      const { data: report, error: reportError } = await supabase
        .from("cohort_member_reports")
        .select("room_id, reported_user_id")
        .eq("id", reportId)
        .maybeSingle();

      if (reportError || !report) {
        console.error("[admin/reports PATCH member fetch] error", safeErrorDiagnostic(reportError));
        return NextResponse.json({ error: "멤버 신고를 찾지 못했습니다." }, { status: 404 });
      }

      if (action === "deactivate_member") {
        const { error: memberError } = await supabase
          .from("cohort_members")
          .update({ is_active: false })
          .eq("room_id", report.room_id)
          .eq("user_id", report.reported_user_id);

        if (memberError) {
          console.error("[admin/reports PATCH deactivate] error", safeErrorDiagnostic(memberError));
          return NextResponse.json({ error: "멤버 비활성화에 실패했습니다." }, { status: 500 });
        }

        const { count } = await supabase
          .from("cohort_members")
          .select("id", { count: "exact", head: true })
          .eq("room_id", report.room_id)
          .eq("is_active", true);

        await supabase
          .from("cohort_rooms")
          .update({ member_count: count ?? 0 })
          .eq("id", report.room_id);
      }

      const { error } = await supabase
        .from("cohort_member_reports")
        .update({ status })
        .eq("room_id", report.room_id)
        .eq("reported_user_id", report.reported_user_id);

      if (error) {
        console.error("[admin/reports PATCH member] error", safeErrorDiagnostic(error));
        return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase
      .from("community_reports")
      .update({ status })
      .eq("id", id);

    if (error) {
      console.error("[admin/reports PATCH] error", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/reports PATCH] unexpected", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
