import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 청첩장 목록 조회
export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const coupleId = searchParams.get("coupleId");
    if (!coupleId) return NextResponse.json({ error: "coupleId 필요" }, { status: 400 });

    const { data, error } = await supabase
      .from("invitations")
      .select("*, invitation_templates(*)")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[invitations GET]", error);
      return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
    }

    const invitations = (data ?? []).map((inv) => ({
      ...inv,
      template: inv.invitation_templates,
      invitation_templates: undefined,
    }));

    return NextResponse.json({ invitations });
  } catch (err) {
    console.error("[invitations GET uncaught]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// 청첩장 생성
export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const body = await request.json();
    const { couple_id, template_id, ...rest } = body;

    if (!couple_id || !template_id) {
      return NextResponse.json({ error: "couple_id, template_id 필요" }, { status: 400 });
    }

    const slug = generateSlug();

    const { data, error } = await supabase
      .from("invitations")
      .insert({ couple_id, template_id, slug, ...rest })
      .select("*, invitation_templates(*)")
      .single();

    if (error) {
      console.error("[invitations POST]", error);
      return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
    }

    const invitation = {
      ...data,
      template: data.invitation_templates,
      invitation_templates: undefined,
    };

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (err) {
    console.error("[invitations POST uncaught]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

function generateSlug(): string {
  const { randomBytes } = require("crypto");
  return randomBytes(8).toString("hex");
}
