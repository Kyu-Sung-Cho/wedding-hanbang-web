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

    // 본인 couple만 조회 가능
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.couple_id !== coupleId) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("congratulatory_money")
      .select("*")
      .eq("couple_id", coupleId)
      .order("received_at", { ascending: false });

    if (error) {
      console.error("[money GET] supabase:", error);
      return NextResponse.json({ error: "축의금 정보를 불러올 수 없습니다." }, { status: 500 });
    }
    return NextResponse.json({ moneyList: data ?? [] });
  } catch (err) {
    console.error("[money GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const body = await request.json();

    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보 없음" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("congratulatory_money")
      .insert({
        couple_id: profile.couple_id,
        guest_name: body.guest_name,
        amount: body.amount,
        side: body.side,
        relation: body.relation,
        method: body.method || "cash",
        memo: body.memo,
        received_at: body.received_at || new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ money: data }, { status: 201 });
  } catch (err) {
    console.error("[money POST]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
