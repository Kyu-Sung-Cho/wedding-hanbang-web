import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 프로필 업데이트 (이름 등)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdminClient();
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;

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
