import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// 즐겨찾기 토글 (추가/삭제)
export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { vendorId } = await req.json();
    if (!vendorId) {
      return NextResponse.json({ error: "vendorId가 필요합니다." }, { status: 400 });
    }

    // 이미 즐겨찾기했는지 확인
    const { data: existing } = await supabase
      .from("vendor_favorites")
      .select("id")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId)
      .maybeSingle();

    if (existing) {
      // 이미 있으면 삭제
      await supabase
        .from("vendor_favorites")
        .delete()
        .eq("id", existing.id);
      return NextResponse.json({ isFavorite: false });
    } else {
      // 없으면 추가
      await supabase
        .from("vendor_favorites")
        .insert({ user_id: user.id, vendor_id: vendorId });
      return NextResponse.json({ isFavorite: true });
    }
  } catch (err) {
    console.error("Favorite toggle error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

// 내 즐겨찾기 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: favorites } = await supabase
      .from("vendor_favorites")
      .select("vendor_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const vendorIds = (favorites ?? []).map(f => f.vendor_id);

    return NextResponse.json({ vendorIds, favorites: favorites ?? [] });
  } catch (err) {
    console.error("Favorites list error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
