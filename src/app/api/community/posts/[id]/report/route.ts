import { createClient } from "@/lib/supabase/server";
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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 10 reports per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:report", req, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const { reason, description: rawDescription } = (await req.json()) as {
      reason: ReportReason;
      description?: string;
    };

    // description 정화
    const description = rawDescription
      ? sanitizeText(rawDescription).slice(0, 1000)
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

    // 중복 신고 확인
    const { data: existingReport } = await serviceClient
      .from("community_reports")
      .select("id")
      .eq("reporter_id", user.id)
      .eq("target_type", "post")
      .eq("target_id", id)
      .maybeSingle();

    if (existingReport) {
      return NextResponse.json(
        { error: "이미 신고한 게시글입니다." },
        { status: 409 }
      );
    }

    const { error } = await serviceClient
      .from("community_reports")
      .insert({
        reporter_id: user.id,
        target_type: "post",
        target_id: id,
        reason,
        description: description ?? null,
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
