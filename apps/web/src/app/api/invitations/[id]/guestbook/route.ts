import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(_request);

    const { data, error } = await supabase
      .from("invitation_guestbook")
      .select("*")
      .eq("invitation_id", id)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ guestbook: data ?? [] });
  } catch (err) {
    console.error("[invitation guestbook GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
