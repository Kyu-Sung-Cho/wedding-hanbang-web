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

    // 프로필 조회
    let profile = null;
    const { data: profileData } = await admin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileData) {
      profile = profileData;
    } else {
      // 프로필 없으면 생성
      const { data: newProfile } = await admin
        .from("profiles")
        .insert({
          id: user.id,
          name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "사용자",
          email: user.email,
          onboarding_completed: false,
          onboarding_step: 0,
        })
        .select()
        .single();
      profile = newProfile;
    }

    if (!profile) {
      return NextResponse.json({ user: { id: user.id, email: user.email } });
    }

    let couple = null;
    let partner = null;
    let journey = null;

    if (profile.couple_id) {
      // 커플 정보
      const { data: coupleData } = await admin
        .from("couples")
        .select("*")
        .eq("id", profile.couple_id)
        .single();

      if (coupleData) {
        couple = coupleData;

        // 파트너 정보
        const partnerId =
          coupleData.bride_id === user.id
            ? coupleData.groom_id
            : coupleData.bride_id;
        if (partnerId) {
          const { data: partnerData } = await admin
            .from("profiles")
            .select("*")
            .eq("id", partnerId)
            .single();
          partner = partnerData;
        }
      }

      // 웨딩 여정
      const { data: journeyData } = await admin
        .from("wedding_journeys")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .single();

      journey = journeyData;
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      couple,
      partner,
      journey,
    });
  } catch (err) {
    console.error("Auth me 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
