import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

const ALLOWED_STATUSES = ["pending", "reviewed", "resolved", "dismissed"] as const;
type ReportStatus = (typeof ALLOWED_STATUSES)[number];

/**
 * PATCH /api/admin/reports/[id]
 * body: { status: 'reviewed' | 'resolved' | 'dismissed' }
 * 관리자만 — 신고 상태 갱신.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body?.status as string | undefined;

    if (!status || !ALLOWED_STATUSES.includes(status as ReportStatus)) {
      return NextResponse.json({ error: "잘못된 상태입니다." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { error } = await supabase
      .from("community_reports")
      .update({ status })
      .eq("id", id);

    if (error) {
      console.error("[admin/reports PATCH] error:", error);
      return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/reports PATCH] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
