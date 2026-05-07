import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function hashIp(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex");
}

type ReactionType = "love" | "congrats" | "touched";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const service = getServiceClient();

    const { data: guestbook, error } = await service
      .from("guestbooks")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !guestbook) {
      return NextResponse.json(
        { error: "방명록을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 조회수 증가 (비차단)
    void service
      .from("guestbooks")
      .update({ view_count: (guestbook.view_count ?? 0) + 1 })
      .eq("id", guestbook.id)
      .then(() => {}, () => {});

    const { data: messages } = await service
      .from("guestbook_messages")
      .select("*")
      .eq("guestbook_id", guestbook.id)
      .eq("is_approved", true)
      .order("created_at", { ascending: false })
      .limit(100);

    const msgList = messages ?? [];

    // 리액션 집계 + 호출자 IP가 누른 것 표시
    const messageIds = msgList.map((m: { id: string }) => m.id);
    const reactionMap: Record<
      string,
      { counts: Record<ReactionType, number>; mine: Record<ReactionType, boolean> }
    > = {};

    if (messageIds.length > 0) {
      const callerIpHash = hashIp(req);
      const { data: reactionRows } = await service
        .from("guestbook_message_reactions")
        .select("message_id, reaction_type, ip_hash")
        .in("message_id", messageIds);

      // 빈 카운트 초기화
      for (const id of messageIds) {
        reactionMap[id] = {
          counts: { love: 0, congrats: 0, touched: 0 },
          mine: { love: false, congrats: false, touched: false },
        };
      }

      const rows = (reactionRows ?? []) as Array<{
        message_id: string;
        reaction_type: ReactionType;
        ip_hash: string;
      }>;
      for (const r of rows) {
        const entry = reactionMap[r.message_id];
        if (!entry) continue;
        entry.counts[r.reaction_type] = (entry.counts[r.reaction_type] ?? 0) + 1;
        if (r.ip_hash === callerIpHash) entry.mine[r.reaction_type] = true;
      }
    }

    const messagesWithReactions = msgList.map((m: { id: string }) => ({
      ...m,
      reactions:
        reactionMap[m.id] ?? {
          counts: { love: 0, congrats: 0, touched: 0 },
          mine: { love: false, congrats: false, touched: false },
        },
    }));

    return NextResponse.json({ guestbook, messages: messagesWithReactions });
  } catch (err) {
    console.error("Guestbook GET error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
