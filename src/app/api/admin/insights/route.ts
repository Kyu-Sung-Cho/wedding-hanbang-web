import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 관리자 확인
    const { data: adminCheck } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminCheck) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "30d";
    const days = period === "90d" ? 90 : period === "7d" ? 7 : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString();

    // 전체 조회수
    const { count: totalViews } = await supabase
      .from("vendor_views")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startStr);

    // 전체 즐겨찾기
    const { count: totalFavorites } = await supabase
      .from("vendor_favorites")
      .select("id", { count: "exact", head: true });

    // 기간 내 신규 즐겨찾기
    const { count: newFavorites } = await supabase
      .from("vendor_favorites")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startStr);

    // 전체 예약
    const { data: bookings } = await supabase
      .from("vendor_bookings")
      .select("status, created_at, vendor_id")
      .gte("created_at", startStr);

    const totalBookings = (bookings ?? []).length;
    const confirmedBookings = (bookings ?? []).filter(b => b.status === "confirmed" || b.status === "completed").length;

    // 활성 사용자 (기간 내 이벤트 발생)
    const { data: activeUserEvents } = await supabase
      .from("customer_events")
      .select("user_id, created_at")
      .gte("created_at", startStr);
    const activeUsers = new Set((activeUserEvents ?? []).map(e => e.user_id).filter(Boolean)).size;

    // 전체 등록 사용자
    const { count: totalUsers } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    // 전체 업체 수
    const { count: totalVendors } = await supabase
      .from("vendors")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");

    // 인기 업체 (조회수 + 즐겨찾기 + 예약 기준)
    const { data: vendorViews } = await supabase
      .from("vendor_views")
      .select("vendor_id")
      .gte("created_at", startStr);

    const viewCountMap = new Map<string, number>();
    for (const v of vendorViews ?? []) {
      viewCountMap.set(v.vendor_id, (viewCountMap.get(v.vendor_id) ?? 0) + 1);
    }

    const { data: vendorFavs } = await supabase
      .from("vendor_favorites")
      .select("vendor_id");

    const favCountMap = new Map<string, number>();
    for (const f of vendorFavs ?? []) {
      favCountMap.set(f.vendor_id, (favCountMap.get(f.vendor_id) ?? 0) + 1);
    }

    const bookingCountMap = new Map<string, number>();
    for (const b of bookings ?? []) {
      bookingCountMap.set(b.vendor_id, (bookingCountMap.get(b.vendor_id) ?? 0) + 1);
    }

    // 상위 업체 가져오기
    const allVendorIds = new Set([...viewCountMap.keys(), ...favCountMap.keys(), ...bookingCountMap.keys()]);
    const topVendorScores = Array.from(allVendorIds).map(id => ({
      id,
      views: viewCountMap.get(id) ?? 0,
      favorites: favCountMap.get(id) ?? 0,
      bookings: bookingCountMap.get(id) ?? 0,
      score: (viewCountMap.get(id) ?? 0) + (favCountMap.get(id) ?? 0) * 5 + (bookingCountMap.get(id) ?? 0) * 10,
    })).sort((a, b) => b.score - a.score).slice(0, 10);

    // 업체 이름 가져오기
    const topIds = topVendorScores.map(v => v.id);
    const { data: vendorNames } = topIds.length > 0
      ? await supabase.from("vendors").select("id, name, category").in("id", topIds)
      : { data: [] };

    const vendorNameMap = new Map((vendorNames ?? []).map(v => [v.id, { name: v.name, category: v.category }]));

    const topVendors = topVendorScores.map(v => ({
      id: v.id,
      name: vendorNameMap.get(v.id)?.name ?? "알 수 없음",
      category: vendorNameMap.get(v.id)?.category ?? "",
      views: v.views,
      favorites: v.favorites,
      bookings: v.bookings,
    }));

    // 카테고리별 통계
    const { data: allVendors } = await supabase
      .from("vendors")
      .select("id, category, rating")
      .eq("status", "approved");

    const categoryMap = new Map<string, { count: number; bookings: number; totalRating: number }>();
    for (const v of allVendors ?? []) {
      const cat = v.category || "기타";
      const entry = categoryMap.get(cat) ?? { count: 0, bookings: 0, totalRating: 0 };
      entry.count++;
      entry.totalRating += v.rating ?? 0;
      entry.bookings += bookingCountMap.get(v.id) ?? 0;
      categoryMap.set(cat, entry);
    }

    const categoryStats = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        vendorCount: data.count,
        bookingCount: data.bookings,
        avgRating: data.count > 0 ? Number((data.totalRating / data.count).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.vendorCount - a.vendorCount);

    // 일별 활성 사용자 트렌드
    const dailyActiveMap = new Map<string, Set<string>>();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - days + i + 1);
      const dateStr = d.toISOString().split("T")[0];
      dailyActiveMap.set(dateStr, new Set());
    }

    for (const e of activeUserEvents ?? []) {
      if (!e.user_id) continue;
      const dateStr = new Date(e.created_at ?? "").toISOString().split("T")[0];
      dailyActiveMap.get(dateStr)?.add(e.user_id);
    }

    const dailyActiveUsers = Array.from(dailyActiveMap.entries()).map(([date, users]) => ({
      date,
      count: users.size,
    }));

    // 이벤트 유형 분석
    const { data: allEvents } = await supabase
      .from("customer_events")
      .select("event_type")
      .gte("created_at", startStr);

    const eventTypeMap = new Map<string, number>();
    for (const e of allEvents ?? []) {
      eventTypeMap.set(e.event_type, (eventTypeMap.get(e.event_type) ?? 0) + 1);
    }

    const eventBreakdown = Array.from(eventTypeMap.entries())
      .map(([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => b.count - a.count);

    // 페이지뷰 분석
    const { data: pageViewEvents } = await supabase
      .from("customer_events")
      .select("metadata")
      .eq("event_type", "page_view")
      .gte("created_at", startStr)
      .limit(500);

    const pageCountMap = new Map<string, number>();
    for (const e of pageViewEvents ?? []) {
      const path = (e.metadata as Record<string, string>)?.path;
      if (path) {
        pageCountMap.set(path, (pageCountMap.get(path) ?? 0) + 1);
      }
    }

    const topPages = Array.from(pageCountMap.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // 즐겨찾기 트렌드
    const { data: favTrendRaw } = await supabase
      .from("vendor_favorites")
      .select("created_at")
      .gte("created_at", startStr);

    const favTrendMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - days + i + 1);
      favTrendMap.set(d.toISOString().split("T")[0], 0);
    }
    for (const f of favTrendRaw ?? []) {
      const dateStr = new Date(f.created_at).toISOString().split("T")[0];
      if (favTrendMap.has(dateStr)) {
        favTrendMap.set(dateStr, (favTrendMap.get(dateStr) ?? 0) + 1);
      }
    }

    const favoriteTrend = Array.from(favTrendMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    return NextResponse.json({
      overview: {
        totalViews: totalViews ?? 0,
        totalFavorites: totalFavorites ?? 0,
        newFavorites: newFavorites ?? 0,
        totalBookings,
        confirmedBookings,
        activeUsers,
        totalUsers: totalUsers ?? 0,
        totalVendors: totalVendors ?? 0,
      },
      topVendors,
      categoryStats,
      customerActivity: {
        dailyActiveUsers,
        eventBreakdown,
        topPages,
      },
      favoriteInsights: {
        trend: favoriteTrend,
      },
    });
  } catch (err) {
    console.error("Admin insights error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
