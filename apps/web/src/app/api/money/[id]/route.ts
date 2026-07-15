import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readMySafeProfile } from "@/lib/profile/safeProfile";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import { congratulatoryMoneyRetiredResponse } from "../retiredResponse";

/** 기존 기록의 변경은 중단한다. */
export async function PATCH() {
  return congratulatoryMoneyRetiredResponse();
}

/**
 * 기능 종료 전에 저장된 제3자 정보를 지울 수 있도록 소유자 삭제만 남긴다.
 * 사용자 세션에는 원문 SELECT 권한을 주지 않고, 서버가 세 소유 조건을
 * 한 쿼리에서 모두 고정한 경우에만 삭제한다.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 기록 ID입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      return NextResponse.json({ error: "로그인 상태를 확인하지 못했습니다." }, { status: 503 });
    }
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const limited = checkRateLimit(rateLimitKey("money:delete", request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const { data: profile, error: profileError } = await readMySafeProfile(supabase);
    if (profileError) {
      return NextResponse.json({ error: "소유 정보를 확인하지 못했습니다." }, { status: 503 });
    }
    if (!profile?.couple_id) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await createAdminClient()
      .from("congratulatory_money")
      .delete()
      .eq("id", id)
      .eq("owner_user_id", user.id)
      .eq("couple_id", profile.couple_id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[money/:id DELETE] delete_failed");
      return NextResponse.json({ error: "삭제하지 못했습니다." }, { status: 500 });
    }
    if (!data || data.id !== id) {
      return NextResponse.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch {
    console.error("[money/:id DELETE] request_failed");
    return NextResponse.json({ error: "삭제하지 못했습니다." }, { status: 500 });
  }
}
