import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseJourneyScalarPatch } from "@/lib/journey/journeyScalarPatch";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

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

    const updates = parseJourneyScalarPatch(await request.json().catch(() => null));
    if (!updates) {
      return NextResponse.json(
        { error: "결혼일, 전체 예산, 예식장만 이 경로에서 수정할 수 있습니다." },
        { status: 400 },
      );
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

    const { data: journey, error } = await admin
      .from("wedding_journeys")
      .update(updates)
      .eq("couple_id", profile.couple_id)
      .select()
      .single();

    if (error || !journey) {
      console.error("journey scalar update failed:", error);
      return NextResponse.json({ error: "기본 정보를 저장하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ journey });
  } catch (error) {
    console.error("Journey API error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
