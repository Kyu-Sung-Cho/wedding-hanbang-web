import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  COUPLE_PRIVATE_SELECT,
  WEDDING_JOURNEY_PRIVATE_SELECT,
} from "@/lib/privacy/privateDataSelects";

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const AUTH_ME_READ_RATE = { maxRequests: 120, windowMs: 60 * 1000 };
const AUTH_ME_BOOTSTRAP_RATE = { maxRequests: 20, windowMs: 10 * 60 * 1000 };

const AUTH_PROFILE_SNAPSHOT_COLUMNS = [
  "id",
  "name",
  "role",
  "couple_id",
  "avatar_url",
  "onboarding_completed",
  "onboarding_step",
  "care_notifications_enabled",
  "care_notifications_consented_at",
  "created_at",
  "updated_at",
].join(", ");

type AuthProfileSnapshot = {
  id: string;
  name: string | null;
  role: "bride" | "groom" | null;
  couple_id: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  care_notifications_enabled: boolean;
  care_notifications_consented_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toAuthProfileSnapshot(
  value: unknown,
  authenticatedUserId: string,
): AuthProfileSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.id !== authenticatedUserId) return null;

  return {
    id: authenticatedUserId,
    name: typeof row.name === "string" ? row.name : null,
    role: row.role === "bride" || row.role === "groom" ? row.role : null,
    couple_id: typeof row.couple_id === "string" ? row.couple_id : null,
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    onboarding_completed: row.onboarding_completed === true,
    onboarding_step:
      typeof row.onboarding_step === "number" && Number.isInteger(row.onboarding_step)
        ? row.onboarding_step
        : 0,
    care_notifications_enabled: row.care_notifications_enabled === true,
    care_notifications_consented_at:
      typeof row.care_notifications_consented_at === "string"
        ? row.care_notifications_consented_at
        : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

async function handleAuthMe(request: Request, ensureDefaults: boolean) {
  try {
    const supabase = await createClientFromRequest(request);
    const isGuestProbe = new URL(request.url).searchParams.get("guest_probe") === "1";
    const isDemoRequest = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (isDemoRequest) {
        return NextResponse.json({ user: null, demo: true });
      }
      if (isGuestProbe) {
        return NextResponse.json({ user: null });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey(
        ensureDefaults ? "auth:me:bootstrap" : "auth:me:read",
        request,
        user.id,
      ),
      ensureDefaults ? AUTH_ME_BOOTSTRAP_RATE : AUTH_ME_READ_RATE,
      { failClosed: true },
    );
    if (limited) return limited;

    const admin = createAdminClient();

    // 프로필 조회 (RLS: profiles_select_own)
    let profile: AuthProfileSnapshot | null = null;
    const { data: profileData, error: profileSelectErr } = await admin
      .from("profiles")
      .select(AUTH_PROFILE_SNAPSHOT_COLUMNS)
      .eq("id", user.id)
      .single();

    if (profileSelectErr) {
      console.error("Profile lookup failed", safeErrorDiagnostic(profileSelectErr));
    }

    if (profileData) {
      profile = toAuthProfileSnapshot(profileData, user.id);
      if (!profile) {
        console.error("Profile lookup returned an invalid actor record.");
      }

      // Missing defaults are repaired only by the explicitly protected POST.
      if (profile && ensureDefaults && !profile.name) {
        const name = user.user_metadata?.name
          ?? user.user_metadata?.full_name
          ?? user.email?.split("@")[0]
          ?? "사용자";
        const { error: nameErr } = await admin
          .from("profiles")
          .update({ name })
          .eq("id", user.id);
        if (nameErr) console.error("Profile default-name repair failed", safeErrorDiagnostic(nameErr));
        profile.name = name;
      }
    } else if (ensureDefaults) {
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
        .select(AUTH_PROFILE_SNAPSHOT_COLUMNS)
        .single();
      if (profileInsertErr) console.error("Profile bootstrap failed", safeErrorDiagnostic(profileInsertErr));
      profile = toAuthProfileSnapshot(newProfile, user.id);
    }

    if (!profile) {
      return NextResponse.json({
        user: { id: user.id, email: user.email },
      });
    }

    let couple = null;
    let partner = null;
    let journey = null;

    if (profile.couple_id) {
      // 커플 정보
      const { data: coupleData, error: coupleErr } = await supabase
        .from("couples")
        .select(COUPLE_PRIVATE_SELECT)
        .eq("id", profile.couple_id)
        .single();

      if (coupleErr) console.error("Couple lookup failed", safeErrorDiagnostic(coupleErr));

      if (coupleData) {
        couple = coupleData;

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
          if (partnerErr) console.error("Partner lookup failed", safeErrorDiagnostic(partnerErr));
          partner = partnerData;
        }
      }

      // 웨딩 여정 조회
      const { data: journeyData, error: journeyErr } = await supabase
        .from("wedding_journeys")
        .select(WEDDING_JOURNEY_PRIVATE_SELECT)
        .eq("couple_id", profile.couple_id)
        .single();

      if (journeyErr) console.error("Journey lookup failed", safeErrorDiagnostic(journeyErr));

      if (journeyData) {
        journey = journeyData;
      } else if (ensureDefaults) {
        // 여정이 없으면 생성
        const { data: newJourney, error: journeyInsertErr } = await admin
          .from("wedding_journeys")
          .insert({
            couple_id: profile.couple_id,
            wedding_date: null,
            venue: null,
            total_budget: 20000000,
            progress: {},
          })
          .select(WEDDING_JOURNEY_PRIVATE_SELECT)
          .single();

        if (journeyInsertErr) console.error("Journey bootstrap failed", safeErrorDiagnostic(journeyInsertErr));
        journey = newJourney;
      }
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      couple,
      partner,
      journey,
    });
  } catch (err) {
    console.error("Auth me 에러:", safeErrorDiagnostic(err));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/** Read-only identity and wedding snapshot. Safe for probes and refreshes. */
export async function GET(request: Request) {
  const response = await handleAuthMe(request, false);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/**
 * Idempotently repairs bootstrap rows for the authenticated actor. Cookie
 * callers must prove same-origin; native callers must present a Bearer token.
 */
export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }

  const response = await handleAuthMe(request, true);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
