import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 청첩장 목록 조회
export async function GET(request: Request) {
  const supabase = await createClient();
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invitations = (data ?? []).map((inv) => ({
    ...inv,
    template: inv.invitation_templates,
    invitation_templates: undefined,
  }));

  return NextResponse.json({ invitations });
}

// 청첩장 생성
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await request.json();
  const { couple_id, template_id, ...rest } = body;

  if (!couple_id || !template_id) {
    return NextResponse.json({ error: "couple_id, template_id 필요" }, { status: 400 });
  }

  // 슬러그 생성: 랜덤 8자
  const slug = generateSlug();

  const { data, error } = await supabase
    .from("invitations")
    .insert({ couple_id, template_id, slug, ...rest })
    .select("*, invitation_templates(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invitation = {
    ...data,
    template: data.invitation_templates,
    invitation_templates: undefined,
  };

  return NextResponse.json({ invitation }, { status: 201 });
}

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}
