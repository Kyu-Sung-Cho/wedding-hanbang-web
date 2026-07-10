import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { vendorRowToVendor, productRowToProduct, vendorToPublicVendor } from "@/lib/utils/vendorMapper";
import { cleanPostgrestSearchTerm, escapePostgrestLikePattern, isUuid } from "@/utils/requestValidation";

// 카테고리 alias — DB에는 영어 슬러그·한글 라벨·변형이 섞여 들어가 있어서,
// 한 카테고리 선택 시 가능한 모든 표기를 OR로 매칭한다.
// 새 카테고리 vendor가 추가되면 여기 값 한 줄만 추가하면 됨.
const CATEGORY_ALIASES: Record<string, string[]> = {
  "스튜디오": ["스튜디오", "studio", "wedding_studio", "사진"],
  "드레스": ["드레스", "dress", "wedding_dress"],
  "메이크업": ["메이크업", "makeup", "hair_makeup", "헤어메이크업", "헤어/메이크업"],
  "예식장": ["예식장", "venue", "wedding_hall", "웨딩홀", "hall"],
  "한복": ["한복", "hanbok"],
  "예물": ["예물", "jewelry", "ring"],
  "신혼여행": ["신혼여행", "honeymoon", "travel"],
  "기타": ["기타", "other", "etc"],
};

export async function GET(req: Request) {
  try {
    const admin = createAdminClient();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const id = searchParams.get("id");
    const ids = searchParams.get("ids");
    const page = Math.max(1, Math.min(1000, parseInt(searchParams.get("page") ?? "1") || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") ?? "20") || 20));
    const offset = (page - 1) * limit;
    const idList = [
      id,
      ...(ids?.split(",") ?? []),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value && isUuid(value))
      .slice(0, 100);

    // 캐논 v2: ai_recommend 우선 정렬 제거. 평점 + 등록순으로만.
    // (Phase 2에서 "조건 공개"/"검증 참여" 기반 설명 가능한 랭킹으로 재도입 예정)
    let query = admin
      .from("vendors")
      .select("*", { count: "exact" })
      .eq("status", "approved")
      .order("rating", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // ID 목록으로 필터 (찜한 업체 등)
    if (id || ids) {
      if (idList.length === 0) {
        return NextResponse.json({ vendors: [], total: 0, page, limit });
      }
      query = query.in("id", idList);
    }

    if (category) {
      const aliases = CATEGORY_ALIASES[category] ?? [category];
      query = query.in("category", aliases);
    }

    if (search) {
      const safeSearch = cleanPostgrestSearchTerm(search);
      if (safeSearch) {
        const escapedSearch = escapePostgrestLikePattern(safeSearch);
        query = query.or(`name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`);
      }
    }

    const { data: vendorRows, count, error } = await query;

    if (error) {
      console.error("Vendors list error:", error);
      return NextResponse.json({ error: "업체 목록을 불러올 수 없습니다." }, { status: 500 });
    }

    // 각 업체의 상품 수 가져오기
    const vendorIds = (vendorRows ?? []).map((v) => v.id);

    const { data: productRows } = vendorIds.length > 0
      ? await admin
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
      return vendorToPublicVendor(vendorRowToVendor(row, [], vendorProducts));
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
