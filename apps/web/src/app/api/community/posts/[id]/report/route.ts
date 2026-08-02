import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import type { ReportReason } from "@/types/community.types";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

const MAX_BODY_BYTES = 8 * 1024;

function getServiceClient() {
  return createAdminClient();
}

// 게시글 신고
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 5 reports per hour per user
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:report", req, user.id),
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
    const { reason, details: rawDetails } = bodyResult.value as {
      reason: ReportReason;
      details?: string;
    };

    // details 정화
    const details = rawDetails
      ? sanitizeText(rawDetails).slice(0, 1000)
      : undefined;

    if (!reason) {
      return NextResponse.json(
        { error: "신고 사유를 선택해주세요." },
        { status: 400 }
      );
    }

    const validReasons: ReportReason[] = [
      "spam",
      "abuse",
      "ad",
      "inappropriate",
      "other",
    ];
    if (!validReasons.includes(reason)) {
      return NextResponse.json(
        { error: "잘못된 신고 사유입니다." },
        { status: 400 }
      );
    }

    const serviceClient = getServiceClient();

    // The service-role INSERT below must never turn a guessed hidden/draft ID
    // into a report. Resolve internally, then apply the caller's visibility
    // rule without projecting the internal author UUID through PostgREST.
    const { data: targetPost, error: targetError } = await serviceClient
      .from("community_posts")
      .select("author_id, visibility, under_review")
      .eq("id", id)
      .maybeSingle();

    if (targetError) {
      console.error("Report target access error:", safeErrorDiagnostic(targetError));
      return NextResponse.json(
        { error: "신고 대상을 확인하지 못했습니다." },
        { status: 500 }
      );
    }

    if (!targetPost || !canReadCommunityPost(targetPost, { userId: user.id })) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없거나 접근 권한이 없습니다." },
        { status: 404 }
      );
    }

    if (targetPost.author_id === user.id) {
      return NextResponse.json(
        { error: "본인 게시글은 신고할 수 없습니다." },
        { status: 400 }
      );
    }

    // 중복 신고 확인 — community_reports 스키마: post_id 또는 comment_id (XOR)
    const { data: existingReport } = await serviceClient
      .from("community_reports")
      .select("id")
      .eq("reporter_id", user.id)
      .eq("post_id", id)
      .maybeSingle();

    if (existingReport) {
      return NextResponse.json(
        { error: "이미 신고한 게시글입니다." },
        { status: 409 }
      );
    }

    const { data: reportResult, error } = await serviceClient.rpc(
      "community_submit_post_report_for_actor",
      {
        p_actor_id: user.id,
        p_post_id: id,
        p_reason: reason,
        p_description: details ?? null,
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
        return NextResponse.json(
          { error: "이미 신고한 게시글입니다." },
          { status: 409 }
        );
      }
      console.error("Report post error:", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "신고 접수에 실패했습니다." },
        { status: 500 }
      );
    }

    if (!isRecord(reportResult) || reportResult.success !== true) {
      console.error("Report post RPC returned an invalid result");
      return NextResponse.json(
        { error: "신고 접수 결과를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Report post error:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
