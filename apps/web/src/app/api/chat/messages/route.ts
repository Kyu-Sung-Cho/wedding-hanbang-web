import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

// 사용자가 해당 커플에 속하는지 + role 반환
async function verifyCoupleOwnership(
  userId: string,
  coupleId: string
): Promise<{ ok: boolean; role: string | null }> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: profile } = await admin
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (profile?.couple_id !== coupleId) return { ok: false, role: null };
  return { ok: true, role: (profile?.role as string | null) ?? null };
}

type ClearMode =
  | "view_reset_shared"     // 본인 화면만 정리 (함께 대화 탭) — 안전
  | "delete_shared"         // 둘 다 새로 시작 (함께 대화) — 양쪽 영향
  | "view_reset_private"    // 본인 화면만 정리 (나만 상담)
  | "delete_private";       // 비공개 기록 삭제 (본인만)

// "새 채팅" — clearMode 따라 분기
export async function DELETE(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isDemo = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));

    if (!user && !isDemo) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (isDemo) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    const limited = checkRateLimit(rateLimitKey("chat:messages:delete", request, user!.id), {
      maxRequests: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const coupleId = isUuid(body.coupleId) ? body.coupleId : null;
    const rawMode = typeof body.mode === "string" ? (body.mode as ClearMode) : undefined;

    if (!coupleId) {
      return NextResponse.json({ error: "coupleId가 필요합니다." }, { status: 400 });
    }

    // Backward compat: mode 없으면 옛 방식 (본인 화면만 정리 — 가장 안전한 default)
    const mode: ClearMode = rawMode ?? "view_reset_shared";

    const { ok, role } = await verifyCoupleOwnership(user!.id, coupleId);
    if (!ok) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const now = new Date().toISOString();

    switch (mode) {
      case "view_reset_shared": {
        // 본인 프로필의 timestamp만 업데이트. DB의 메시지는 그대로.
        const { error } = await admin
          .from("profiles")
          .update({ shared_chat_cleared_at: now })
          .eq("id", user!.id);
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt: now });
      }

      case "view_reset_private": {
        const { error } = await admin
          .from("profiles")
          .update({ private_chat_cleared_at: now })
          .eq("id", user!.id);
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt: now });
      }

      case "delete_shared": {
        // 둘 다 새로 시작 — 양쪽 영향. shared 메시지만 삭제 (private은 보존).
        const { count, error } = await admin
          .from("chat_messages")
          .delete({ count: "exact" })
          .eq("couple_id", coupleId)
          .eq("visibility", "shared");
        if (error) throw error;
        return NextResponse.json({ success: true, mode, deleted: count ?? 0 });
      }

      case "delete_private": {
        // 본인 private만 삭제. 상대방 private은 절대 못 건드림.
        if (role !== "bride" && role !== "groom") {
          return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 400 });
        }
        const myVisibility = role === "bride" ? "bride_private" : "groom_private";
        const { count, error } = await admin
          .from("chat_messages")
          .delete({ count: "exact" })
          .eq("couple_id", coupleId)
          .eq("visibility", myVisibility);
        if (error) throw error;
        return NextResponse.json({ success: true, mode, deleted: count ?? 0 });
      }

      default:
        return NextResponse.json({ error: "잘못된 mode 값입니다." }, { status: 400 });
    }
  } catch (err) {
    console.error("메시지 삭제 에러:", err);
    return NextResponse.json(
      { error: "메시지 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
