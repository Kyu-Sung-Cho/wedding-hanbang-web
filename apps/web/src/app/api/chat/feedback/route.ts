import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    // 인증 체크
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const { messageId, rating, correction, category } = body as {
      messageId: string;
      rating: "good" | "bad";
      correction?: string;
      category?: string;
    };

    // 필수 필드 검증
    if (!messageId || !rating || !["good", "bad"].includes(rating)) {
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

    // 사용자의 couple_id 조회
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    const coupleId = profile?.couple_id ?? null;

    // AI 메시지 내용 복사 (컨텍스트 보존용)
    let messageContent: string | null = null;
    if (coupleId) {
      const { data: msg } = await admin
        .from("chat_messages")
        .select("content")
        .eq("id", messageId)
        .eq("couple_id", coupleId)
        .single();

      messageContent = msg?.content ?? null;
    }

    // 피드백 저장
    const { data: feedback, error: insertError } = await admin
      .from("chat_feedback")
      .insert({
        user_id: user.id,
        couple_id: coupleId,
        message_id: messageId,
        rating,
        correction: correction?.trim() || null,
        category: category?.trim() || null,
        message_content: messageContent,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("피드백 저장 실패:", insertError.message);
      return NextResponse.json(
        { error: "피드백 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: feedback?.id });
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

    const admin = getServiceClient();

    // 사용자의 couple_id 조회
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    const coupleId = profile?.couple_id ?? null;

    // feedbackLessons 로드 (내부에서 동일 로직 사용)
    const { loadFeedbackLessons } = await import("@/lib/ai/feedbackLessons");
    const lessons = await loadFeedbackLessons(coupleId);

    return NextResponse.json({ lessons });
  } catch (err) {
    console.error("피드백 조회 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
