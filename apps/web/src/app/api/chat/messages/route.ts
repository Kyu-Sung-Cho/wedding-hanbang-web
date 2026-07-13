import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "메시지가 너무 깁니다." }, { status: 413 });
    }
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const limited = await checkRateLimitPersistent(rateLimitKey("chat:messages:create", request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    }, user.id);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body) || !isUuid(body.coupleId) || typeof body.content !== "string") {
      return NextResponse.json({ error: "메시지 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const content = body.content.trim();
    if (!content || new TextEncoder().encode(content).byteLength > 12_000) {
      return NextResponse.json({ error: "메시지가 너무 깁니다." }, { status: 413 });
    }
    const visibility = body.visibility === "bride_private" || body.visibility === "groom_private"
      ? body.visibility
      : "shared";
    const target = body.target === "partner" ? "partner" : null;
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await admin.rpc("insert_amora_user_message", {
      p_user_id: user.id,
      p_couple_id: body.coupleId,
      p_content: content,
      p_visibility: visibility,
      p_target: target,
    });
    if (error || !isRecord(data)) {
      return NextResponse.json({ error: "메시지 전송에 실패했습니다." }, { status: 409 });
    }
    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error) {
    console.error("메시지 저장 에러:", error);
    return NextResponse.json({ error: "메시지 전송에 실패했습니다." }, { status: 500 });
  }
}

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

    let isLifecycleContinuation = false;
    if (mode === "delete_private") {
      const { data: lifecycle } = await admin
        .from("profiles")
        .select("private_chat_deleting_at")
        .eq("id", user!.id)
        .maybeSingle();
      isLifecycleContinuation = Boolean(lifecycle?.private_chat_deleting_at);
    }
    if (!isLifecycleContinuation) {
      const limited = checkRateLimit(rateLimitKey("chat:messages:delete", request, user!.id), {
        maxRequests: 10,
        windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;
    }

    switch (mode) {
      case "view_reset_shared": {
        const { data: clearedAt, error } = await admin.rpc("reset_my_amora_chat_view", {
          p_user_id: user!.id,
          p_couple_id: coupleId,
          p_visibility: "shared",
        });
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt });
      }

      case "view_reset_private": {
        if (role !== "bride" && role !== "groom") {
          return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 400 });
        }
        const privateVisibility = role === "bride" ? "bride_private" : "groom_private";
        const { data: clearedAt, error } = await admin.rpc("reset_my_amora_chat_view", {
          p_user_id: user!.id,
          p_couple_id: coupleId,
          p_visibility: privateVisibility,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, mode, clearedAt });
      }

      case "delete_shared": {
        // 물리 삭제는 상대방 동의를 API에서 원자 검증할 수 있을 때까지 금지한다.
        // 현재 동의 플로우는 양쪽 cleared_at만 갱신하는 안전한 view-reset이다.
        return NextResponse.json(
          { error: "공유 대화 물리 삭제는 지원하지 않습니다. 동의 요청을 통해 양쪽 화면을 정리해주세요." },
          { status: 409 }
        );
      }

      case "delete_private": {
        // 본인 private만 원자 삭제. 역할/visibility 소유권은 DB 함수가 같은
        // 트랜잭션에서 다시 검증하므로 상대방 private은 건드릴 수 없다.
        if (role !== "bride" && role !== "groom") {
          return NextResponse.json({ error: "역할이 설정되지 않았습니다." }, { status: 400 });
        }
        const myVisibility = role === "bride" ? "bride_private" : "groom_private";

        const { error: beginError } = await admin.rpc("begin_private_amora_delete", {
          p_user_id: user!.id,
          p_couple_id: coupleId,
          p_visibility: myVisibility,
        });
        if (beginError) throw beginError;

        const { data: activeLeaseCount, error: leaseError } = await admin.rpc(
          "count_active_amora_private_provider_leases",
          { p_user_id: user!.id, p_visibility: myVisibility }
        );
        if (leaseError) throw leaseError;
        if (Number(activeLeaseCount ?? 0) > 0) {
          return NextResponse.json(
            { pending: true, retryAfterMs: 1000 },
            { status: 202, headers: { "Retry-After": "1" } }
          );
        }

        const { data: deleted, error } = await admin.rpc("delete_private_amora_data", {
          p_user_id: user!.id,
          p_couple_id: coupleId,
          p_visibility: myVisibility,
        });
        if (error) throw error;

        return NextResponse.json({
          success: true,
          mode,
          deleted: typeof deleted === "number" ? deleted : Number(deleted ?? 0),
        });
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
