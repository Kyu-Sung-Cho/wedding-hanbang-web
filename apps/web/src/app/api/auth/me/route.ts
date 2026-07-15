import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { readMySafeProfile } from "@/lib/profile/safeProfile";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

function profileUnavailableResponse() {
  return NextResponse.json(
    {
      code: "PROFILE_UNAVAILABLE",
      error: "프로필 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    { status: 503, headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": "3" } }
  );
}

function accountStateUnavailableResponse() {
  return NextResponse.json(
    {
      code: "ACCOUNT_STATE_UNAVAILABLE",
      error: "커플 준비 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
    },
    { status: 503, headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": "3" } }
  );
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const isDemoRequest = hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"));
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
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    // 원문 profiles SELECT 대신 본인 전용 최소 DTO RPC로 조회한다.
    const { data: initialProfile, error: profileSelectErr } = await readMySafeProfile(supabase);
    let profile = initialProfile;

    if (profileSelectErr) {
      console.error("AUTH_PROFILE_LOOKUP_FAILED", {
        userId: user.id,
        state: "query_failed",
      });
      return profileUnavailableResponse();
    }

    if (profile) {

      // 이름이 없으면 채워주기
      if (!profile.name) {
        const name = user.user_metadata?.name
          ?? user.user_metadata?.full_name
          ?? user.email?.split("@")[0]
          ?? "사용자";
        profile = { ...profile, name };
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
          state: "insert_failed",
        });
        return profileUnavailableResponse();
      } else {
        const { data: newProfile, error: newProfileError } = await readMySafeProfile(supabase);
        if (newProfileError || !newProfile) {
          console.error("AUTH_PROFILE_LOOKUP_AFTER_ENSURE_FAILED", {
            userId: user.id,
            state: newProfileError ? "query_failed" : "profile_missing_after_ensure",
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
        .maybeSingle();

      if (coupleErr || !coupleData) {
        console.error("AUTH_COUPLE_LOOKUP_FAILED", {
          userId: user.id,
          state: coupleErr ? "query_failed" : "linked_couple_missing",
        });
        return accountStateUnavailableResponse();
      }

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
        const partnerData = Array.isArray(partnerRows) ? partnerRows[0] : partnerRows;
        if (partnerErr || !partnerData || partnerData.id !== partnerId) {
          console.error("AUTH_PARTNER_LOOKUP_FAILED", {
            userId: user.id,
            state: partnerErr ? "query_failed" : "linked_partner_missing",
          });
          return accountStateUnavailableResponse();
        }
        partner = { id: partnerData.id, name: partnerData.name, role: partnerData.role };
      }

      // 웨딩 여정 조회
      const { data: journeyData, error: journeyErr } = await supabase
        .from("wedding_journeys")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .maybeSingle();

      if (journeyErr) {
        console.error("AUTH_JOURNEY_LOOKUP_FAILED", {
          userId: user.id,
          state: "query_failed",
        });
        return accountStateUnavailableResponse();
      }

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
            total_budget: 0,
            progress: {},
          })
          .select()
          .single();

        if (journeyInsertErr || !newJourney) {
          console.error("AUTH_JOURNEY_ENSURE_FAILED", {
            userId: user.id,
            state: journeyInsertErr ? "insert_failed" : "insert_returned_no_row",
          });
          return accountStateUnavailableResponse();
        }
        journey = newJourney;
      }
    }

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email },
        profile,
        couple,
        partner,
        journey,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch {
    console.error("AUTH_ME_UNHANDLED");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
