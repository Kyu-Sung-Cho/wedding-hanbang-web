import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { CohortThreadTopic } from "@/types/community.types";

const VALID_THREAD_TOPICS: CohortThreadTopic[] = ["price", "review", "concern", "chat"];

const TOPIC_KEYWORDS: Record<Exclude<CohortThreadTopic, "chat">, string[]> = {
  price: [
    "가격",
    "견적",
    "비용",
    "얼마",
    "추가금",
    "계약금",
    "위약금",
    "할인",
    "결제",
    "대출",
    "예약금",
    "만원",
    "패키지",
    "비싸",
    "저렴",
    "예산",
  ],
  review: [
    "후기",
    "다녀왔",
    "방문",
    "투어",
    "상담받",
    "계약했",
    "추천",
    "비추천",
    "만족",
    "불만",
    "별로",
    "실장",
    "플래너",
  ],
  concern: [
    "고민",
    "걱정",
    "불안",
    "괜찮",
    "어떻게",
    "어때",
    "해야",
    "할까",
    "맞을까",
    "고르",
    "선택",
    "궁금",
    "질문",
  ],
};

function normalizeThreadTopic(topic?: string | null): CohortThreadTopic | null {
  return VALID_THREAD_TOPICS.includes(topic as CohortThreadTopic)
    ? (topic as CohortThreadTopic)
    : null;
}

function inferThreadTopic(content: string): CohortThreadTopic {
  const normalized = content.toLowerCase();
  const scores = Object.entries(TOPIC_KEYWORDS).map(([topic, keywords]) => ({
    topic: topic as Exclude<CohortThreadTopic, "chat">,
    score: keywords.reduce((total, keyword) =>
      normalized.includes(keyword.toLowerCase()) ? total + 1 : total, 0),
  }));
  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.topic : "chat";
}

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
    const topic = normalizeThreadTopic(searchParams.get("thread_topic"));

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

    const threadTopic = normalizeThreadTopic(body.thread_topic) ?? inferThreadTopic(content);

    const { data: inserted, error } = await supabase
      .from("cohort_messages")
      .insert({
        room_id: roomId,
        author_id: user.id,
        content: content.slice(0, 2000),
        thread_topic: threadTopic,
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
