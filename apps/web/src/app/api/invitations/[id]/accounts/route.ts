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
      .from("invitation_accounts")
      .select("*")
      .eq("invitation_id", id)
      .order("sort_order");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ accounts: data ?? [] });
  } catch (err) {
    console.error("[invitation accounts GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    // 소유권 검증: invitation → couple → bride_id/groom_id 중 하나여야 함
    const { data: invitation } = await supabase
      .from("invitations")
      .select("couple_id")
      .eq("id", id)
      .single();

    if (!invitation) {
      return NextResponse.json({ error: "청첩장을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: couple } = await supabase
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", invitation.couple_id)
      .single();

    if (!couple || (couple.bride_id !== user.id && couple.groom_id !== user.id)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { accounts } = await request.json();

    await supabase.from("invitation_accounts").delete().eq("invitation_id", id);

    if (accounts && accounts.length > 0) {
      const rows = accounts.map((acc: Record<string, unknown>, i: number) => ({
        invitation_id: id,
        side: acc.side,
        label: acc.label,
        bank: acc.bank,
        account_number: acc.account_number,
        holder: acc.holder,
        sort_order: i,
      }));

      const { data, error } = await supabase
        .from("invitation_accounts")
        .insert(rows)
        .select();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ accounts: data });
    }

    return NextResponse.json({ accounts: [] });
  } catch (err) {
    console.error("[invitation accounts PUT]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
