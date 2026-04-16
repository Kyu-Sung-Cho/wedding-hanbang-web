import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 게스트용 청첩장 조회 (인증 불필요)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClientFromRequest(_request);

  const { data: invitation, error } = await supabase
    .from("invitations")
    .select("*, invitation_templates(*)")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (error || !invitation) {
    return NextResponse.json({ error: "청첩장을 찾을 수 없습니다." }, { status: 404 });
  }

  // 사진, 계좌, 방명록 함께 로드
  const [photosRes, accountsRes, guestbookRes] = await Promise.all([
    supabase.from("invitation_photos").select("*").eq("invitation_id", invitation.id).order("sort_order"),
    supabase.from("invitation_accounts").select("*").eq("invitation_id", invitation.id).order("sort_order"),
    supabase.from("invitation_guestbook").select("*").eq("invitation_id", invitation.id).eq("is_hidden", false).order("created_at", { ascending: false }).limit(50),
  ]);

  // 방문 기록
  await supabase.from("invitation_visits").insert({ invitation_id: invitation.id });

  // 조회수 증가
  await supabase
    .from("invitations")
    .update({ view_count: (invitation.view_count || 0) + 1 })
    .eq("id", invitation.id);

  return NextResponse.json({
    invitation: {
      ...invitation,
      template: invitation.invitation_templates,
      invitation_templates: undefined,
    },
    photos: photosRes.data ?? [],
    accounts: accountsRes.data ?? [],
    guestbook: guestbookRes.data ?? [],
  });
}

// 게스트 RSVP 제출
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClientFromRequest(request);

  // slug로 invitation_id 조회
  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, rsvp_enabled")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (!invitation) {
    return NextResponse.json({ error: "청첩장을 찾을 수 없습니다." }, { status: 404 });
  }

  if (!invitation.rsvp_enabled) {
    return NextResponse.json({ error: "RSVP가 비활성화되어 있습니다." }, { status: 400 });
  }

  const body = await request.json();
  const { type, ...data } = body;

  if (type === "rsvp") {
    const { data: rsvp, error } = await supabase
      .from("invitation_rsvp")
      .insert({
        invitation_id: invitation.id,
        guest_name: data.guest_name,
        phone: data.phone,
        attending: data.attending,
        guest_count: data.guest_count || 1,
        meal_option: data.meal_option,
        side: data.side,
        message: data.message,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rsvp }, { status: 201 });
  }

  if (type === "guestbook") {
    const { data: entry, error } = await supabase
      .from("invitation_guestbook")
      .insert({
        invitation_id: invitation.id,
        guest_name: data.guest_name,
        message: data.message,
        password: data.password,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry }, { status: 201 });
  }

  return NextResponse.json({ error: "잘못된 타입" }, { status: 400 });
}
