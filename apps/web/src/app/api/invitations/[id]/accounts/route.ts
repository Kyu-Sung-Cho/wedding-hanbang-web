import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invitation_accounts")
    .select("*")
    .eq("invitation_id", id)
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

// 계좌 일괄 저장 (기존 삭제 후 재삽입)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { accounts } = await request.json();

  // 기존 계좌 삭제
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
}
