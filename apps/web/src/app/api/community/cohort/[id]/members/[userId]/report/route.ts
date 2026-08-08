import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { sanitizeText } from "@/utils/sanitize";
import type { ReportReason } from "@/types/community.types";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const VALID_REASONS: ReportReason[] = [
  "spam",
  "abuse",
  "ad",
  "inappropriate",
  "other",
];

function getServiceClient() {
  return createAdminClient();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id: roomId, userId: reportedUserId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (user.id === reportedUserId) {
      return NextResponse.json({ error: "본인은 신고할 수 없습니다." }, { status: 400 });
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("cohort:member-report", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = (await req.json()) as {
      reason?: ReportReason;
      description?: string;
    };
    const reason = body.reason;
    const description = body.description
      ? sanitizeText(body.description).slice(0, 1000)
      : null;

    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: "신고 사유를 선택해주세요." }, { status: 400 });
    }

    const serviceClient = getServiceClient();
    const { data: memberships, error: membershipError } = await serviceClient
      .from("cohort_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("is_active", true)
      .in("user_id", [user.id, reportedUserId]);

    if (membershipError) {
      console.error("[cohort member report] membership error:", membershipError);
      return NextResponse.json({ error: "동기방 멤버 확인에 실패했습니다." }, { status: 500 });
    }

    const memberIds = new Set((memberships ?? []).map((m) => m.user_id as string));
    if (!memberIds.has(user.id) || !memberIds.has(reportedUserId)) {
      return NextResponse.json(
        { error: "같은 동기방 멤버만 신고할 수 있습니다." },
        { status: 403 }
      );
    }

    const { error } = await serviceClient.from("cohort_member_reports").insert({
      room_id: roomId,
      reporter_id: user.id,
      reported_user_id: reportedUserId,
      reason,
      description,
      status: "pending",
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 신고한 멤버입니다." }, { status: 409 });
      }
      console.error("[cohort member report] insert error:", error);
      return NextResponse.json({ error: "신고 접수에 실패했습니다." }, { status: 500 });
    }

    const { count } = await serviceClient
      .from("cohort_member_reports")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("reported_user_id", reportedUserId)
      .eq("status", "pending");

    return NextResponse.json({
      success: true,
      reportCount: count ?? 1,
      reviewRequired: (count ?? 1) >= 5,
    });
  } catch (err) {
    console.error("[cohort member report] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
