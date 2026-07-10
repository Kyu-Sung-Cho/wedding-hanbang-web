import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  buildWeddingCodeCoupleReportPayload,
  type WeddingCodeStoredResponseForCouple,
} from "@/lib/weddingCode/coupleReport";

export const dynamic = "force-dynamic";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimitPersistent(rateLimitKey("wedding-code-couple-report", request), {
      maxRequests: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const coupleToken = request.nextUrl.searchParams.get("ct");
    if (!isUuid(coupleToken)) {
      return NextResponse.json({ error: "잘못된 초대 링크입니다." }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from("wedding_code_responses")
      .select("created_at, form_version, scoring_version, answers")
      .eq("couple_token", coupleToken)
      .order("created_at", { ascending: true })
      .limit(2);

    if (error) {
      console.error("[wedding-code/couple-report] select 실패:", error.message);
      return NextResponse.json({ error: "비교 리포트를 불러오지 못했어요." }, { status: 500 });
    }

    return NextResponse.json(
      buildWeddingCodeCoupleReportPayload((data ?? []) as WeddingCodeStoredResponseForCouple[])
    );
  } catch (err) {
    console.error("[wedding-code/couple-report] 서버 오류:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

