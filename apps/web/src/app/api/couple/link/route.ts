import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { inviteCode } = await request.json();

    if (!inviteCode) {
      return NextResponse.json(
        { error: "초대 코드를 입력해주세요." },
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

    // join_couple 함수로 원자적 커플 조인 (SECURITY DEFINER)
    const { data: joinResult, error: joinError } = await supabase.rpc("join_couple", {
      p_invite_code: inviteCode,
      p_role: profile.role,
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
        { error: result.error },
        { status: 409 }
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
