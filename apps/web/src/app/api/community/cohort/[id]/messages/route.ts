import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import type { CohortThreadTopic } from "@/types/community.types";
import {
  normalizeCohortThreadTopic,
  resolveCohortThreadTopic,
} from "@/lib/community/cohortTopicClassifier";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";

const MAX_BODY_BYTES = 8 * 1024;

async function ensureActiveMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 동기방 ID입니다." }, { status: 400 });
    }
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const topic = normalizeCohortThreadTopic(searchParams.get("thread_topic"));

    let query = supabase
      .from("cohort_messages")
      .select("*")
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
        { error: "메시지를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const msgs = (data ?? []).reverse();
    const authorIds = [...new Set(msgs.map((m) => m.author_id as string))];
    let authorMap: Record<
      string,
      { user_id: string; nickname: string; avatar_url: string | null; rank: string }
    > = {};

    if (authorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("community_profiles")
        .select("user_id, nickname, avatar_url, rank")
        .in("user_id", authorIds);

      if (profiles) {
        authorMap = Object.fromEntries(
          profiles.map((profile) => [profile.user_id as string, profile])
        );
      }
    }

    const messagesWithAuthor = msgs.map((message) => ({
      ...message,
      author: authorMap[message.author_id as string] ?? {
        user_id: message.author_id,
        nickname: "익명",
        avatar_url: null,
        rank: "sprout",
      },
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 동기방 ID입니다." }, { status: 400 });
    }
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const writeAccess = await checkCommunityWriteAccess(supabase, user.id);
    if (!writeAccess.allowed) {
      return NextResponse.json(
        { error: writeAccess.message, code: writeAccess.code },
        { status: writeAccess.status }
      );
    }

    const limited = checkRateLimit(rateLimitKey("cohort:message:create", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const body = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const content = typeof body.content === "string"
      ? body.content.replace(/\0/g, "").trim().slice(0, 2000)
      : "";
    if (!content) {
      return NextResponse.json(
        { error: "메시지를 입력해주세요." },
        { status: 400 }
      );
    }

    const threadTopic = resolveCohortThreadTopic(
      typeof body.thread_topic === "string"
        ? (body.thread_topic as CohortThreadTopic)
        : undefined,
      content
    );
    const replyTo = typeof body.reply_to === "string" && isUuid(body.reply_to)
      ? body.reply_to
      : null;

    const { data: inserted, error } = await supabase
      .from("cohort_messages")
      .insert({
        room_id: roomId,
        author_id: user.id,
        content,
        thread_topic: threadTopic,
        reply_to: replyTo,
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

    const { data: authorProfile } = await supabase
      .from("community_profiles")
      .select("user_id, nickname, avatar_url, rank")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json(
      {
        message: {
          ...inserted,
          author: authorProfile ?? {
            user_id: user.id,
            nickname: "익명",
            avatar_url: null,
            rank: "sprout",
          },
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Message POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
