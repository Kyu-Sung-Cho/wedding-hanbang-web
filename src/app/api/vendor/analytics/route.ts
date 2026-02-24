import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 업체 소유 확인
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "7d";
    const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString();

    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - days);
    const prevStartStr = prevStartDate.toISOString();

    // 현재 기간 이벤트
    const { data: events } = await supabase
      .from("customer_events")
      .select("event_type, product_id, metadata, duration_seconds, created_at, user_id")
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr)
      .order("created_at", { ascending: true });

    // 이전 기간 이벤트 (비교용)
    const { data: prevEvents } = await supabase
      .from("customer_events")
      .select("event_type, user_id")
      .eq("vendor_id", vendor.id)
      .gte("created_at", prevStartStr)
      .lt("created_at", startStr);

    // vendor_views (기존 테이블)
    const { count: viewCount } = await supabase
      .from("vendor_views")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr);

    const { count: prevViewCount } = await supabase
      .from("vendor_views")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id)
      .gte("created_at", prevStartStr)
      .lt("created_at", startStr);

    // 고유 방문자
    const { data: uniqueVisitorRows } = await supabase
      .from("vendor_views")
      .select("viewer_id")
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr);
    const uniqueVisitors = new Set((uniqueVisitorRows ?? []).map((r) => r.viewer_id).filter(Boolean)).size;

    // 즐겨찾기 수
    const { count: favoriteCount } = await supabase
      .from("vendor_favorites")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id);

    // 예약 통계
    const { data: bookings } = await supabase
      .from("vendor_bookings")
      .select("status, created_at")
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr);

    const bookingRequests = (bookings ?? []).length;
    const bookingConfirmed = (bookings ?? []).filter((b) => b.status === "confirmed" || b.status === "completed").length;

    // 전환율 (조회 → 예약)
    const totalViews = viewCount ?? 0;
    const conversionRate = totalViews > 0 ? ((bookingRequests / totalViews) * 100) : 0;

    // 평균 체류시간
    const durationEvents = (events ?? []).filter((e) => e.event_type === "view_duration" && e.duration_seconds);
    const avgViewDuration = durationEvents.length > 0
      ? Math.round(durationEvents.reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0) / durationEvents.length)
      : 0;

    // 일별 트렌드
    const trendMap = new Map<string, { views: number; bookings: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - days + i + 1);
      const dateStr = d.toISOString().split("T")[0];
      trendMap.set(dateStr, { views: 0, bookings: 0 });
    }

    // 조회 트렌드 (vendor_views 기반)
    const { data: viewTrend } = await supabase
      .from("vendor_views")
      .select("created_at")
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr);

    for (const v of viewTrend ?? []) {
      const dateStr = new Date(v.created_at).toISOString().split("T")[0];
      const entry = trendMap.get(dateStr);
      if (entry) entry.views++;
    }
    for (const b of bookings ?? []) {
      const dateStr = new Date(b.created_at).toISOString().split("T")[0];
      const entry = trendMap.get(dateStr);
      if (entry) entry.bookings++;
    }

    const trend = Array.from(trendMap.entries()).map(([date, data]) => ({
      date,
      views: data.views,
      bookings: data.bookings,
    }));

    // 상품별 성과
    const { data: products } = await supabase
      .from("vendor_products")
      .select("id, name")
      .eq("vendor_id", vendor.id)
      .eq("is_active", true);

    const productViewEvents = (events ?? []).filter((e) => e.event_type === "product_view" && e.product_id);
    const productBookings = await supabase
      .from("vendor_bookings")
      .select("product_id, status")
      .eq("vendor_id", vendor.id)
      .gte("created_at", startStr)
      .not("product_id", "is", null);

    const productStats = (products ?? []).map((p) => {
      const pViews = productViewEvents.filter((e) => e.product_id === p.id).length;
      const pBookings = (productBookings.data ?? []).filter((b) => b.product_id === p.id).length;
      return {
        id: p.id,
        name: p.name,
        views: pViews,
        bookings: pBookings,
        conversionRate: pViews > 0 ? Number(((pBookings / pViews) * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.views - a.views);

    // 유입 경로 분석
    const viewEvents = (events ?? []).filter((e) => e.event_type === "vendor_view");
    const sources = { search: 0, recommendation: 0, direct: 0 };
    for (const e of viewEvents) {
      const source = (e.metadata as Record<string, string>)?.source || "direct";
      if (source === "search") sources.search++;
      else if (source === "recommendation") sources.recommendation++;
      else sources.direct++;
    }

    // 피크 시간대
    const hourCounts = new Array(24).fill(0);
    for (const v of viewTrend ?? []) {
      const hour = new Date(v.created_at).getHours();
      hourCounts[hour]++;
    }

    // 검색 등장 키워드
    const { data: searchLogs } = await supabase
      .from("search_logs")
      .select("query")
      .eq("clicked_vendor_id", vendor.id)
      .gte("created_at", startStr)
      .limit(50);

    const searchTermCounts = new Map<string, number>();
    for (const log of searchLogs ?? []) {
      searchTermCounts.set(log.query, (searchTermCounts.get(log.query) ?? 0) + 1);
    }
    const topSearchTerms = Array.from(searchTermCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term, count]) => ({ term, count }));

    // 변화율 계산
    const prevViews = prevViewCount ?? 0;
    const viewChange = prevViews > 0 ? (((totalViews - prevViews) / prevViews) * 100) : 0;
    const prevBookingCount = (prevEvents ?? []).filter((e) => e.event_type === "booking_complete").length;
    const bookingChange = prevBookingCount > 0 ? (((bookingRequests - prevBookingCount) / prevBookingCount) * 100) : 0;

    return NextResponse.json({
      overview: {
        totalViews,
        viewChange: Number(viewChange.toFixed(1)),
        uniqueVisitors,
        favoriteCount: favoriteCount ?? 0,
        bookingRequests,
        bookingConfirmed,
        bookingChange: Number(bookingChange.toFixed(1)),
        conversionRate: Number(conversionRate.toFixed(1)),
        avgViewDuration,
      },
      trend,
      products: productStats,
      customerInsights: {
        topSearchTerms,
        viewSources: sources,
        peakHours: hourCounts,
      },
    });
  } catch (err) {
    console.error("Analytics API error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
