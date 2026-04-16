import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { slotsToTimeslotInserts } from "@/lib/utils/vendorMapper";

export async function PUT(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
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

    const { slots, productId } = await req.json();

    if (!slots || !Array.isArray(slots)) {
      return NextResponse.json({ error: "타임슬롯 데이터가 필요합니다." }, { status: 400 });
    }

    if (productId) {
      // 상품별 타임슬롯
      await supabase.from("product_timeslots").delete().eq("product_id", productId);
      if (slots.length > 0) {
        const inserts = slotsToTimeslotInserts(slots, productId, "product");
        const { error } = await supabase.from("product_timeslots").insert(inserts);
        if (error) {
          return NextResponse.json({ error: "타임슬롯 저장에 실패했습니다." }, { status: 500 });
        }
      }
    } else {
      // 업체 기본 타임슬롯
      await supabase.from("vendor_timeslots").delete().eq("vendor_id", vendor.id);
      if (slots.length > 0) {
        const inserts = slotsToTimeslotInserts(slots, vendor.id, "vendor");
        const { error } = await supabase.from("vendor_timeslots").insert(inserts);
        if (error) {
          return NextResponse.json({ error: "타임슬롯 저장에 실패했습니다." }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Timeslots save error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
