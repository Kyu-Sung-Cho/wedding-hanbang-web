// 웨딩코드 페어링 — 토큰 "생성자" 본인의 응답 행에 couple_token을 연결한다.
// (제출 시점엔 토큰이 없고, 결과 화면에서 '상대와 비교해보기'를 눌러야 생성되므로
//  본인 행은 사후 연결이 필요 — 지시서 §6의 설계 공백 보완, 승인됨.)
// response_id(UUID)는 제출자만 아는 capability 역할. PII 없음.
// 규칙: 이미 토큰이 있는 행은 불변(1회성) / 페어 최대 2행 — 초과 토큰은 409.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimitPersistent(rateLimitKey("wedding-code-pair", request), {
      maxRequests: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body) || !isUuid(body.response_id) || !isUuid(body.couple_token)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const responseId = body.response_id as string;
    const coupleToken = body.couple_token as string;

    const admin = getServiceClient();

    // 페어 최대 2행 — 이 토큰이 이미 2행이면 연결 거부
    const { count } = await admin
      .from("wedding_code_responses")
      .select("id", { count: "exact", head: true })
      .eq("couple_token", coupleToken);
    if ((count ?? 0) >= 2) {
      return NextResponse.json({ error: "이 링크는 이미 두 분이 사용했어요." }, { status: 409 });
    }

    // 토큰이 아직 없는 본인 행에만 설정 (불변)
    const { data: updated, error } = await admin
      .from("wedding_code_responses")
      .update({ couple_token: coupleToken })
      .eq("id", responseId)
      .is("couple_token", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[wedding-code/pair] update 실패:", error.message);
      return NextResponse.json({ error: "연결에 실패했습니다." }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "이미 연결됐거나 응답을 찾을 수 없어요." }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[wedding-code/pair] 서버 오류:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
