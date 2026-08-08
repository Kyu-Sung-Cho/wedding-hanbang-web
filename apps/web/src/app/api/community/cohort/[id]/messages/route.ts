import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import type { CohortThreadTopic } from "@/types/community.types";
import {
  normalizeCohortThreadTopic,
  resolveCohortThreadTopic,
} from "@/lib/community/cohortTopicClassifier";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 8 * 1024;

function getServiceClient() {
  return createAdminClient();
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
        .from("community_public_profiles")
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
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { id: roomId } = await params;
    if (!isUuid(roomId)) {
      return NextResponse.json({ error: "잘못된 동기방 ID입니다." }, { status: 400 });
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!isUuid(idempotencyKey)) {
      return NextResponse.json(
        { error: "메시지 요청 식별자가 필요합니다." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
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

    const limited = await checkRateLimitPersistent(rateLimitKey("cohort:message:create", req, user.id), {
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

    const rawBody = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        {
          status: rawBody.reason === "too_large" ? 413 : 400,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.text);
    } catch {
      return NextResponse.json(
        { error: "잘못된 요청입니다." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (Object.keys(body).some(
      (key) => !["content", "thread_topic", "reply_to"].includes(key),
    )) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const content = typeof body.content === "string"
      ? body.content.replace(/\0/g, "").trim()
      : "";
    if (!content || Array.from(content).length > 2000) {
      return NextResponse.json(
        { error: content ? "메시지는 2,000자 이하로 입력해 주세요." : "메시지를 입력해주세요." },
        { status: 400 }
      );
    }

    const threadTopic = resolveCohortThreadTopic(
      typeof body.thread_topic === "string"
        ? (body.thread_topic as CohortThreadTopic)
        : undefined,
      content
    );
    if (
      body.reply_to !== undefined
      && body.reply_to !== null
      && !isUuid(body.reply_to)
    ) {
      return NextResponse.json({ error: "답장 대상을 확인해 주세요." }, { status: 400 });
    }
    const replyTo = typeof body.reply_to === "string" ? body.reply_to : null;

    const serviceClient = getServiceClient();
    const { data: inserted, error } = await serviceClient.rpc(
      "community_create_cohort_message",
      {
        p_user_id: user.id,
        p_room_id: roomId,
        p_client_request_id: idempotencyKey,
        p_content: content,
        p_thread_topic: threadTopic,
        p_reply_to: replyTo,
      },
    );

    if (
      error
      || !isRecord(inserted)
      || !isUuid(inserted.id)
      || inserted.room_id !== roomId
      || inserted.author_id !== user.id
      || inserted.content !== content
      || typeof inserted.replayed !== "boolean"
    ) {
      console.error("Atomic cohort message error:", error);
      const status = error?.code === "22023" || error?.code === "23503" ? 409 : 503;
      return NextResponse.json(
        {
          error: status === 409
            ? "같은 전송 요청의 내용이 달라 저장하지 않았습니다. 새로고침 후 다시 보내 주세요."
            : "메시지 전송 결과를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const { data: authorProfile } = await supabase
      .from("community_public_profiles")
      .select("user_id, nickname, avatar_url, rank")
      .eq("user_id", user.id)
      .maybeSingle();

    const { replayed, ...messageRow } = inserted;
    return NextResponse.json(
      {
        message: {
          ...messageRow,
          author: authorProfile ?? {
            user_id: user.id,
            nickname: "익명",
            avatar_url: null,
            rank: "sprout",
          },
        },
        replayed,
      },
      {
        status: replayed ? 200 : 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (err) {
    console.error("Message POST error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
