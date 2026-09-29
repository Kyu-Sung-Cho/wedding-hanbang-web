import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { getWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { readOptionalProfileWeddingRoles } from "@/lib/profileWeddingRole";
import { readOptionalProfileAvatars } from "@/lib/profileAvatar";
import { isConfirmedSignedOut } from "@/lib/auth/sessionFailure";

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

function coupleReadFailure(scopeChanged = false) {
  return NextResponse.json(
    {
      error: scopeChanged
        ? "커플 연결 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요."
        : "결혼 준비 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: scopeChanged ? "COUPLE_MEMBERSHIP_CHANGED" : "PREPARATION_READ_UNAVAILABLE",
    },
    { status: scopeChanged ? 409 : 503, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

function sessionReadFailure(kind: "auth" | "profile") {
  return NextResponse.json(
    {
      error: "로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: kind === "auth" ? "AUTH_VERIFICATION_UNAVAILABLE" : "PROFILE_READ_UNAVAILABLE",
    },
    { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
  );
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
      error: authError,
    } = await supabase.auth.getUser();

    // 인증 서버 장애를 로그아웃이나 데모 세션으로 확정하지 않는다.
    if (authError && !isConfirmedSignedOut(authError)) return sessionReadFailure("auth");

    if (!user || authError) {
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

    // 검증된 사용자 본인의 프로필만 조회한다.
    let profile = null;
    const { data: profileData, error: profileSelectErr } = await admin
      .from("profiles")
      .select(PROFILE_AUTH_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();

    if (profileSelectErr) return sessionReadFailure("profile");

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
      if (profileInsertErr?.code === "23505") {
        // 동시 복구가 먼저 생성했으면 같은 사용자 행을 다시 확인한다.
        const { data: canonicalProfile, error: profileRaceError } = await admin
          .from("profiles")
          .select(PROFILE_AUTH_COLUMNS)
          .eq("id", user.id)
          .maybeSingle();
        if (profileRaceError) return sessionReadFailure("profile");
        profile = canonicalProfile ? { ...canonicalProfile, avatar_url: null } : null;
      } else {
        if (profileInsertErr) return sessionReadFailure("profile");
        profile = newProfile ? { ...newProfile, avatar_url: null } : null;
      }
    }

    if (!profile) {
      return sessionReadFailure("profile");
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
        .maybeSingle();

      if (coupleErr) return coupleReadFailure();
      // 앞서 읽은 프로필은 연결 해제와 경합할 수 있다. 현재 RLS에서 보이지 않는
      // 커플을 관리자 권한으로 보완하거나 초기화하지 않는다.
      if (!coupleData) return coupleReadFailure(true);

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
        .maybeSingle();

      if (journeyErr) return coupleReadFailure();

      if (journeyData) {
        journey = journeyData;
      } else {
        // 여정이 없으면 생성
        const { error: journeyInsertErr } = await admin
          .from("wedding_journeys")
          .insert({
            couple_id: profile.couple_id,
            wedding_date: null,
            venue: null,
            total_budget: 0,
            progress: {},
          })
          .select("id")
          .single();

        if (journeyInsertErr && journeyInsertErr.code !== "23505") {
          return coupleReadFailure();
        }

        // 생성 성공과 동시 생성 모두 호출자 권한으로 다시 읽는다. 그 사이 연결을
        // 해제한 사용자는 관리자 INSERT 결과나 중복 행을 받을 수 없다.
        const { data: canonicalJourney, error: canonicalJourneyError } =
          await supabase
            .from("wedding_journeys")
            .select(JOURNEY_AUTH_COLUMNS)
            .eq("couple_id", profile.couple_id)
            .maybeSingle();
        if (canonicalJourneyError) return coupleReadFailure();
        if (!canonicalJourney) return coupleReadFailure(true);
        journey = canonicalJourney;
      }
    }

    const roles = await readOptionalProfileWeddingRoles(createAdminClient, user.id);
    const ownRole = roles.get(user.id);
    const partnerRole = partner ? roles.get(partner.id) : undefined;
    const avatars = await readOptionalProfileAvatars(admin, [user.id, ...(partner?.id ? [partner.id] : [])]);
    const profileResponse: Record<string, unknown> = { ...profile, ...(ownRole ? { confirmed_role: ownRole.confirmed_role, confirmed_role_revision: ownRole.revision } : {}) };
    delete profileResponse.avatar_url;
    const ownAvatar = avatars.get(user.id);
    if (ownAvatar) { profileResponse.avatar_url = ownAvatar.avatar_url; }
    const partnerResponse: Record<string, unknown> | null = partner ? { ...partner, ...(partnerRole && partnerRole.couple_id === profile.couple_id && partnerRole.couple_id === partner.couple_id
      ? { confirmed_role: partnerRole.confirmed_role, confirmed_role_revision: partnerRole.revision } : {}) } : null;
    if (partnerResponse && partner) {
      delete partnerResponse.avatar_url;
      const partnerAvatar = avatars.get(partner.id);
      if (partnerAvatar) { partnerResponse.avatar_url = partnerAvatar.avatar_url; }
    }

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
