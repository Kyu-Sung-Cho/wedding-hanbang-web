import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";

function profileUnavailableResponse() {
  return NextResponse.json(
    {
      code: "PROFILE_UNAVAILABLE",
      error: "프로필 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    { status: 503, headers: { "Retry-After": "3" } }
  );
}

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
      .maybeSingle();

    if (profileSelectErr) {
      console.error("AUTH_PROFILE_LOOKUP_FAILED", {
        userId: user.id,
        reason: profileSelectErr.message,
      });
      return profileUnavailableResponse();
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
      // 직접 profiles INSERT 권한은 권한상승 방지를 위해 회수했다. 서버 정의
      // 함수가 auth.uid/email과 안전 기본값만 사용해 생성한 뒤 own-row를 다시 읽는다.
      const safeName = user.user_metadata?.name ?? user.email?.split("@")[0] ?? "사용자";
      const { error: profileInsertErr } = await supabase.rpc("ensure_my_profile", {
        p_name: safeName,
      });
      if (profileInsertErr) {
        console.error("AUTH_PROFILE_ENSURE_FAILED", {
          userId: user.id,
          reason: profileInsertErr.message,
        });
        return profileUnavailableResponse();
      } else {
        const { data: newProfile, error: newProfileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (newProfileError || !newProfile) {
          console.error("AUTH_PROFILE_LOOKUP_AFTER_ENSURE_FAILED", {
            userId: user.id,
            reason: newProfileError?.message ?? "profile_missing_after_ensure",
          });
          return profileUnavailableResponse();
        }
        profile = newProfile;
      }
    }

    let couple = null;
    let partner = null;
    let journey = null;

    if (profile.couple_id) {
      // 커플 정보
      const { data: coupleData, error: coupleErr } = await supabase
        .from("couples")
        .select("id, bride_id, groom_id, created_at, updated_at")
        .eq("id", profile.couple_id)
        .single();

      if (coupleErr) _debug.coupleSelectError = coupleErr.message;

      if (coupleData) {
        // Invite tokens are served only by the ownership-verifying code RPC.
        // Keep the auth-state shape stable without duplicating that secret.
        couple = { ...coupleData, invite_code: null };

        // 파트너 정보
        const partnerId =
          coupleData.bride_id === user.id
            ? coupleData.groom_id
            : coupleData.bride_id;
        if (partnerId) {
          const { data: partnerRows, error: partnerErr } = await supabase
            .rpc("get_my_partner_public");
          if (partnerErr) _debug.partnerSelectError = partnerErr.message;
          const partnerData = Array.isArray(partnerRows) ? partnerRows[0] : partnerRows;
          partner = partnerData && partnerData.id === partnerId
            ? { id: partnerData.id, name: partnerData.name, role: partnerData.role }
            : null;
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
