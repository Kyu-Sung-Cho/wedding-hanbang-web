import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CORRECTION_LENGTH = 2_000;
const FEEDBACK_BODY_KEYS = new Set(["messageId", "rating", "correction", "category"]);
const FEEDBACK_CATEGORIES = new Set([
  "correction",
  "retry",
  "frustration",
  "negative",
  "confusion",
  "disengagement",
]);

type FeedbackRequestBody = {
  messageId: string;
  rating: "good" | "bad";
  correction?: string;
  category?: string;
};

function parseFeedbackRequestBody(body: unknown): FeedbackRequestBody | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FEEDBACK_BODY_KEYS.has(key))) {
    return null;
  }

  if (typeof record.messageId !== "string" || !UUID_PATTERN.test(record.messageId)) {
    return null;
  }
  if (record.rating !== "good" && record.rating !== "bad") {
    return null;
  }
  if (
    record.correction !== undefined
    && (typeof record.correction !== "string" || record.correction.length > MAX_CORRECTION_LENGTH)
  ) {
    return null;
  }
  if (
    record.category !== undefined
    && (typeof record.category !== "string" || !FEEDBACK_CATEGORIES.has(record.category))
  ) {
    return null;
  }

  return {
    messageId: record.messageId,
    rating: record.rating,
    correction: record.correction as string | undefined,
    category: record.category as string | undefined,
  };
}

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
    }

    const body = parseFeedbackRequestBody(rawBody);
    if (!body) {
      return NextResponse.json(
        { error: "피드백 요청 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }
    const { messageId, rating, correction, category } = body;

    // 레이트 리밋 체크
    const withinLimit = await checkRateLimit(user.id);
    if (!withinLimit) {
      return NextResponse.json(
        { error: "피드백 제한을 초과했습니다. 1시간에 최대 20회까지 가능합니다." },
        { status: 429 }
      );
    }

    // 요청 사용자 권한으로 프로필과 메시지를 조회해 RLS를 그대로 적용한다.
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    const coupleId = profile?.couple_id ?? null;

    if (!coupleId) {
      return NextResponse.json(
        { error: "커플에 연결된 사용자만 피드백을 남길 수 있습니다." },
        { status: 403 }
      );
    }

    // 요청한 AI 메시지가 현재 사용자의 RLS 범위에 있는 경우에만 저장한다.
    const { data: msg, error: messageError } = await supabase
      .from("chat_messages")
      .select("sender_type, content, visibility")
      .eq("id", messageId)
      .eq("couple_id", coupleId)
      .single();

    if (messageError || !msg || msg.sender_type !== "ai") {
      return NextResponse.json(
        { error: "피드백을 남길 메시지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (msg.visibility !== "shared") {
      return NextResponse.json(
        { error: "개인 대화 원문은 피드백 저장소에 복사하지 않습니다." },
        { status: 403 }
      );
    }

    const messageContent = msg.content ?? null;

    // 피드백 저장
    const admin = getServiceClient();
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
 * 원문 피드백 학습은 privacy provenance가 생길 때까지 비활성화한다.
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

    return NextResponse.json(
      { lessons: [], learningEnabled: false },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error("피드백 조회 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
