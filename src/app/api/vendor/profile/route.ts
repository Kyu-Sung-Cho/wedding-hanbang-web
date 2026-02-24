import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorToUpdateRow, vendorRowToVendor } from "@/lib/utils/vendorMapper";

export async function PUT(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const updateData = vendorToUpdateRow(body);

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "변경할 데이터가 없습니다." }, { status: 400 });
    }

    const { data: vendorRow, error } = await supabase
      .from("vendors")
      .update(updateData)
      .eq("owner_id", user.id)
      .select()
      .single();

    if (error || !vendorRow) {
      return NextResponse.json({ error: "프로필 수정에 실패했습니다." }, { status: 500 });
    }

    const vendor = vendorRowToVendor(vendorRow);

    return NextResponse.json({ vendor });
  } catch (err) {
    console.error("Vendor profile update error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
