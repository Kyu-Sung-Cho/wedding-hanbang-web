import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalText, isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 프로필 업데이트 (이름 등)
export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("profile:update", request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const admin = getAdminClient();
    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = cleanOptionalText(body.name, 80);
      if (!name) {
        return NextResponse.json({ error: "이름 형식이 올바르지 않습니다." }, { status: 400 });
      }
      updates.name = name;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const { data: profile, error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      console.error("프로필 업데이트 에러:", error);
      return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ profile });
  } catch (err) {
    console.error("Profile API 에러:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
