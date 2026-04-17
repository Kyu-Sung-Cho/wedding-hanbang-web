import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CohortThreadTopic } from "@/types/community.types";

// 멤버 확인 + 없으면 자동 가입
async function ensureMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return true;
  // 자동 가입 시도
  const { error } = await supabase
    .from("cohort_members")
    .upsert({ room_id: roomId, user_id: userId, is_active: true }, { onConflict: "room_id,user_id" });
  return !error;
}

// GET: 최근 50개 메시지 (옵션: thread_topic 필터)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
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

    const member = await ensureMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const topic = searchParams.get("thread_topic");

    let query = supabase
      .from("cohort_messages")
      .select(
        "*"
      )
      .eq("room_id", roomId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (topic) {
      query = query.eq("thread_topic", topic);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Messages GET error:", error);
      return NextResponse.json(
        { error: "메시지를 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    const msgs = (data ?? []).reverse();

    // author 프로필 별도 조회
    const authorIds = [...new Set(msgs.map((m) => m.author_id))];
    let authorMap: Record<string, { user_id: string; nickname: string; avatar_url: string | null; rank: string }> = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", authorIds);
      if (profiles) {
        authorMap = Object.fromEntries(profiles.map((p) => [p.user_id, p]));
      }
    }

    const messagesWithAuthor = msgs.map((m) => ({
      ...m,
      author: authorMap[m.author_id] ?? { user_id: m.author_id, nickname: "익명", avatar_url: null, rank: "sprout" },
    }));

    return NextResponse.json({ messages: messagesWithAuthor });
  } catch (err) {
    console.error("Messages GET error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// POST: 메시지 작성
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
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

    const member = await ensureMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "이 동기방 멤버가 아닙니다." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      content: string;
      thread_topic?: CohortThreadTopic;
      reply_to?: string;
    };

    const content = body.content?.trim();
    if (!content) {
      return NextResponse.json(
        { error: "메시지를 입력해주세요." },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await supabase
      .from("cohort_messages")
      .insert({
        room_id: roomId,
        author_id: user.id,
        content: content.slice(0, 2000),
        thread_topic: body.thread_topic ?? null,
        reply_to: body.reply_to ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Message insert error:", error);
      return NextResponse.json(
        { error: "메시지 전송에 실패했습니다." },
        { status: 500 }
      );
    }

    // author 프로필 조회
    const { data: authorProfile } = await supabase
      .from("community_profiles")
      .select("user_id, nickname, avatar_url, rank")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      message: {
        ...inserted,
        author: authorProfile ?? { user_id: user.id, nickname: "익명", avatar_url: null, rank: "sprout" },
      },
    }, { status: 201 });
  } catch (err) {
    console.error("Message POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
