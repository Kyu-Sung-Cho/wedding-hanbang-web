import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data, error } = await supabase
      .from("invitation_templates")
      .select("*")
      .order("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const templates = (data ?? []).map((t) => ({
      ...t,
      color_palette: typeof t.color_palette === "string" ? JSON.parse(t.color_palette) : t.color_palette,
      font_pair: typeof t.font_pair === "string" ? JSON.parse(t.font_pair) : t.font_pair,
      layout_config: typeof t.layout_config === "string" ? JSON.parse(t.layout_config) : t.layout_config,
    }));

    return NextResponse.json({ templates });
  } catch (err) {
    console.error("[invitation templates GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
