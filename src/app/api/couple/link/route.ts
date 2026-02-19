import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
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

    // 내 프로필 조회
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

    // 초대 코드로 커플 조회
    const { data: couple, error: findError } = await supabase
      .from("couples")
      .select("*")
      .eq("invite_code", inviteCode)
      .single();

    if (findError || !couple) {
      return NextResponse.json(
        { error: "유효하지 않은 초대 코드입니다." },
        { status: 404 }
      );
    }

    // 역할 슬롯 확인
    const targetField = profile.role === "bride" ? "bride_id" : "groom_id";
    if (couple[targetField]) {
      return NextResponse.json(
        {
          error: `이미 ${profile.role === "bride" ? "신부" : "신랑"}가 연동되어 있습니다.`,
        },
        { status: 409 }
      );
    }

    // 커플 업데이트
    await supabase
      .from("couples")
      .update({ [targetField]: user.id })
      .eq("id", couple.id);

    // 프로필 업데이트
    await supabase
      .from("profiles")
      .update({ couple_id: couple.id })
      .eq("id", user.id);

    return NextResponse.json({ success: true, coupleId: couple.id });
  } catch (err) {
    console.error("커플 연동 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
