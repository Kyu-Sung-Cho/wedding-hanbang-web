import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const coupleId = searchParams.get("coupleId");
    if (!coupleId) return NextResponse.json({ error: "coupleId 필요" }, { status: 400 });

    // 본인 couple만 조회 가능
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.couple_id !== coupleId) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("ai_scripts")
      .select("*")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[scripts GET] supabase:", error);
      return NextResponse.json({ error: "스크립트를 불러올 수 없습니다." }, { status: 500 });
    }
    return NextResponse.json({ scripts: data ?? [] });
  } catch (err) {
    console.error("[scripts GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
