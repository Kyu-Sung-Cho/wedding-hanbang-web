import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import type { ReportReason } from "@/types/community.types";
import { canReadCommunityPost } from "@/lib/community/publicPostRules";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

function getServiceClient() {
  return createAdminClient();
}

// 게시글 신고
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
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

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status },
      );
    }

    // Persistent limit: serverless instance rotation must not reset report abuse protection.
    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("community:report", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 },
      { failClosed: true },
    );
    if (rlResult) return rlResult;

    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json(
        { error: "올바른 신고 내용을 입력해 주세요." },
        { status: 400 },
      );
    }
    const body = rawBody as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason : "";
    const rawDetails = typeof body.details === "string" ? body.details : undefined;

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
      "privacy",
      "other",
    ];
    if (!validReasons.includes(reason as ReportReason)) {
      return NextResponse.json(
        { error: "잘못된 신고 사유입니다." },
        { status: 400 }
      );
    }

    const serviceClient = getServiceClient();
    const { data: post, error: postError } = await serviceClient
      .from("community_posts")
      .select("id, author_id, visibility, under_review")
      .eq("id", id)
      .maybeSingle();

    if (postError) {
      return NextResponse.json(
        {
          error: "신고할 게시글의 상태를 안전하게 확인하지 못했어요.",
          code: "COMMUNITY_REPORT_TARGET_UNAVAILABLE",
        },
        { status: 503 },
      );
    }
    if (!post || !canReadCommunityPost(post, { userId: user.id })) {
      return NextResponse.json(
        { error: "게시글을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    if (post.author_id === user.id) {
      return NextResponse.json(
        { error: "자신의 게시글은 신고할 수 없어요. 수정이나 삭제를 이용해 주세요." },
        { status: 400 },
      );
    }

    const { error } = await serviceClient
      .from("community_reports")
      .insert({
        reporter_id: user.id,
        post_id: id,
        comment_id: null,
        reason: reason as ReportReason,
        description: details ?? null,
        status: "pending",
      });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "이미 신고한 게시글입니다.", code: "COMMUNITY_REPORT_DUPLICATE" },
          { status: 409 },
        );
      }
      if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
        return NextResponse.json(
          {
            error: "신고 보호 기능을 안전하게 사용할 수 없어 접수하지 않았어요.",
            code: "COMMUNITY_REPORT_SCHEMA_UNAVAILABLE",
          },
          { status: 503 },
        );
      }
      console.error("Report post error:", error);
      return NextResponse.json(
        { error: "신고 접수에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("api/community/posts/[id]/report", err);
    console.error("Report post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
