import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;

interface ResetBody {
  confirmText?: string;
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

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: existingLifecycle } = await admin
      .from("profiles")
      .select("amora_membership_resetting_at")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingLifecycle?.amora_membership_resetting_at) {
      const limited = checkRateLimit(rateLimitKey("couple:reset", request, user.id), {
        maxRequests: 5,
        windowMs: 10 * 60 * 1000,
      });
      if (limited) return limited;
    }

    const body = (await request.json().catch(() => ({}))) as ResetBody;
    if (body.confirmText !== "초기화합니다") {
      return NextResponse.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }

    const { data: beginState, error: beginError } = await admin.rpc("begin_amora_membership_reset", {
      p_user_id: user.id,
    });
    if (beginError) {
      console.error("[couple/reset] 초기화 lifecycle 시작 실패:", beginError.message);
      return NextResponse.json({ error: "웨딩 정보 초기화를 시작하지 못했습니다." }, { status: 409 });
    }
    if (!isRecord(beginState) || typeof beginState.profile_found !== "boolean") {
      return NextResponse.json({ error: "커플 초기화 상태를 확인하지 못했습니다." }, { status: 500 });
    }
    if (beginState.couple_marker_owned === true
      && typeof beginState.couple_id !== "string") {
      return NextResponse.json({ error: "커플 초기화 상태가 올바르지 않습니다." }, { status: 500 });
    }

    const { data: userLeaseCount, error: userLeaseError } = await admin.rpc(
      "count_active_amora_provider_leases",
      { p_user_id: user.id }
    );
    if (userLeaseError) throw userLeaseError;
    let coupleLeaseCount = 0;
    if (beginState.couple_marker_owned === true && typeof beginState.couple_id === "string") {
      const { data, error } = await admin.rpc("count_active_amora_couple_provider_leases", {
        p_couple_id: beginState.couple_id,
      });
      if (error) throw error;
      coupleLeaseCount = Number(data ?? 0);
    }
    if (Number(userLeaseCount ?? 0) > 0 || coupleLeaseCount > 0) {
      return NextResponse.json(
        { pending: true, retryAfterMs: 1000 },
        { status: 202, headers: { "Retry-After": "1" } }
      );
    }

    const { error: resetError } = await admin.rpc("leave_amora_couple_safely", {
      p_user_id: user.id,
      p_mode: "reset",
    });

    if (resetError) {
      console.error("[couple/reset] 안전 초기화 RPC 실패:", resetError.message);
      return NextResponse.json({ error: "웨딩 정보 초기화를 안전하게 완료하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[couple/reset] error:", err);
    return NextResponse.json({ error: "초기화에 실패했습니다." }, { status: 500 });
  }
}
