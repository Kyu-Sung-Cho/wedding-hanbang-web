import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdminClient();
    const userId = user.id;

    // 1. 프로필에서 couple_id 조회
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", userId)
      .single();

    const coupleId = profile?.couple_id;

    // 2. 커플 연동된 경우: 커플에서 본인 제거 (파트너는 유지)
    if (coupleId) {
      const { data: couple } = await admin
        .from("couples")
        .select("bride_id, groom_id")
        .eq("id", coupleId)
        .single();

      if (couple) {
        const isBride = couple.bride_id === userId;
        const isGroom = couple.groom_id === userId;
        const hasPartner = (isBride && couple.groom_id) || (isGroom && couple.bride_id);

        if (hasPartner) {
          // 파트너가 있으면 본인만 커플에서 제거
          const update: Record<string, null> = {};
          if (isBride) update.bride_id = null;
          if (isGroom) update.groom_id = null;
          await admin.from("couples").update(update).eq("id", coupleId);
        } else {
          // 혼자인 커플이면 웨딩 여정 + 커플 삭제
          await admin.from("wedding_journeys").delete().eq("couple_id", coupleId);
          await admin.from("couples").delete().eq("id", coupleId);
        }
      }
    }

    // 3. 채팅 메시지 삭제
    await admin.from("chat_messages").delete().eq("user_id", userId);
    await admin.from("chat_summaries").delete().eq("user_id", userId);

    // 4. 프로필 삭제
    await admin.from("profiles").delete().eq("id", userId);

    // 5. Supabase Auth 유저 삭제
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("Auth 유저 삭제 에러:", authError);
      return NextResponse.json(
        { error: "계정 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("계정 삭제 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
