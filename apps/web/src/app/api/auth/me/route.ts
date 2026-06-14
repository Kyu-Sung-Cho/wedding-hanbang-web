import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const includeDebug = process.env.NODE_ENV !== "production";
    const isDemoRequest = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (isDemoRequest) {
        return NextResponse.json({ user: null, demo: true });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const _debug: Record<string, unknown> = {};

    // 프로필 조회 (RLS: profiles_select_own)
    let profile = null;
    const { data: profileData, error: profileSelectErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileSelectErr) {
      _debug.profileSelectError = profileSelectErr.message;
    }

    if (profileData) {
      profile = profileData;

      // 이름이 없으면 채워주기
      if (!profile.name) {
        const name = user.user_metadata?.name
          ?? user.user_metadata?.full_name
          ?? user.email?.split("@")[0]
          ?? "사용자";
        const { error: nameErr } = await supabase
          .from("profiles")
          .update({ name })
          .eq("id", user.id);
        if (nameErr) _debug.nameUpdateError = nameErr.message;
        profile.name = name;
      }
    } else {
      // 프로필 없으면 생성
      const { data: newProfile, error: profileInsertErr } = await supabase
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
      if (profileInsertErr) _debug.profileInsertError = profileInsertErr.message;
      profile = newProfile;
    }

    if (!profile) {
      return NextResponse.json({
        user: { id: user.id, email: user.email },
        ...(includeDebug && Object.keys(_debug).length > 0 ? { _debug } : {}),
      });
    }

    let couple = null;
    let partner = null;
    let journey = null;

    if (profile.couple_id) {
      // 커플 정보
      const { data: coupleData, error: coupleErr } = await supabase
        .from("couples")
        .select("*")
        .eq("id", profile.couple_id)
        .single();

      if (coupleErr) _debug.coupleSelectError = coupleErr.message;

      if (coupleData) {
        couple = coupleData;

        // 파트너 정보
        const partnerId =
          coupleData.bride_id === user.id
            ? coupleData.groom_id
            : coupleData.bride_id;
        if (partnerId) {
          const { data: partnerData, error: partnerErr } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", partnerId)
            .single();
          if (partnerErr) _debug.partnerSelectError = partnerErr.message;
          partner = partnerData;
        }
      }

      // 웨딩 여정 조회
      const { data: journeyData, error: journeyErr } = await supabase
        .from("wedding_journeys")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .single();

      if (journeyErr) _debug.journeySelectError = journeyErr.message;

      if (journeyData) {
        journey = journeyData;
      } else {
        // 여정이 없으면 생성
        const { data: newJourney, error: journeyInsertErr } = await supabase
          .from("wedding_journeys")
          .insert({
            couple_id: profile.couple_id,
            wedding_date: null,
            venue: null,
            total_budget: 20000000,
            progress: {},
          })
          .select()
          .single();

        if (journeyInsertErr) _debug.journeyInsertError = journeyInsertErr.message;
        journey = newJourney;
      }
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      couple,
      partner,
      journey,
      ...(includeDebug && Object.keys(_debug).length > 0 ? { _debug } : {}),
    });
  } catch (err) {
    console.error("Auth me 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
