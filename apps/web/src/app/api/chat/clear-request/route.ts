import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * "둘 다 새로시작" 상호 동의 플로우.
 *
 * 이전 사고: 한 사용자가 누르면 양쪽 DB 가 즉시 삭제돼서 일방적 데이터
 * 손실 위험. 정석은 상대방 동의 후 양쪽 view-reset.
 *
 * - POST { action: "request", coupleId }
 *   → chat_messages 에 clearRequest metadata 가진 시스템 메시지 인서트.
 *     양쪽에 보임 (visibility=shared).
 *
 * - POST { action: "accept", messageId }
 *   → 메시지 metadata 업데이트 (status: accepted, respondedBy, respondedAt)
 *   + 양쪽 profiles.shared_chat_cleared_at = 메시지 created_at 으로 갱신.
 *     이렇게 하면 cleared_at 이전 메시지는 양쪽 화면에서 숨겨짐. DB 원본은
 *     보존돼 영구 삭제 위험 없음.
 *
 * - POST { action: "decline", messageId }
 *   → 메타데이터만 declined 로 변경.
 */

interface ClearRequestMeta {
  type: "shared";
  requestedBy: string;
  requestedByRole?: "bride" | "groom";
  requestedAt: string;
  status: "pending" | "accepted" | "declined";
  respondedBy?: string;
  respondedAt?: string;
}

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("chat:clear-request", request, user.id), {
      maxRequests: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const action = body.action;
    if (action !== "request" && action !== "accept" && action !== "decline") {
      return NextResponse.json({ error: "action 이 필요합니다." }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 본인 프로필 — couple_id, role
    const { data: me } = await admin
      .from("profiles")
      .select("id, couple_id, role")
      .eq("id", user.id)
      .single();
    if (!me) {
      return NextResponse.json({ error: "프로필 없음" }, { status: 404 });
    }
    const myRole = (me.role as "bride" | "groom" | null) ?? null;
    const myCoupleId = me.couple_id as string | null;

    // ── action: request (새 동의 요청 만들기) ─────────────────────────
    if (action === "request") {
      const requestedCoupleId = isUuid(body.coupleId) ? body.coupleId : null;
      if (!requestedCoupleId) {
        return NextResponse.json({ error: "coupleId 가 필요합니다." }, { status: 400 });
      }
      if (myCoupleId !== requestedCoupleId) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }

      const requestedAt = new Date().toISOString();
      const meta: ClearRequestMeta = {
        type: "shared",
        requestedBy: user.id,
        requestedByRole: myRole ?? undefined,
        requestedAt,
        status: "pending",
      };

      const { data: inserted, error } = await admin
        .from("chat_messages")
        .insert({
          couple_id: requestedCoupleId,
          sender_id: user.id,
          sender_type: myRole ?? "bride",
          content: "함께 대화를 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 깨끗하게 정리돼요.",
          visibility: "shared",
          metadata: { clearRequest: meta },
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, message: inserted });
    }

    // ── action: accept | decline (응답) ──────────────────────────────
    const messageId = isUuid(body.messageId) ? body.messageId : null;
    if (!messageId) {
      return NextResponse.json({ error: "messageId 가 필요합니다." }, { status: 400 });
    }

    // 요청 메시지 fetch + 검증
    const { data: reqMsg, error: reqErr } = await admin
      .from("chat_messages")
      .select("id, couple_id, sender_id, created_at, metadata")
      .eq("id", messageId)
      .single();
    if (reqErr || !reqMsg) {
      return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    }
    if (reqMsg.couple_id !== myCoupleId) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    const meta = (reqMsg.metadata as { clearRequest?: ClearRequestMeta } | null)?.clearRequest;
    if (!meta || meta.type !== "shared") {
      return NextResponse.json({ error: "잘못된 요청 메시지입니다." }, { status: 400 });
    }
    if (meta.status !== "pending") {
      return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
    }
    // 본인이 요청자면 응답 불가 (상대방만 응답)
    if (reqMsg.sender_id === user.id) {
      return NextResponse.json(
        { error: "본인이 보낸 요청에는 응답할 수 없어요." },
        { status: 400 }
      );
    }

    const respondedAt = new Date().toISOString();
    const nextStatus = action === "accept" ? "accepted" : "declined";
    const nextMeta: ClearRequestMeta = {
      ...meta,
      status: nextStatus,
      respondedBy: user.id,
      respondedAt,
    };

    // 메시지 metadata 업데이트
    const { error: updateErr } = await admin
      .from("chat_messages")
      .update({
        metadata: { ...((reqMsg.metadata as Record<string, unknown>) ?? {}), clearRequest: nextMeta },
      })
      .eq("id", body.messageId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // accept 면 양쪽 cleared_at 갱신 (요청 메시지의 created_at 기준)
    if (action === "accept") {
      const clearedAt = reqMsg.created_at as string;
      const userIds = [reqMsg.sender_id as string, user.id];
      const { error: profileErr } = await admin
        .from("profiles")
        .update({ shared_chat_cleared_at: clearedAt })
        .in("id", userIds);
      if (profileErr) {
        return NextResponse.json({ error: profileErr.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, action, clearedAt });
    }

    return NextResponse.json({ success: true, action });
  } catch (err) {
    console.error("[clear-request] error:", err);
    return NextResponse.json({ error: "처리 실패" }, { status: 500 });
  }
}
