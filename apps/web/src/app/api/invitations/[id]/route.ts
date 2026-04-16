import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 청첩장 상세 조회
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClientFromRequest(_request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data: invitation, error } = await supabase
    .from("invitations")
    .select("*, invitation_templates(*)")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // 사진, 계좌 함께 로드
  const [photosRes, accountsRes] = await Promise.all([
    supabase.from("invitation_photos").select("*").eq("invitation_id", id).order("sort_order"),
    supabase.from("invitation_accounts").select("*").eq("invitation_id", id).order("sort_order"),
  ]);

  return NextResponse.json({
    invitation: {
      ...invitation,
      template: invitation.invitation_templates,
      invitation_templates: undefined,
    },
    photos: photosRes.data ?? [],
    accounts: accountsRes.data ?? [],
  });
}

// 청첩장 수정
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await request.json();

  const { data, error } = await supabase
    .from("invitations")
    .update(body)
    .eq("id", id)
    .select("*, invitation_templates(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    invitation: {
      ...data,
      template: data.invitation_templates,
      invitation_templates: undefined,
    },
  });
}

// 청첩장 삭제
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClientFromRequest(_request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { error } = await supabase.from("invitations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
