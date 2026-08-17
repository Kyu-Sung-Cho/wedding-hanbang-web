import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const PROFILE_AUTH_COLUMNS =
  "id, name, role, couple_id, onboarding_completed, onboarding_step, is_admin, care_notifications_enabled, care_notifications_consented_at, created_at, updated_at";
const COUPLE_AUTH_COLUMNS =
  "id, bride_id, groom_id, member_model_version, membership_sealed_at, created_at, updated_at";
const JOURNEY_AUTH_COLUMNS =
  "id, couple_id, wedding_date, venue, total_budget, progress, state_revision, created_at, updated_at";

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const includeDebug = process.env.NODE_ENV !== "production";
    const isGuestProbe = new URL(request.url).searchParams.get("guest_probe") === "1";
    const isDemoRequest = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
    const capabilities = {
      neutralPreparationSpace:
        process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true",
    };
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (isDemoRequest) {
        return NextResponse.json(
          { user: null, demo: true },
          { headers: PRIVATE_NO_STORE_HEADERS },
        );
      }
      if (isGuestProbe) {
        return NextResponse.json(
          { user: null },
          { headers: PRIVATE_NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const admin = createAdminClient();
    const _debug: Record<string, unknown> = {};

    // 프로필 조회 (RLS: profiles_select_own)
    let profile = null;
    const { data: profileData, error: profileSelectErr } = await admin
      .from("profiles")
      .select(PROFILE_AUTH_COLUMNS)
      .eq("id", user.id)
      .single();

    if (profileSelectErr) {
      _debug.profileSelectError = profileSelectErr.message;
    }

    if (profileData) {
      profile = { ...profileData, avatar_url: null };

      // 이름이 없으면 채워주기
      if (!profile.name) {
        const name = user.user_metadata?.name
          ?? user.user_metadata?.full_name
          ?? user.email?.split("@")[0]
          ?? "사용자";
        const { error: nameErr } = await admin
          .from("profiles")
          .update({ name })
          .eq("id", user.id);
        if (nameErr) _debug.nameUpdateError = nameErr.message;
        profile.name = name;
      }
    } else {
      // 프로필 없으면 생성
      // Direct client INSERT is disabled. Repair only the authenticated user's
      // exact profile row through the server-side service client.
      const { data: newProfile, error: profileInsertErr } = await admin
        .from("profiles")
        .insert({
          id: user.id,
          name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "사용자",
          email: user.email,
          onboarding_completed: false,
          onboarding_step: 0,
        })
        .select(PROFILE_AUTH_COLUMNS)
        .single();
      if (profileInsertErr) _debug.profileInsertError = profileInsertErr.message;
      profile = newProfile ? { ...newProfile, avatar_url: null } : null;
    }

    if (!profile) {
      return NextResponse.json(
        {
          user: { id: user.id, email: user.email },
          capabilities,
          ...(includeDebug && Object.keys(_debug).length > 0 ? { _debug } : {}),
        },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    let couple = null;
    let partner = null;
    let journey = null;

    if (profile.couple_id) {
      // 커플 정보
      const { data: coupleData, error: coupleErr } = await supabase
        .from("couples")
        .select(COUPLE_AUTH_COLUMNS)
        .eq("id", profile.couple_id)
        .single();

      if (coupleErr) _debug.coupleSelectError = coupleErr.message;

      if (coupleData) {
        // Invite codes are fetched only through /api/couple/code, which also
        // enforces the current roster phase before revealing them.
        couple = { ...coupleData, invite_code: null };

        // 파트너 정보
        const partnerId =
          coupleData.bride_id === user.id
            ? coupleData.groom_id
            : coupleData.bride_id;
        if (partnerId) {
          const { data: partnerData, error: partnerErr } = await supabase
            .from("couple_profile_directory")
            .select("id, name, role, couple_id")
            .eq("id", partnerId)
            .single();
          if (partnerErr) _debug.partnerSelectError = partnerErr.message;
          partner = partnerData;
        }
      }

      // 웨딩 여정 조회
      const { data: journeyData, error: journeyErr } = await supabase
        .from("wedding_journeys")
        .select(JOURNEY_AUTH_COLUMNS)
        .eq("couple_id", profile.couple_id)
        .single();

      if (journeyErr) _debug.journeySelectError = journeyErr.message;

      if (journeyData) {
        journey = journeyData;
      } else {
        // 여정이 없으면 생성
        const { data: newJourney, error: journeyInsertErr } = await admin
          .from("wedding_journeys")
          .insert({
            couple_id: profile.couple_id,
            wedding_date: null,
            venue: null,
            total_budget: 0,
            progress: {},
          })
          .select(JOURNEY_AUTH_COLUMNS)
          .single();

        if (!journeyInsertErr && newJourney) {
          journey = newJourney;
        } else if (journeyInsertErr?.code === "23505") {
          // Another member or a lost-response retry may win the singleton
          // neutral bootstrap. Return that canonical row, never an empty lie.
          const { data: canonicalJourney, error: canonicalJourneyError } =
            await admin
              .from("wedding_journeys")
              .select(JOURNEY_AUTH_COLUMNS)
              .eq("couple_id", profile.couple_id)
              .maybeSingle();
          if (canonicalJourneyError) {
            _debug.journeyRaceReadError = canonicalJourneyError.message;
          }
          journey = canonicalJourney;
        } else {
          if (journeyInsertErr) {
            _debug.journeyInsertError = journeyInsertErr.message;
          }
          journey = null;
        }
      }
    }

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email },
        profile,
        couple,
        partner,
        journey,
        capabilities,
        ...(includeDebug && Object.keys(_debug).length > 0 ? { _debug } : {}),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("Auth me 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
