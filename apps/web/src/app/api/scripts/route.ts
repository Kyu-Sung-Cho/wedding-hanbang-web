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

    const { data, error } = await supabase
      .from("ai_scripts")
      .select("*")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ scripts: data ?? [] });
  } catch (err) {
    console.error("[scripts GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
