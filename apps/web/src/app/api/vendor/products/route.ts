import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { productToInsertRow, productRowToProduct, slotsToTimeslotInserts } from "@/lib/utils/vendorMapper";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    const { data: productRows } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("sort_order");

    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: timeslots } = productIds.length > 0
      ? await supabase.from("product_timeslots").select("*").in("product_id", productIds)
      : { data: [] };

    const products = (productRows ?? []).map((row) => {
      const pts = (timeslots ?? []).filter((t) => t.product_id === row.id);
      return productRowToProduct(row, pts);
    });

    return NextResponse.json({ products });
  } catch (err) {
    console.error("Vendor products GET error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (!vendor) {
      return NextResponse.json({ error: "등록된 업체가 없습니다." }, { status: 404 });
    }

    // Rate limit: 20 products per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("vendor:product:create", req, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = await req.json();
    const insertData = productToInsertRow({ ...body, vendorId: vendor.id });

    const { data: productRow, error } = await supabase
      .from("vendor_products")
      .insert(insertData)
      .select()
      .single();

    if (error || !productRow) {
      console.error("Product insert error:", error);
      return NextResponse.json({ error: "상품 등록에 실패했습니다." }, { status: 500 });
    }

    // 타임슬롯 저장
    if (body.timeSlots && body.timeSlots.length > 0) {
      const slotInserts = slotsToTimeslotInserts(body.timeSlots, productRow.id, "product");
      await supabase.from("product_timeslots").insert(slotInserts);
    }

    const product = productRowToProduct(productRow);

    return NextResponse.json({ product });
  } catch (err) {
    console.error("Vendor product create error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
