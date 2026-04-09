import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CohortThreadTopic } from "@/types/community.types";

async function assertMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET: 최근 50개 메시지 (옵션: thread_topic 필터)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
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

    const member = await assertMember(supabase, roomId, user.id);
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
        "*, author:community_profiles!cohort_messages_author_id_fkey(user_id, nickname, avatar_url, rank)"
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

    return NextResponse.json({ messages: (data ?? []).reverse() });
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

    const member = await assertMember(supabase, roomId, user.id);
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

    const { data, error } = await supabase
      .from("cohort_messages")
      .insert({
        room_id: roomId,
        author_id: user.id,
        content: content.slice(0, 2000),
        thread_topic: body.thread_topic ?? null,
        reply_to: body.reply_to ?? null,
      })
      .select(
        "*, author:community_profiles!cohort_messages_author_id_fkey(user_id, nickname, avatar_url, rank)"
      )
      .single();

    if (error) {
      console.error("Message insert error:", error);
      return NextResponse.json(
        { error: "메시지 전송에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (err) {
    console.error("Message POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
