// 웨딩코드 스모크 응답 수집 — 익명 공개 쓰기.
// PII 없음(이메일·이름·전화 미수집)이라 Turnstile은 생략하고, persistent IP rate limit +
// 엄격한 스키마 검증으로 오염을 막는다. 채점·가중치 계산은 하지 않는다(가드레일).

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { validateWcSubmission } from "@/lib/weddingCode/validate";
import { WEDDING_CODE_FORM_VERSION } from "@/constants/weddingCodeForm";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const limited = await checkRateLimitPersistent(rateLimitKey("wedding-code", request), {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const result = validateWcSubmission(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const data = result.data;

    const { error } = await getServiceClient().from("wedding_code_responses").insert({
      form_version: WEDDING_CODE_FORM_VERSION,
      participant_stage: data.participant_stage,
      answering_mode: data.answering_mode,
      quote_status: data.quote_status,
      parent_involvement: data.parent_involvement,
      biggest_concern: data.biggest_concern,
      biggest_concern_other: data.biggest_concern_other,
      answers: data.answers,
      stage_flags: data.stage_flags,
      feedback: data.feedback,
      cta_interest: data.cta_interest,
      free_text: data.free_text,
      duration_ms: data.duration_ms,
      utm_source: data.utm.source,
      utm_medium: data.utm.medium,
      utm_campaign: data.utm.campaign,
      utm_content: data.utm.content,
    });

    if (error) {
      console.error("[wedding-code] insert 실패:", error.message);
      return NextResponse.json({ error: "저장에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[wedding-code] 서버 오류:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
