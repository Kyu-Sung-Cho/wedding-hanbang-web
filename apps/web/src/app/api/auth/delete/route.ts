import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalText, isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function DELETE(request: Request) {
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

    // 탈퇴 사유 파싱
    const limited = checkRateLimit(rateLimitKey("auth:delete", request, user.id), {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return limited;

    let reason = "unknown";
    try {
      const body = await request.json();
      reason = isRecord(body) ? cleanOptionalText(body.reason, 500) ?? "unknown" : "unknown";
    } catch {
      // body가 없을 수 있음 (하위 호환)
    }

    const admin = getAdminClient();
    const userId = user.id;

    // 단계별 실패를 한 곳에서 잡기 위한 헬퍼 — Supabase 에러를 throw 로 승격
    type SupabaseResult = { error: { message: string; code?: string } | null };
    const must = async (label: string, op: PromiseLike<SupabaseResult>) => {
      const { error } = await op;
      if (error) {
        throw new Error(`[${label}] ${error.message}${error.code ? ` (code: ${error.code})` : ""}`);
      }
    };

    // 0. 탈퇴 사유 기록 (실패해도 진행 — 로그용)
    {
      const { error } = await admin.from("account_deletions").insert({
        user_id: userId,
        email: user.email,
        reason,
        deleted_at: new Date().toISOString(),
      });
      if (error) console.warn("account_deletions insert 실패(무시):", error);
    }

    // 1. 프로필에서 couple_id 조회
    const { data: profile, error: profileFetchError } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileFetchError) {
      console.warn("프로필 조회 실패(무시 후 진행):", profileFetchError);
    }

    const coupleId = profile?.couple_id ?? null;

    // 2. 커플 연동된 경우: 커플에서 본인 제거 (파트너는 유지)
    if (coupleId) {
      const { data: couple } = await admin
        .from("couples")
        .select("bride_id, groom_id")
        .eq("id", coupleId)
        .maybeSingle();

      if (couple) {
        const isBride = couple.bride_id === userId;
        const isGroom = couple.groom_id === userId;
        const hasPartner = (isBride && couple.groom_id) || (isGroom && couple.bride_id);

        if (hasPartner) {
          // 파트너가 있으면 본인만 커플에서 제거 + 본인 발신 채팅의 sender_id null 처리
          // (chat_messages.sender_id 가 auth.users(id) FK 라서 미정리 시 auth 유저 삭제 차단됨)
          await must("chat_messages sender 정리", admin
            .from("chat_messages")
            .update({ sender_id: null })
            .eq("sender_id", userId));

          const update: Record<string, null> = {};
          if (isBride) update.bride_id = null;
          if (isGroom) update.groom_id = null;
          await must("couples 본인 제거", admin.from("couples").update(update).eq("id", coupleId));
        } else {
          // 혼자인 커플이면 웨딩 여정 + 채팅 + 커플 삭제 (CASCADE 가 깔끔하게 처리하지만 명시적으로)
          await must("wedding_journeys 삭제", admin.from("wedding_journeys").delete().eq("couple_id", coupleId));
          // chat_messages 는 couple_id ON DELETE CASCADE 이지만, 안전하게 명시 삭제
          await must("chat_messages 삭제", admin.from("chat_messages").delete().eq("couple_id", coupleId));
          await must("couples 삭제", admin.from("couples").delete().eq("id", coupleId));
        }
      }
    } else {
      // 커플 없이도 sender_id 로 남아있는 채팅이 있을 수 있으니 안전망
      await must("chat_messages sender 정리(커플 없음)", admin
        .from("chat_messages")
        .update({ sender_id: null })
        .eq("sender_id", userId));
    }

    // 3. 본인 소유 채팅 요약 삭제 (FK 없지만 잔여 데이터 정리)
    await must("chat_summaries 삭제", admin.from("chat_summaries").delete().eq("user_id", userId));

    // 4. 프로필 삭제 (profiles.id 가 auth.users(id) ON DELETE CASCADE 라 보통 자동이지만 명시)
    await must("profiles 삭제", admin.from("profiles").delete().eq("id", userId));

    // 5. Supabase Auth 유저 삭제
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("Auth 유저 삭제 에러:", authError);
      return NextResponse.json(
        { error: `계정 삭제에 실패했습니다. (${authError.message})` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    console.error("계정 삭제 에러:", message, err);
    return NextResponse.json(
      { error: `계정 삭제 중 오류가 발생했습니다: ${message}` },
      { status: 500 }
    );
  }
}
