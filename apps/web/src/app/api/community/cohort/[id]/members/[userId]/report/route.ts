import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { sanitizeText } from "@/utils/sanitize";
import type { ReportReason } from "@/types/community.types";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 8 * 1024;

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

    const bodyResult = await readBoundedJsonValue(req, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const body = bodyResult.value as {
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
      console.error("[cohort member report] membership error:", safeErrorDiagnostic(membershipError));
      return NextResponse.json({ error: "동기방 멤버 확인에 실패했습니다." }, { status: 500 });
    }

    const memberIds = new Set((memberships ?? []).map((m) => m.user_id as string));
    if (!memberIds.has(user.id) || !memberIds.has(reportedUserId)) {
      return NextResponse.json(
        { error: "같은 동기방 멤버만 신고할 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: reportResult, error } = await serviceClient.rpc(
      "community_submit_cohort_member_report_for_actor",
      {
        p_actor_id: user.id,
        p_room_id: roomId,
        p_reported_user_id: reportedUserId,
        p_reason: reason,
        p_description: description,
      },
    );

    if (error) {
      if (isCommunityActorWriteDenied(error)) {
        return NextResponse.json(
          { error: COMMUNITY_WRITE_DENIED_MESSAGE },
          { status: 403 },
        );
      }
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 신고한 멤버입니다." }, { status: 409 });
      }
      console.error("[cohort member report] insert error:", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "신고 접수에 실패했습니다." }, { status: 500 });
    }

    const reportCount = isRecord(reportResult)
      && typeof reportResult.report_count === "number"
      && Number.isInteger(reportResult.report_count)
      && reportResult.report_count >= 1
      ? reportResult.report_count
      : null;
    const reviewRequired = isRecord(reportResult)
      && typeof reportResult.review_required === "boolean"
      ? reportResult.review_required
      : null;

    if (reportCount === null || reviewRequired === null) {
      console.error("[cohort member report] RPC returned an invalid result");
      return NextResponse.json(
        { error: "신고 접수 결과를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      reportCount,
      reviewRequired,
    });
  } catch (err) {
    console.error("[cohort member report] unexpected:", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
