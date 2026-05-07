import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

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

const REACTION_TYPES = ["love", "congrats", "touched"] as const;
type ReactionType = (typeof REACTION_TYPES)[number];

/**
 * POST: 익명 토글 — 같은 IP+메시지+타입 조합에 row 있으면 삭제, 없으면 추가
 * Returns updated counts + whether the requester now has each reaction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params;
    if (!messageId) {
      return NextResponse.json({ error: "메시지 ID가 필요합니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const reaction = body?.reaction as string | undefined;
    if (!reaction || !REACTION_TYPES.includes(reaction as ReactionType)) {
      return NextResponse.json({ error: "잘못된 리액션입니다." }, { status: 400 });
    }
    const reactionType = reaction as ReactionType;

    // Rate limit: 30/분/IP — 가벼운 인터랙션이라 너그럽게
    const rl = checkRateLimit(rateLimitKey("guestbook:reaction", req), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (rl) return rl;

    const service = getServiceClient();
    const ipHash = hashIp(req);

    // 메시지 존재 검증 (부모 방명록 활성 여부도)
    const { data: msg } = await service
      .from("guestbook_messages")
      .select("id, guestbook_id")
      .eq("id", messageId)
      .maybeSingle();

    if (!msg) {
      return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
    }

    // 토글
    const { data: existing } = await service
      .from("guestbook_message_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("reaction_type", reactionType)
      .eq("ip_hash", ipHash)
      .maybeSingle();

    if (existing) {
      await service
        .from("guestbook_message_reactions")
        .delete()
        .eq("id", existing.id);
    } else {
      await service
        .from("guestbook_message_reactions")
        .insert({
          message_id: messageId,
          reaction_type: reactionType,
          ip_hash: ipHash,
        });
    }

    // 업데이트된 카운트 + 내 리액션 상태 조회
    const { data: allRows } = await service
      .from("guestbook_message_reactions")
      .select("reaction_type, ip_hash")
      .eq("message_id", messageId);

    const rows = (allRows ?? []) as Array<{ reaction_type: ReactionType; ip_hash: string }>;
    const counts: Record<ReactionType, number> = { love: 0, congrats: 0, touched: 0 };
    const mine: Record<ReactionType, boolean> = { love: false, congrats: false, touched: false };
    for (const r of rows) {
      counts[r.reaction_type] = (counts[r.reaction_type] ?? 0) + 1;
      if (r.ip_hash === ipHash) mine[r.reaction_type] = true;
    }

    return NextResponse.json({ counts, mine });
  } catch (err) {
    console.error("[guestbook reactions] error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
