import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct } from "@/lib/utils/vendorMapper";

export async function GET(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;

    let query = supabase
      .from("vendors")
      .select("*", { count: "exact" })
      .eq("status", "approved")
      .order("ai_recommend", { ascending: false })
      .order("rating", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq("category", category);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,tags.cs.{${search}}`);
    }

    const { data: vendorRows, count, error } = await query;

    if (error) {
      console.error("Vendors list error:", error);
      return NextResponse.json({ error: "업체 목록을 불러올 수 없습니다." }, { status: 500 });
    }

    // 각 업체의 상품 수 가져오기
    const vendorIds = (vendorRows ?? []).map((v) => v.id);

    const { data: productRows } = vendorIds.length > 0
      ? await supabase
          .from("vendor_products")
          .select("*")
          .in("vendor_id", vendorIds)
          .eq("is_active", true)
          .order("sort_order")
      : { data: [] };

    const vendors = (vendorRows ?? []).map((row) => {
      const vendorProducts = (productRows ?? [])
        .filter((p) => p.vendor_id === row.id)
        .map((p) => productRowToProduct(p));
      return vendorRowToVendor(row, [], vendorProducts);
    });

    return NextResponse.json({
      vendors,
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error("Vendors list error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
