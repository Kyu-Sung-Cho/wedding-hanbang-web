import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { recordDecision } from "@/lib/memory/record-decision";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;

// 즐겨찾기 토글 (추가/삭제)
export async function POST(req: Request) {
  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json({ isFavorite: false });
      }
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("favorites:toggle", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const vendorId = body.vendorId;
    if (!isUuid(vendorId)) {
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
      const { error } = await supabase
        .from("vendor_favorites")
        .delete()
        .eq("id", existing.id);
      if (error) {
        return NextResponse.json({ error: "즐겨찾기 해제에 실패했습니다." }, { status: 500 });
      }
      return NextResponse.json({ isFavorite: false });
    } else {
      const { data: vendorForFavorite } = await supabase
        .from("vendors")
        .select("id, name, category")
        .eq("id", vendorId)
        .eq("status", "approved")
        .maybeSingle();
      if (!vendorForFavorite) {
        return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
      }

      // 없으면 추가
      const { error } = await supabase
        .from("vendor_favorites")
        .insert({ user_id: user.id, vendor_id: vendorId });
      if (error) {
        return NextResponse.json({ error: "즐겨찾기에 실패했습니다." }, { status: 500 });
      }

      // D2 Hook 1: decision_nodes에 '찜 = 고려 중' 기록 (fire-and-forget, dedupe)
      void (async () => {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("couple_id")
            .eq("id", user.id)
            .maybeSingle();
          const coupleId = (profile as { couple_id?: string } | null)?.couple_id;
          if (!coupleId) return;

          await recordDecision({
            coupleId,
            userId: user.id,
            category: vendorForFavorite.category ?? "vendor",
            title: `찜: ${vendorForFavorite.name}`,
            chosenValue: {
              vendor_id: vendorForFavorite.id,
              vendor_name: vendorForFavorite.name,
              vendor_category: vendorForFavorite.category,
            },
            decisionType: "considering",
            source: "manual",
            sourceRefId: vendorForFavorite.id,
            metadata: { hook: "favorites" },
            dedupeKey: {
              sourceRefId: vendorForFavorite.id,
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
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
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
