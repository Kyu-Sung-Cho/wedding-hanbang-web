import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";

interface CommunityPostInsightRow {
  id: string;
  title: string | null;
  category: string | null;
  author_id: string;
  bookmark_count: number | null;
  view_count: number | null;
  comment_count: number | null;
  created_at: string | null;
}

interface CommunityProfileNicknameRow {
  user_id: string;
  nickname: string | null;
}

const MAX_ANALYTICS_ROWS = 25_000;

class InsightsCapacityError extends Error {}

function boundedAnalyticsRows<T>(data: T[] | null, error: unknown): T[] {
  if (error) throw new Error("INSIGHTS_QUERY_FAILED");
  if ((data?.length ?? 0) > MAX_ANALYTICS_ROWS) {
    throw new InsightsCapacityError("INSIGHTS_SAFE_LIMIT_EXCEEDED");
  }
  return data ?? [];
}

export async function GET(req: Request) {
  try {
    // verifyAdmin으로 통일 (profiles.is_admin 체크)
    const { authorized, userId } = await verifyAdmin(req);
    if (!authorized || !userId) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    // service client 사용 (RLS 우회)
    const limited = await checkRateLimitPersistent(
      rateLimitKey("admin:insights", req, userId),
      { maxRequests: 6, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    const supabase = getServiceClient();

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
    const { data: bookingsRaw, error: bookingsError } = await supabase
      .from("vendor_bookings")
      .select("status, created_at, vendor_id")
      .gte("created_at", startStr)
      .limit(MAX_ANALYTICS_ROWS + 1);
    const bookings = boundedAnalyticsRows(bookingsRaw, bookingsError);

    const totalBookings = (bookings ?? []).length;
    const confirmedBookings = (bookings ?? []).filter(b => b.status === "confirmed" || b.status === "completed").length;

    // 활성 사용자 (기간 내 이벤트 발생)
    const { data: activeUserEventsRaw, error: activeUserEventsError } = await supabase
      .from("customer_events")
      .select("user_id, created_at")
      .gte("created_at", startStr)
      .limit(MAX_ANALYTICS_ROWS + 1);
    const activeUserEvents = boundedAnalyticsRows(activeUserEventsRaw, activeUserEventsError);
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
    const { data: vendorViewsRaw, error: vendorViewsError } = await supabase
      .from("vendor_views")
      .select("vendor_id")
      .gte("created_at", startStr)
      .limit(MAX_ANALYTICS_ROWS + 1);
    const vendorViews = boundedAnalyticsRows(vendorViewsRaw, vendorViewsError);

    const viewCountMap = new Map<string, number>();
    for (const v of vendorViews ?? []) {
      viewCountMap.set(v.vendor_id, (viewCountMap.get(v.vendor_id) ?? 0) + 1);
    }

    const { data: vendorFavsRaw, error: vendorFavsError } = await supabase
      .from("vendor_favorites")
      .select("vendor_id")
      .limit(MAX_ANALYTICS_ROWS + 1);
    const vendorFavs = boundedAnalyticsRows(vendorFavsRaw, vendorFavsError);

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
    const { data: allVendorsRaw, error: allVendorsError } = await supabase
      .from("vendors")
      .select("id, category, rating")
      .eq("status", "approved")
      .limit(MAX_ANALYTICS_ROWS + 1);
    const allVendors = boundedAnalyticsRows(allVendorsRaw, allVendorsError);

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
    const { data: allEventsRaw, error: allEventsError } = await supabase
      .from("customer_events")
      .select("event_type")
      .gte("created_at", startStr)
      .limit(MAX_ANALYTICS_ROWS + 1);
    const allEvents = boundedAnalyticsRows(allEventsRaw, allEventsError);

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
    const { data: favTrendRawData, error: favTrendError } = await supabase
      .from("vendor_favorites")
      .select("created_at")
      .gte("created_at", startStr)
      .limit(MAX_ANALYTICS_ROWS + 1);
    const favTrendRaw = boundedAnalyticsRows(favTrendRawData, favTrendError);

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

    const { data: savedPostsRaw } = await supabase
      .from("community_posts")
      .select("id, title, category, author_id, bookmark_count, view_count, comment_count, created_at")
      .neq("visibility", "draft")
      .gt("bookmark_count", 0)
      .order("bookmark_count", { ascending: false })
      .limit(10);

    const savedPosts = (savedPostsRaw ?? []) as CommunityPostInsightRow[];
    const savedPostAuthorIds = [...new Set(savedPosts.map((post) => post.author_id))];
    const { data: savedPostProfilesRaw } = savedPostAuthorIds.length > 0
      ? await supabase
          .from("community_profiles")
          .select("user_id, nickname")
          .in("user_id", savedPostAuthorIds)
      : { data: [] };
    const savedPostProfiles = (savedPostProfilesRaw ?? []) as CommunityProfileNicknameRow[];
    const nicknameMap = new Map(
      savedPostProfiles.map((profile) => [profile.user_id, profile.nickname ?? "익명"])
    );

    const topSavedCommunityPosts = savedPosts.map((post) => ({
      id: post.id,
      title: post.title ?? "제목 없음",
      category: post.category ?? "unknown",
      authorNickname: nicknameMap.get(post.author_id) ?? "익명",
      bookmarkCount: Math.max(0, post.bookmark_count ?? 0),
      viewCount: Math.max(0, post.view_count ?? 0),
      commentCount: Math.max(0, post.comment_count ?? 0),
      createdAt: post.created_at,
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
      topSavedCommunityPosts,
    });
  } catch (err) {
    if (err instanceof InsightsCapacityError) {
      return NextResponse.json(
        {
          error: "분석 데이터가 안전 처리 한도를 초과했습니다.",
          code: "INSIGHTS_SAFE_LIMIT_EXCEEDED",
        },
        { status: 503 },
      );
    }
    console.error("Admin insights error:", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
