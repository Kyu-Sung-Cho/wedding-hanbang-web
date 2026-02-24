import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { productToUpdateRow, productRowToProduct, slotsToTimeslotInserts } from "@/lib/utils/vendorMapper";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const updateData = productToUpdateRow(body);

    const { data: productRow, error } = await supabase
      .from("vendor_products")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error || !productRow) {
      return NextResponse.json({ error: "상품 수정에 실패했습니다." }, { status: 500 });
    }

    // 타임슬롯 업데이트
    if (body.timeSlots) {
      await supabase.from("product_timeslots").delete().eq("product_id", id);
      if (body.timeSlots.length > 0) {
        const slotInserts = slotsToTimeslotInserts(body.timeSlots, id, "product");
        await supabase.from("product_timeslots").insert(slotInserts);
      }
    }

    const product = productRowToProduct(productRow);

    return NextResponse.json({ product });
  } catch (err) {
    console.error("Product update error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 타임슬롯 먼저 삭제
    await supabase.from("product_timeslots").delete().eq("product_id", id);

    const { error } = await supabase
      .from("vendor_products")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "상품 삭제에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Product delete error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
