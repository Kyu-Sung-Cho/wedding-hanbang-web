import { NextResponse } from "next/server";
import {
  isJourneyPreferences,
  type JourneyPreferences,
} from "@/lib/journey/journeyPreferencesClient";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;

function parsePatch(body: unknown): JourneyPreferences | null {
  return isJourneyPreferences(body) && Object.keys(body).length > 0 ? body : null;
}

function validateResult(data: unknown, patch: JourneyPreferences) {
  if (
    !isRecord(data) ||
    !isRecord(data.progress) ||
    !isJourneyPreferences(data.preferences) ||
    !isJourneyPreferences(data.progress.__preferences) ||
    JSON.stringify(data.preferences) !== JSON.stringify(data.progress.__preferences) ||
    Object.entries(patch).some(([key, value]) =>
      JSON.stringify((data.preferences as Record<string, unknown>)[key]) !== JSON.stringify(value)
    )
  ) {
    return null;
  }
  return data as {
    progress: Record<string, unknown>;
    preferences: JourneyPreferences;
  };
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const patch = parsePatch(await request.json().catch(() => null));
    if (!patch) {
      return NextResponse.json({ error: "웨딩 스타일 입력값을 확인해 주세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();
    if (profileError || !profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    const { data, error } = await admin.rpc("patch_journey_preferences", {
      p_couple_id: profile.couple_id,
      p_patch: patch,
    });
    if (error) {
      console.error("atomic journey preference patch failed:", error);
      return NextResponse.json(
        { error: error.code === "P0002" ? "웨딩 여정을 찾을 수 없습니다." : "웨딩 스타일을 저장하지 못했습니다." },
        { status: error.code === "P0002" ? 404 : 500 },
      );
    }

    const result = validateResult(data, patch);
    if (!result) {
      console.error("atomic journey preference patch returned malformed data");
      return NextResponse.json({ error: "저장 결과를 확인하지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Journey preferences API error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
