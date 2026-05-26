import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { recordDecision } from "@/lib/memory/record-decision";

// 즐겨찾기 토글 (추가/삭제)
export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (req.headers.get("cookie")?.includes("demo_mode=true")) {
        return NextResponse.json({ isFavorite: false });
      }
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

      // D2 Hook 1: decision_nodes에 '찜 = 고려 중' 기록 (fire-and-forget, dedupe)
      // vendor 정보 조회 (카테고리/이름)
      void (async () => {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("couple_id")
            .eq("id", user.id)
            .maybeSingle();
          const coupleId = (profile as { couple_id?: string } | null)?.couple_id;
          if (!coupleId) return;

          const { data: vendor } = await supabase
            .from("vendors")
            .select("id, name, category")
            .eq("id", vendorId)
            .maybeSingle();
          const v = vendor as { id: string; name: string; category: string } | null;
          if (!v) return;

          await recordDecision({
            coupleId,
            userId: user.id,
            category: v.category ?? "vendor",
            title: `찜: ${v.name}`,
            chosenValue: { vendor_id: v.id, vendor_name: v.name, vendor_category: v.category },
            decisionType: "considering",
            source: "manual",
            sourceRefId: v.id,
            metadata: { hook: "favorites" },
            dedupeKey: {
              sourceRefId: v.id,
              source: "manual",
              decisionType: "considering",
            },
          });
        } catch (err) {
          console.error("[favorites recordDecision] 실패 (무시):", err);
        }
      })();

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
      if (req.headers.get("cookie")?.includes("demo_mode=true")) {
        return NextResponse.json({ vendorIds: [], favorites: [] });
      }
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
