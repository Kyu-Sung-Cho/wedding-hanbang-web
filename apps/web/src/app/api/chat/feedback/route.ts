import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cleanOptionalText, isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8 * 1024;

// Service role 클라이언트 (RLS 우회)
function getServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 레이트 리밋: 시간당 20회
async function checkRateLimit(userId: string): Promise<boolean> {
  const admin = getServiceClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("chat_feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);

  return (count ?? 0) < 20;
}

/**
 * POST /api/chat/feedback
 * AI 메시지에 대한 피드백 저장
 */
export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    // 인증 체크
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const messageId = isUuid(body.messageId) ? body.messageId : null;
    const rating = body.rating === "good" || body.rating === "bad" ? body.rating : null;
    const correction = cleanOptionalText(body.correction, 1_000);
    const category = cleanOptionalText(body.category, 80);

    // 필수 필드 검증
    if (!messageId || !rating) {
      return NextResponse.json(
        { error: "messageId와 유효한 rating(good/bad)이 필요합니다." },
        { status: 400 }
      );
    }

    // 레이트 리밋 체크
    const withinLimit = await checkRateLimit(user.id);
    if (!withinLimit) {
      return NextResponse.json(
        { error: "피드백 제한을 초과했습니다. 1시간에 최대 20회까지 가능합니다." },
        { status: 429 }
      );
    }

    const admin = getServiceClient();

    // profile/couple slot을 잠근 DB 함수가 account deletion/private 권한과
    // 대상 AI 메시지를 다시 검증한 뒤 원문 복제 없이 저장한다.
    const { data: feedbackId, error: insertError } = await admin.rpc("save_amora_feedback", {
      p_user_id: user.id,
      p_message_id: messageId,
      p_rating: rating,
      p_correction: correction ?? "",
      p_category: category ?? "",
    });

    if (insertError) {
      console.error("피드백 저장 실패:", insertError.message);
      return NextResponse.json(
        { error: "피드백 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: feedbackId });
  } catch (err) {
    console.error("피드백 API 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat/feedback
 * 커플별 집계된 학습 내용 반환 (채팅 시스템 프롬프트에 주입용)
 */
export async function GET(request: Request) {
  try {
    // 인증 체크
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Raw corrections are never injected into prompts. Keep the compatibility
    // endpoint but return no learned prompt material.
    return NextResponse.json({ lessons: [] });
  } catch (err) {
    console.error("피드백 조회 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
