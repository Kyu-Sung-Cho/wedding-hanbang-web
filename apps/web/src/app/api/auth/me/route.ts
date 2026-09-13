import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { getWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { readOptionalProfileWeddingRoles } from "@/lib/profileWeddingRole";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const PROFILE_AUTH_COLUMNS =
  "id, name, role, couple_id, onboarding_completed, onboarding_step, is_admin, care_notifications_enabled, care_notifications_consented_at, created_at, updated_at";
const COUPLE_AUTH_COLUMNS =
  "id, bride_id, groom_id, membership_sealed_at, created_at, updated_at";
// member_model_version 은 20260816180000 에서 생긴다. 미적용 DB에서 이 컬럼을
// 같이 select 하면 42703 으로 커플 조회 전체가 죽으므로 따로 읽고, 실패하면
// v1 로 본다 — 그 상태에서는 중립 커플이 존재할 수 없다.
const COUPLE_MEMBER_MODEL_COLUMN = "member_model_version";

const JOURNEY_AUTH_COLUMNS =
  "id, couple_id, wedding_date, venue, total_budget, progress, state_revision, created_at, updated_at";

function isNeutralPreparationSpaceEnabled(): boolean {
  return process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true";
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const includeDebug = process.env.NODE_ENV !== "production";
    const isGuestProbe = new URL(request.url).searchParams.get("guest_probe") === "1";
    const isDemoRequest = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
    const neutralPreparationSpace = isNeutralPreparationSpaceEnabled();
    // 자동 탈퇴 접수가 열려 있는지. 설정 화면이 사유 선택과 확인 문구 타이핑을 다
    // 시킨 **뒤에야** 503을 받던 것을 막는다 — 판정은 여기서만 하고 화면은 받은
    // 값만 본다. `api/auth/delete` 와 같은 환경변수를 읽는다.
    const accountDeletionIntake = process.env.ACCOUNT_DELETION_INTAKE_ENABLED === "true";
    const baseCapabilities = { neutralPreparationSpace, accountDeletionIntake };
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

    // 웹은 콜백과 앱 셸에서 동의 없는 계정을 /consent 로 돌려세운다. 모바일은
    // 다른 콜백(/auth/mobile-callback)을 쓰므로 그 관문에 닿지 않는다.
    // 여기서 사실만 내보내 두면, 모바일이 자기 화면을 붙일 때 서버를 다시
    // 고칠 필요가 없다. 지금 아무도 읽지 않아도 거짓이 아니다.
    const signupConsentAccess = getWebSignupConsentAccess(user);
    if (signupConsentAccess === "configuration_error") {
      return NextResponse.json({ error: "동의 기록 확인 설정을 준비 중이에요. 잠시 후 다시 시도해 주세요.", code: "SIGNUP_CONSENT_CONFIGURATION_REQUIRED" }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
    }
    const capabilities = {
      ...baseCapabilities,
      signupConsentAccess,
      requiresSignupConsent: signupConsentAccess === "required",
    };
    if (new URL(request.url).searchParams.get("consent_only") === "1") {
      return NextResponse.json({ user: { id: user.id }, capabilities }, { headers: PRIVATE_NO_STORE_HEADERS });
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
        const { data: memberModelData } = await supabase
          .from("couples")
          .select(COUPLE_MEMBER_MODEL_COLUMN)
          .eq("id", profile.couple_id)
          .maybeSingle();
        const memberModelVersion =
          memberModelData !== null
          && typeof memberModelData === "object"
          && (memberModelData as Record<string, unknown>).member_model_version === 2
            ? 2
            : 1;

        // Invite codes are fetched only through /api/couple/code, which also
        // enforces the current roster phase before revealing them.
        couple = { ...coupleData, invite_code: null, member_model_version: memberModelVersion };

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

    const roles = await readOptionalProfileWeddingRoles(createAdminClient, user.id);
    const ownRole = roles.get(user.id);
    const partnerRole = partner ? roles.get(partner.id) : undefined;
    const profileResponse = { ...profile, ...(ownRole ? { confirmed_role: ownRole.confirmed_role, confirmed_role_revision: ownRole.revision } : {}) };
    const partnerResponse = partner ? { ...partner, ...(partnerRole && partnerRole.couple_id === profile.couple_id && partnerRole.couple_id === partner.couple_id
      ? { confirmed_role: partnerRole.confirmed_role, confirmed_role_revision: partnerRole.revision } : {}) } : null;

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email },
        profile: profileResponse,
        couple,
        partner: partnerResponse,
        journey,
        capabilities,
        ...(includeDebug && Object.keys(_debug).length > 0 ? { _debug } : {}),
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (err) {
    log.error("api/auth/me", err);
    console.error("Auth me 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
