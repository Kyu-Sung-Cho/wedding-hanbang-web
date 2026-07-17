import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createAdminClient();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);
    const category = searchParams.get("category");

    const service = getServiceClient();
    let query = service
      .from("community_vendor_tags")
      .select("*")
      .order("mention_count", { ascending: false })
      .limit(limit);

    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) {
      console.error("Vendor tags list error:", error);
      return NextResponse.json(
        { error: "목록을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ tags: data ?? [] });
  } catch (err) {
    console.error("Vendor tags error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
