import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

// 초대 코드 brute force 방어: 사용자당 10분 내 10회 시도 제한
const COUPLE_LINK_RATE = { maxRequests: 10, windowMs: 10 * 60 * 1000 };

function getJoinCoupleErrorMessage(error: string | undefined) {
  if (error === "Invalid invite code.") return "초대 코드가 올바르지 않습니다. 코드를 다시 확인해주세요.";
  if (error === "This account is already linked to another couple.") {
    return "이미 다른 커플에 연결된 계정입니다.";
  }
  if (error === "Bride slot is already linked.") return "이미 신부 역할이 연결되어 있습니다.";
  if (error === "Groom slot is already linked.") return "이미 신랑 역할이 연결되어 있습니다.";
  if (error === "Invalid role.") return "역할 정보가 올바르지 않습니다.";
  if (error === "Unauthenticated.") return "로그인이 필요합니다.";
  if (error === "Invite unavailable.") return "초대 코드가 올바르지 않거나 이미 사용된 자리입니다.";
  return error ?? "커플 연동에 실패했습니다.";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit
    const limited = checkRateLimit(
      rateLimitKey("couple_link", request, user.id),
      COUPLE_LINK_RATE,
    );
    if (limited) return limited;

    const { inviteCode } = await request.json();

    if (!inviteCode) {
      return NextResponse.json(
        { error: "초대 코드를 입력해주세요." },
        { status: 400 }
      );
    }

    const normalizedInviteCode = String(inviteCode).trim().toUpperCase();
    if (!/^WH-[A-Z0-9]{12}$/.test(normalizedInviteCode)) {
      return NextResponse.json(
        { error: "초대 코드 형식이 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // 내 프로필 조회 (RLS: profiles_select_own)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.role) {
      return NextResponse.json(
        { error: "프로필 설정을 먼저 완료해주세요." },
        { status: 400 }
      );
    }

    // 인증 사용자는 DB join RPC를 직접 실행할 수 없다. 서버 rate limit 뒤
    // service-only 함수가 profile→couple 순으로 잠그고 원자 조인한다.
    const { data: joinResult, error: joinError } = await createAdminClient().rpc("join_couple_server", {
      p_user_id: user.id,
      p_invite_code: normalizedInviteCode,
      p_role: profile.role,
      p_wedding_date: null,
      p_venue: "",
      p_total_budget: 20_000_000,
      p_progress: {},
      p_sanggyeonrye_date: null,
    });

    if (joinError) {
      console.error("커플 연동 에러:", joinError);
      return NextResponse.json(
        { error: "커플 연동에 실패했습니다." },
        { status: 500 }
      );
    }

    const result = joinResult as { success?: boolean; error?: string; couple_id?: string };

    if (result.error) {
      return NextResponse.json(
        { error: getJoinCoupleErrorMessage(result.error) },
        { status: result.error === "Invalid invite code." ? 404 : 409 }
      );
    }

    return NextResponse.json({ success: true, coupleId: result.couple_id });
  } catch (err) {
    console.error("커플 연동 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
