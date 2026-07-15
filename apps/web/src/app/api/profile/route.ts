import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { toSafeProfileDto } from "@/lib/profile/safeProfile";
import {
  cleanOptionalKoreanMobile,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_PROFILE_PATCH_KEYS = new Set([
  "name",
  "care_notifications_enabled",
  "phone",
  "phone_care_consent",
]);

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("profile:update", request, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 },
      user.id,
    );
    if (limited) return limited;

    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const unexpectedKey = Object.keys(body).find(
      (key) => !ALLOWED_PROFILE_PATCH_KEYS.has(key),
    );
    if (unexpectedKey) {
      return NextResponse.json(
        {
          error:
            unexpectedKey === "sync_community_nickname"
              ? "계정 이름과 커뮤니티 닉네임은 별도로 관리됩니다."
              : "허용되지 않은 수정 항목입니다.",
        },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = cleanOptionalText(body.name, 80);
      if (!name) {
        return NextResponse.json(
          { error: "이름 형식이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    // Outbound care notifications stay disabled until consent, withdrawal,
    // deduplication, and delivery E2E controls have shipped.
    if (body.care_notifications_enabled !== undefined) {
      if (typeof body.care_notifications_enabled !== "boolean") {
        return NextResponse.json(
          { error: "알림 설정 값이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      if (body.care_notifications_enabled) {
        return NextResponse.json(
          { error: "아모라 실제 알림은 아직 준비 중입니다." },
          { status: 409 },
        );
      }
      updates.care_notifications_enabled = false;
    }

    // No active feature consumes a phone number. Existing values may only be
    // erased; new values are rejected until a documented purpose exists.
    if (body.phone !== undefined) {
      const phone = cleanOptionalKoreanMobile(body.phone);
      if (phone === undefined) {
        return NextResponse.json(
          { error: "휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)" },
          { status: 400 },
        );
      }
      if (phone) {
        return NextResponse.json(
          { error: "현재 사용처가 없어 휴대폰 번호를 새로 저장하지 않습니다." },
          { status: 409 },
        );
      }
      updates.phone = null;
      updates.phone_care_consented_at = null;
    }

    if (body.phone_care_consent !== undefined) {
      if (typeof body.phone_care_consent !== "boolean") {
        return NextResponse.json(
          { error: "동의 값이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      if (body.phone_care_consent) {
        return NextResponse.json(
          { error: "문자·알림톡 자동 알림은 아직 준비 중입니다." },
          { status: 409 },
        );
      }
      updates.phone_care_consented_at = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    // This endpoint is intentionally account-only. Community identity can be
    // changed explicitly through /api/community/profile and nowhere else.
    const { data: profile, error } = await getAdminClient()
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, name, role, couple_id, onboarding_completed, onboarding_step, phone")
      .single();

    if (error) {
      console.error("Profile update error:", error);
      return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
    }

    const safeProfile = toSafeProfileDto(profile);
    if (!safeProfile) {
      console.error("Profile update returned an invalid safe DTO", { userId: user.id });
      return NextResponse.json(
        { error: "업데이트 결과를 확인하지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ profile: safeProfile });
  } catch (error) {
    console.error("Profile API error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
