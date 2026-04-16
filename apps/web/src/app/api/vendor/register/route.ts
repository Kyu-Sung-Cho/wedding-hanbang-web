import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { vendorToInsertRow, categoryToDb } from "@/lib/utils/vendorMapper";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 5 registrations per hour per user
    const rlResult = checkRateLimit(
      rateLimitKey("vendor:register", req, user.id),
      { maxRequests: 5, windowMs: 60 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const body = await req.json();
    const { name, category, ownerName, phone, email, address, priceMin, priceMax, description, tags, businessNumber } = body;

    if (!name || !category) {
      return NextResponse.json({ error: "업체명과 카테고리는 필수입니다." }, { status: 400 });
    }

    // 이미 등록된 업체가 있는지 확인
    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (existing) {
      return NextResponse.json({ error: "이미 등록된 업체가 있습니다." }, { status: 409 });
    }

    const location = address ? address.split(" ").slice(0, 2).join(" ") : "";
    const priceRange = priceMin && priceMax
      ? `${Math.round(priceMin / 10000)}~${Math.round(priceMax / 10000)}만원`
      : "";

    const insertData = vendorToInsertRow({
      ownerId: user.id,
      name,
      category,
      ownerName: ownerName || "",
      phone: phone || "",
      email: email || user.email || "",
      address: address || "",
      location,
      region: location,
      priceMin: priceMin || 0,
      priceMax: priceMax || 0,
      priceRange,
      description: description || "",
      tags: tags ? (typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()) : tags) : [],
      businessNumber: businessNumber || "",
    });

    // category를 DB 영문으로 변환
    insertData.category = categoryToDb(category);

    const { data: vendor, error } = await supabase
      .from("vendors")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Vendor register error:", error);
      return NextResponse.json({ error: "업체 등록에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ vendor, message: "업체 등록이 완료되었습니다." });
  } catch (err) {
    console.error("Vendor register error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
