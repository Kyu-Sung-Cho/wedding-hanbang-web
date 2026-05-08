import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeText } from "@/utils/sanitize";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import type { ReportReason } from "@/types/community.types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
    const rlResult = checkRateLimit(
      rateLimitKey("community:report", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { reason, details: rawDetails } = (await req.json()) as {
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

    // 스키마 컬럼: reporter_id, post_id, reason, description, status
    // (이전 코드가 존재하지 않는 target_type/target_id, 잘못된 details 컬럼 INSERT 시도해서 500)
    const { error } = await serviceClient
      .from("community_reports")
      .insert({
        reporter_id: user.id,
        post_id: id,
        reason,
        description: details ?? null,
        status: "pending",
      });

    if (error) {
      console.error("Report post error:", error);
      return NextResponse.json(
        { error: "신고 접수에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Report post error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
