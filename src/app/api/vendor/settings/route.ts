import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { notificationSettings } = await req.json();

    const { error } = await supabase
      .from("vendors")
      .update({ notification_settings: notificationSettings })
      .eq("owner_id", user.id);

    if (error) {
      return NextResponse.json({ error: "설정 저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Vendor settings error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
