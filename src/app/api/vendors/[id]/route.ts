import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct } from "@/lib/utils/vendorMapper";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // 업체 정보
    const { data: vendorRow, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", id)
      .eq("status", "approved")
      .single();

    if (error || !vendorRow) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }

    // 타임슬롯
    const { data: timeslots } = await supabase
      .from("vendor_timeslots")
      .select("*")
      .eq("vendor_id", id);

    // 상품
    const { data: productRows } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("sort_order");

    // 상품별 타임슬롯
    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: productTimeslots } = productIds.length > 0
      ? await supabase.from("product_timeslots").select("*").in("product_id", productIds)
      : { data: [] };

    const products = (productRows ?? []).map((row) => {
      const pts = (productTimeslots ?? []).filter((pt) => pt.product_id === row.id);
      return productRowToProduct(row, pts);
    });

    // 리뷰
    const { data: reviews } = await supabase
      .from("vendor_reviews")
      .select("*")
      .eq("vendor_id", id)
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(10);

    const vendor = vendorRowToVendor(vendorRow, timeslots ?? [], products);

    // 조회수 기록
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("vendor_views").insert({
        vendor_id: id,
        viewer_id: user.id,
      });
    }

    // 찜 여부 확인
    let isFavorite = false;
    if (user) {
      const { data: fav } = await supabase
        .from("vendor_favorites")
        .select("id")
        .eq("vendor_id", id)
        .eq("user_id", user.id)
        .single();
      isFavorite = !!fav;
    }

    return NextResponse.json({
      vendor,
      reviews: reviews ?? [],
      isFavorite,
    });
  } catch (err) {
    console.error("Vendor detail error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
