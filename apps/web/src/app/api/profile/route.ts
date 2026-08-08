import { createAdminClient as createPinnedAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  isCommunityNicknameUniqueViolation,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { careChannelsAvailable } from "@/lib/care/careConsent";
import {
  isAmoraProactiveChatEnabled,
} from "@/lib/features/amoraCareFlags";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  cleanOptionalKoreanMobile,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;
const PROFILE_READ_COLUMNS =
  "id, name, role, couple_id, care_notifications_enabled, care_notifications_consented_at";
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getAdminClient() {
  return createPinnedAdminClient();
}

function profileReadResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function careAvailabilityFor(user: { email_confirmed_at?: string | null }) {
  return {
    outboundEnabled: process.env.AMORA_CARE_OUTBOUND_ENABLED === "true",
    // 인앱 선제 대화는 이메일과 독립 스위치다 — 둘 중 하나만 켜져도 동의할 수 있어야 한다.
    proactiveChatEnabled: isAmoraProactiveChatEnabled(),
    emailVerified:
      typeof user.email_confirmed_at === "string" &&
      user.email_confirmed_at.trim().length > 0,
  };
}

function toMobileProfile(data: unknown, authenticatedUserId: string) {
  if (!isRecord(data) || data.id !== authenticatedUserId) return null;

  return {
    id: authenticatedUserId,
    name: typeof data.name === "string" ? data.name : null,
    role: data.role === "bride" || data.role === "groom" ? data.role : null,
    couple_id: typeof data.couple_id === "string" ? data.couple_id : null,
    care_notifications_enabled: data.care_notifications_enabled === true,
    care_notifications_consented_at:
      typeof data.care_notifications_consented_at === "string" &&
      data.care_notifications_consented_at.trim().length > 0
        ? data.care_notifications_consented_at
        : null,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return profileReadResponse({ error: "인증이 필요합니다." }, 401);
    }

    const limited = checkRateLimit(rateLimitKey("profile:read", request, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    const { data, error } = await getAdminClient()
      .from("profiles")
      .select(PROFILE_READ_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Profile read error:", error);
      return profileReadResponse({ error: "프로필을 불러오지 못했습니다." }, 500);
    }

    if (!data) {
      return profileReadResponse({ error: "프로필을 찾을 수 없습니다." }, 404);
    }

    const profile = toMobileProfile(data, user.id);
    if (!profile) {
      console.error("Profile read returned an invalid user record.");
      return profileReadResponse({ error: "프로필을 불러오지 못했습니다." }, 500);
    }

    return profileReadResponse({
      profile,
      careAvailability: careAvailabilityFor(user),
    });
  } catch (err) {
    console.error("Profile read API error:", err);
    return profileReadResponse({ error: "서버 오류" }, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const careAvailability = careAvailabilityFor(user);

    const limited = checkRateLimit(rateLimitKey("profile:update", request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    let name: string | null = null;
    let communityNickname: string | null = null;
    let phone: string | null = null;
    const phoneProvided = body.phone !== undefined;
    const communityNicknameProvided = body.community_nickname !== undefined;
    const forceCommunityNicknameSync = body.sync_community_nickname === true;
    let careConsentUpdate: boolean | undefined;
    let phoneCareConsent: boolean | null = null;

    if (body.name !== undefined) {
      name = cleanOptionalText(body.name, 80);
      if (!name) {
        return NextResponse.json({ error: "이름 형식이 올바르지 않습니다." }, { status: 400 });
      }
      const nicknameValidation = communityNicknameProvided
        ? null
        : validateCommunityNickname(name);
      if (nicknameValidation && !nicknameValidation.ok) {
        return NextResponse.json(
          { error: nicknameValidation.message },
          { status: 400 }
        );
      }
      if (nicknameValidation?.ok) {
        communityNickname = nicknameValidation.nickname;
      }
    }

    if (communityNicknameProvided) {
      if (forceCommunityNicknameSync) {
        return NextResponse.json(
          { error: "커뮤니티 별명 직접 변경과 이름 자동 동기화는 동시에 요청할 수 없습니다." },
          { status: 400 }
        );
      }
      const nicknameValidation = validateCommunityNickname(body.community_nickname);
      if (!nicknameValidation.ok) {
        return NextResponse.json(
          { error: nicknameValidation.message },
          { status: 400 }
        );
      }
      communityNickname = nicknameValidation.nickname;
    }

    // 아모라 케어 아웃바운드(모멘트 이메일) 수신 설정 — boolean만 허용
    if (body.care_notifications_enabled !== undefined) {
      if (typeof body.care_notifications_enabled !== "boolean") {
        return NextResponse.json({ error: "알림 설정 값이 올바르지 않습니다." }, { status: 400 });
      }
      careConsentUpdate = body.care_notifications_enabled;
      if (careConsentUpdate && !careChannelsAvailable(careAvailability)) {
        return profileReadResponse({
          error: "아모라 먼저 챙기기 발송은 현재 준비 중입니다.",
          code: "CARE_OUTBOUND_UNAVAILABLE",
          careAvailability,
        }, 409);
      }
    }

    // 휴대폰 번호 — 알림톡/문자 케어 채널용. 숫자만 저장, 삭제 시 채널 동의도 함께 해제.
    if (phoneProvided) {
      const cleanedPhone = cleanOptionalKoreanMobile(body.phone);
      if (cleanedPhone === undefined) {
        return NextResponse.json(
          { error: "휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)" },
          { status: 400 }
        );
      }
      phone = cleanedPhone;
    }

    // 카톡·문자 케어 수신 동의 — 동의 시각을 기록(법적 근거). 번호 없이 동의만은 불가.
    if (body.phone_care_consent !== undefined) {
      if (typeof body.phone_care_consent !== "boolean") {
        return NextResponse.json({ error: "동의 값이 올바르지 않습니다." }, { status: 400 });
      }
      phoneCareConsent = body.phone_care_consent;
      if (phoneCareConsent && phoneProvided && phone === null) {
        return NextResponse.json(
          { error: "휴대폰 번호를 먼저 입력해주세요." },
          { status: 400 }
        );
      }
    }

    if (
      name === null
      && !phoneProvided
      && phoneCareConsent === null
      && careConsentUpdate === undefined
      && !communityNicknameProvided
    ) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: patchResult, error: patchError } = await admin.rpc(
      "patch_profile_atomic",
      {
        p_user_id: user.id,
        p_name: name,
        p_phone: phone,
        p_phone_provided: phoneProvided,
        p_phone_care_consent: phoneCareConsent,
        p_care_notifications_enabled: careConsentUpdate ?? null,
        p_community_nickname: communityNickname,
        p_community_nickname_provided: communityNicknameProvided,
        p_force_community_nickname_sync:
          forceCommunityNicknameSync && name !== null,
      }
    );

    if (patchError) {
      if (isCommunityNicknameUniqueViolation(patchError)) {
        return NextResponse.json(
          { error: "이미 사용 중인 닉네임입니다." },
          { status: 409 }
        );
      }
      const errorText = isRecord(patchError)
        ? `${String(patchError.message ?? "")} ${String(patchError.details ?? "")}`
        : String(patchError);
      if (/PROFILE_PATCH_PHONE_REQUIRED/i.test(errorText)) {
        return NextResponse.json(
          { error: "휴대폰 번호를 먼저 입력해주세요." },
          { status: 400 }
        );
      }
      if (/PROFILE_PATCH_INVALID_PHONE/i.test(errorText)) {
        return NextResponse.json(
          { error: "휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)" },
          { status: 400 }
        );
      }
      if (/PROFILE_PATCH_INVALID/i.test(errorText)) {
        return NextResponse.json(
          { error: "프로필 변경 요청이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      if (/PROFILE_PATCH_PROFILE_NOT_FOUND/i.test(errorText)) {
        return NextResponse.json(
          { error: "프로필을 찾을 수 없습니다." },
          { status: 404 }
        );
      }
      console.error("Atomic profile patch failed:", patchError);
      return NextResponse.json({ error: "프로필 저장에 실패했습니다." }, { status: 500 });
    }

    if (
      !isRecord(patchResult)
      || !isRecord(patchResult.profile)
      || patchResult.profile.id !== user.id
      || typeof patchResult.community_profile_synced !== "boolean"
    ) {
      console.error("Atomic profile patch returned an invalid result.");
      return NextResponse.json({ error: "프로필 저장에 실패했습니다." }, { status: 500 });
    }

    return profileReadResponse({
      profile: patchResult.profile,
      communityProfileSynced: patchResult.community_profile_synced,
      communityNickname:
        typeof patchResult.community_nickname === "string"
          ? patchResult.community_nickname
          : null,
      careAvailability,
    });
  } catch (err) {
    console.error("Profile API error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
