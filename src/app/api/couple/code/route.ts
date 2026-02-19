import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdminClient();

    // 프로필에서 couple_id 조회
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json(
        { error: "커플 정보가 없습니다." },
        { status: 404 }
      );
    }

    // 커플 정보에서 초대 코드 조회
    const { data: couple } = await admin
      .from("couples")
      .select("invite_code")
      .eq("id", profile.couple_id)
      .single();

    if (!couple?.invite_code) {
      // 코드가 없으면 생성
      const { data: newCode } = await admin.rpc("generate_invite_code");
      await admin
        .from("couples")
        .update({ invite_code: newCode })
        .eq("id", profile.couple_id);

      return NextResponse.json({ inviteCode: newCode });
    }

    return NextResponse.json({ inviteCode: couple.invite_code });
  } catch (err) {
    console.error("커플 코드 조회 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
