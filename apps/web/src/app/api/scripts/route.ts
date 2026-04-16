import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// AI 대본 목록 조회
export async function GET(request: Request) {
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
}
