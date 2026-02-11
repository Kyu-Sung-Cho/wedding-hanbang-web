import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { VendorCategory } from "@/types/vendor.types";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServiceClient();
    const { searchParams } = new URL(request.url);

    const category = searchParams.get("category") as VendorCategory | null;
    const region = searchParams.get("region");
    const keyword = searchParams.get("keyword");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const styleTags = searchParams.get("styleTags");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = supabase
      .from("vendors")
      .select("*", { count: "exact" })
      .order("rating", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq("category", category);
    }

    if (region) {
      query = query.eq("region", region);
    }

    if (keyword) {
      query = query.or(
        `name.ilike.%${keyword}%,description.ilike.%${keyword}%`
      );
    }

    if (styleTags) {
      const tags = styleTags.split(",");
      query = query.contains("style_tags", tags);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("[Vendors API] Error:", error);
      return NextResponse.json(
        { error: "업체 목록을 불러오는데 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      vendors: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[Vendors API] Error:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
