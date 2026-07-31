import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 8 * 1024;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

// 사용자가 해당 커플에 속하는지 + role 반환
async function verifyCoupleOwnership(
  userId: string,
  coupleId: string
): Promise<{ ok: boolean; role: string | null }> {
  const admin = createAdminClient();
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

    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json(
        {
          error: "요청 출처를 확인할 수 없습니다.",
          code: "UNTRUSTED_MUTATION_REQUEST",
        },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
      );
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

    if (mode === "delete_private") {
      // This authenticated RPC derives auth.uid(), current role and visibility
      // while holding the membership and private-memory scope locks.
      const { data, error } = await supabase.rpc(
        "hard_delete_current_user_private_chat",
        { p_couple_id: coupleId },
      );
      if (error) {
        const denied = error.code === "42501";
        if (!denied) {
          console.error("private chat hard delete RPC failed", {
            code: error.code ?? null,
          });
        }
        return NextResponse.json(
          {
            error: denied
              ? "이 대화를 삭제할 권한이 없습니다."
              : "비공개 대화를 안전하게 삭제하지 못했어요. 다시 시도해 주세요.",
            code: denied
              ? "PRIVATE_CHAT_DELETE_SCOPE_DENIED"
              : "PRIVATE_CHAT_DELETE_FAILED",
          },
          {
            status: denied ? 403 : 503,
            headers: PRIVATE_NO_STORE_HEADERS,
          },
        );
      }
      if (
        !isRecord(data)
        || data.success !== true
        || typeof data.cleared_at !== "string"
        || typeof data.deleted_messages !== "number"
      ) {
        console.error("private chat hard delete RPC returned an invalid result");
        return NextResponse.json(
          {
            error: "비공개 대화 삭제 결과를 확인하지 못했어요.",
            code: "PRIVATE_CHAT_DELETE_INVALID_RESULT",
          },
          { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          success: true,
          mode,
          deleted: data.deleted_messages,
          clearedAt: data.cleared_at,
        },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const { ok } = await verifyCoupleOwnership(user!.id, coupleId);
    if (!ok) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const admin = createAdminClient();

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
        // 공유 기록의 실제 삭제는 양쪽 동의가 필요한 clear-request 흐름만 허용한다.
        return NextResponse.json(
          {
            error: "공유 대화 삭제 방식이 변경되었습니다. 함께 새로 시작하기를 이용해주세요.",
            code: "SHARED_HARD_DELETE_DISABLED",
          },
          { status: 410 },
        );
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
