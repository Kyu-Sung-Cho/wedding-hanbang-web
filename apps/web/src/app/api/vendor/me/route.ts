import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct, bookingRowToBooking } from "@/lib/utils/vendorMapper";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 내 업체 조회
    const { data: vendorRow, error: vendorErr } = await supabase
      .from("vendors")
      .select("*")
      .eq("owner_id", user.id)
      .single();

    if (vendorErr || !vendorRow) {
      // 관리자인 경우 첫 번째 업체 데이터를 보여줌 (관리자 모드)
      const serviceClient = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      if (profile?.is_admin) {
        // 관리자용 가상 업체 데이터
        return NextResponse.json({
          vendor: {
            id: "admin",
            name: "관리자 모드",
            category: "admin",
            status: "approved",
            ownerName: "관리자",
            phone: "",
            email: user.email || "",
            address: "",
            location: "",
            region: "",
            priceMin: 0,
            priceMax: 0,
            priceRange: "",
            description: "관리자 계정으로 접속 중입니다.",
            tags: [],
            businessNumber: "",
            thumbnailUrl: "",
            rating: 0,
            reviewCount: 0,
            timeSlots: [],
            businessHours: {},
            notificationSettings: { booking: true, message: true, marketing: false },
          },
          products: [],
          bookings: [],
          stats: { monthlyViews: 0 },
          isAdmin: true,
        });
      }

      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    // 타임슬롯
    const { data: timeslots } = await supabase
      .from("vendor_timeslots")
      .select("*")
      .eq("vendor_id", vendorRow.id);

    // 상품 목록
    const { data: productRows } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("vendor_id", vendorRow.id)
      .order("sort_order");

    // 상품별 타임슬롯
    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: productTimeslots } = productIds.length > 0
      ? await supabase
          .from("product_timeslots")
          .select("*")
          .in("product_id", productIds)
      : { data: [] };

    const products = (productRows ?? []).map((row) => {
      const pts = (productTimeslots ?? []).filter((pt) => pt.product_id === row.id);
      return productRowToProduct(row, pts);
    });

    // 예약 목록 (최근 30일)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: bookingRows } = await supabase
      .from("vendor_bookings")
      .select("*")
      .eq("vendor_id", vendorRow.id)
      .gte("booking_date", thirtyDaysAgo.toISOString().split("T")[0])
      .order("booking_date", { ascending: false });

    const bookings = (bookingRows ?? []).map(bookingRowToBooking);

    // 조회수 (이번 달)
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { count: viewCount } = await supabase
      .from("vendor_views")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorRow.id)
      .gte("created_at", monthStart.toISOString());

    const vendor = vendorRowToVendor(vendorRow, timeslots ?? [], products);

    return NextResponse.json({
      vendor,
      products,
      bookings,
      stats: {
        monthlyViews: viewCount ?? 0,
      },
    });
  } catch (err) {
    console.error("Vendor me error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
